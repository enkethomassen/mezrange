// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./MezRangeStrategyV2.sol";

/// @title MezRangeVault
/// @notice Fully ERC-4626 compliant vault for automated LP management on Mezo DEX.
///         Users deposit token0; vault manages a Uniswap V3-style LP position,
///         auto-rebalances when price drifts out of range, and compounds fees.
///         Share tokens represent proportional ownership of the vault's assets.
///
/// @dev totalAssets() is derived from strategy.totalValue(), which sums:
///      - idle token0 in strategy
///      - idle token1 in strategy (converted to token0 via TWAP)
///      - token0+token1 in the active LP position (converted to token0 via TWAP)
///      This correctly reflects all value under management and prevents share pricing bugs.
contract MezRangeVault is ERC20, IERC4626, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant KEEPER_ROLE    = keccak256("KEEPER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // ── Config ───────────────────────────────────────────────────────────────
    address          private immutable _assetAddr;      // deposit token (token0)
    MezRangeStrategyV2 public immutable strategy;

    address public treasury;
    uint256 public performanceFeeBps = 1000;  // 10% of earned fees
    uint256 public managementFeeBps  = 100;   // 1% annual management fee
    uint256 public lastFeeTimestamp;

    // ── Admin-change timelock ────────────────────────────────────────────────
    // All fee + treasury changes go through a 2-step propose/execute with a
    // mandatory minimum delay. This stops a compromised admin from instantly
    // routing future fees to themselves before users can exit. Caps on
    // performanceFeeBps (≤2000) and managementFeeBps (≤200) are still enforced.
    uint256 public constant ADMIN_TIMELOCK_DELAY = 2 days;

    enum PendingKind { NONE, PERFORMANCE_FEE, MANAGEMENT_FEE, TREASURY }
    PendingKind public pendingKind;
    uint256     public pendingValue;     // fee bps OR uint160(address) cast
    uint256     public pendingEta;       // earliest block.timestamp at which executeAdminChange may run

    // ── Events ───────────────────────────────────────────────────────────────
    event FeesCharged(uint256 performanceFee, uint256 managementFee);
    event TreasuryUpdated(address newTreasury);
    event PerformanceFeeUpdated(uint256 newBps);
    event ManagementFeeUpdated(uint256 newBps);
    event AdminChangeProposed(PendingKind indexed kind, uint256 value, uint256 eta);
    event AdminChangeCancelled(PendingKind indexed kind);

    // ── Errors ───────────────────────────────────────────────────────────────
    error ZeroAmount();
    error InsufficientShares();
    error MaxSlippageExceeded();
    error ExceedsMaxDeposit();
    error NoPendingChange();
    error TimelockNotElapsed();
    error PendingChangeExists();

    // ── ERC-4626 constants ────────────────────────────────────────────────────
    uint256 public constant MAX_DEPOSIT_PER_TX = type(uint256).max;

    constructor(
        address _asset,
        address _strategy,
        address _treasury,
        address _admin,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) {
        _assetAddr = _asset;
        strategy = MezRangeStrategyV2(_strategy);
        treasury = _treasury;
        lastFeeTimestamp = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _admin);
    }

    // ── ERC-4626: Core View Functions ────────────────────────────────────────

    /// @inheritdoc IERC4626
    function asset() public view override returns (address) {
        return _assetAddr;
    }

    function totalAssets() public view override returns (uint256) {
        uint256 idleInVault = IERC20(asset()).balanceOf(address(this));
        uint256 strategyValue = strategy.totalValue();
        return idleInVault + strategyValue;
    }

    /// @inheritdoc IERC4626
    function convertToShares(uint256 assets) public view override returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0 || totalAssets() == 0) return assets;
        return (assets * supply) / totalAssets();
    }

    /// @inheritdoc IERC4626
    function convertToAssets(uint256 shares) public view override returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return shares;
        return (shares * totalAssets()) / supply;
    }

    /// @inheritdoc IERC4626
    function maxDeposit(address) public pure override returns (uint256) {
        return MAX_DEPOSIT_PER_TX;
    }

    /// @inheritdoc IERC4626
    function maxMint(address) public pure override returns (uint256) {
        return type(uint256).max;
    }

    /// @inheritdoc IERC4626
    function maxWithdraw(address owner) public view override returns (uint256) {
        return convertToAssets(balanceOf(owner));
    }

    /// @inheritdoc IERC4626
    function maxRedeem(address owner) public view override returns (uint256) {
        return balanceOf(owner);
    }

    /// @inheritdoc IERC4626
    function previewDeposit(uint256 assets) public view override returns (uint256) {
        return convertToShares(assets);
    }

    /// @inheritdoc IERC4626
    function previewMint(uint256 shares) public view override returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0 || totalAssets() == 0) return shares;
        return (shares * totalAssets() + supply - 1) / supply; // round up
    }

    /// @inheritdoc IERC4626
    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return assets;
        return (assets * supply + totalAssets() - 1) / totalAssets(); // round up
    }

    /// @inheritdoc IERC4626
    function previewRedeem(uint256 shares) public view override returns (uint256) {
        return convertToAssets(shares);
    }

    // ── ERC-4626: Core State-Changing Functions ──────────────────────────────

    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        if (assets == 0) revert ZeroAmount();
        _collectManagementFee();
        shares = previewDeposit(assets);
        if (shares == 0) revert ZeroAmount();
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
        uint256 bal0 = IERC20(asset()).balanceOf(address(this));
        IERC20(asset()).forceApprove(address(strategy), bal0);
        strategy.addLiquidity(bal0, 0);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();
        _collectManagementFee();
        assets = previewMint(shares);
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
        uint256 bal0 = IERC20(asset()).balanceOf(address(this));
        IERC20(asset()).forceApprove(address(strategy), bal0);
        strategy.addLiquidity(bal0, 0);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        if (assets == 0) revert ZeroAmount();
        _collectManagementFee();
        shares = previewWithdraw(assets);
        if (balanceOf(owner) < shares) revert InsufficientShares();
        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }
        _burn(owner, shares);
        uint256 assetsWithdrawn = _withdrawFromStrategy(shares, assets, receiver);
        emit Withdraw(msg.sender, receiver, owner, assetsWithdrawn, shares);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();
        if (balanceOf(owner) < shares) revert InsufficientShares();
        _collectManagementFee();
        assets = previewRedeem(shares);
        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }
        _burn(owner, shares);
        assets = _withdrawFromStrategy(shares, assets, receiver);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    // ── Slippage-protected convenience wrappers ───────────────────────────────

    function depositWithMinShares(uint256 assets, uint256 minShares)
        external
        returns (uint256 shares)
    {
        shares = deposit(assets, msg.sender);
        if (shares < minShares) revert MaxSlippageExceeded();
    }

    function redeemWithMinAssets(uint256 shares, uint256 minAssets)
        external
        returns (uint256 assets)
    {
        assets = redeem(shares, msg.sender, msg.sender);
        if (assets < minAssets) revert MaxSlippageExceeded();
    }

    // ── Keeper functions ──────────────────────────────────────────────────────

    function compoundFees() external nonReentrant whenNotPaused onlyRole(KEEPER_ROLE) {
        _collectManagementFee();

        (uint256 fees0, uint256 fees1) = strategy.collectFees(address(this));
        uint256 perfFee0 = (fees0 * performanceFeeBps) / 10000;
        uint256 perfFee1 = (fees1 * performanceFeeBps) / 10000;
        uint256 net0 = fees0 - perfFee0;
        uint256 net1 = fees1 - perfFee1;

        if (perfFee0 > 0) IERC20(asset()).safeTransfer(treasury, perfFee0);
        if (perfFee1 > 0) IERC20(address(strategy.token1())).safeTransfer(treasury, perfFee1);

        if (net0 > 0 || net1 > 0) {
            IERC20(asset()).forceApprove(address(strategy), net0);
            IERC20(address(strategy.token1())).forceApprove(address(strategy), net1);
            strategy.addLiquidity(net0, net1);
        }

        emit FeesCharged(perfFee0, perfFee1);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    //
    // Fee and treasury changes go through propose → wait ADMIN_TIMELOCK_DELAY →
    // execute. Only one pending change is allowed at a time; queueing a new one
    // requires cancelling the prior. Caps are still validated on propose so
    // executing the queued value cannot exceed bounds even if state drifted.

    function proposePerformanceFee(uint256 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps <= 2000, "Max 20%");
        _enqueue(PendingKind.PERFORMANCE_FEE, _bps);
    }

    function proposeManagementFee(uint256 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps <= 200, "Max 2%");
        _enqueue(PendingKind.MANAGEMENT_FEE, _bps);
    }

    function proposeTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_treasury != address(0), "Zero treasury");
        _enqueue(PendingKind.TREASURY, uint256(uint160(_treasury)));
    }

    function cancelAdminChange() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (pendingKind == PendingKind.NONE) revert NoPendingChange();
        emit AdminChangeCancelled(pendingKind);
        _clearPending();
    }

    function executeAdminChange() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (pendingKind == PendingKind.NONE)      revert NoPendingChange();
        if (block.timestamp < pendingEta)         revert TimelockNotElapsed();

        PendingKind kind = pendingKind;
        uint256 value    = pendingValue;
        _clearPending();

        if (kind == PendingKind.PERFORMANCE_FEE) {
            performanceFeeBps = value;
            emit PerformanceFeeUpdated(value);
        } else if (kind == PendingKind.MANAGEMENT_FEE) {
            // Accrue any management fees owed under the old rate before changing.
            _collectManagementFee();
            managementFeeBps = value;
            emit ManagementFeeUpdated(value);
        } else if (kind == PendingKind.TREASURY) {
            address newTreasury = address(uint160(value));
            treasury = newTreasury;
            emit TreasuryUpdated(newTreasury);
        }
    }

    function _enqueue(PendingKind kind, uint256 value) internal {
        if (pendingKind != PendingKind.NONE) revert PendingChangeExists();
        pendingKind  = kind;
        pendingValue = value;
        pendingEta   = block.timestamp + ADMIN_TIMELOCK_DELAY;
        emit AdminChangeProposed(kind, value, pendingEta);
    }

    function _clearPending() internal {
        pendingKind  = PendingKind.NONE;
        pendingValue = 0;
        pendingEta   = 0;
    }

    function pause()   external onlyRole(EMERGENCY_ROLE) { _pause(); }
    function unpause() external onlyRole(EMERGENCY_ROLE) { _unpause(); }

    // ── Internal ──────────────────────────────────────────────────────────────

    /// @dev Withdraw assets from strategy and send to receiver.
    ///      FIX (M4): We capture `preBurnSupply` BEFORE _burn() is called (in the public
    ///      functions above), so the proportion calculation uses the correct pre-burn total.
    ///      The vault's public redeem/withdraw functions call _burn() before this, so we
    ///      reconstruct pre-burn supply as (currentSupply + shares).
    function _withdrawFromStrategy(uint256 shares, uint256 assetsRequested, address receiver) internal returns (uint256 assetsWithdrawn) {
        // totalSupply() is the post-burn supply; add back `shares` to get pre-burn total.
        uint256 preBurnSupply = totalSupply() + shares;
        uint128 totalLiq = _getPositionLiquidity();
        uint128 liquidityToRemove = totalLiq == 0
            ? 0
            : uint128((uint256(shares) * uint256(totalLiq)) / preBurnSupply);

        if (liquidityToRemove > 0) {
            assetsWithdrawn = strategy.removeLiquidityAsToken0(liquidityToRemove, receiver);
        } else {
            // Fallback: transfer idle vault balance proportionally
            uint256 idle = IERC20(asset()).balanceOf(address(this));
            if (idle > 0) {
                uint256 idleShare = (idle * shares) / preBurnSupply;
                if (idleShare > 0) {
                    IERC20(asset()).safeTransfer(receiver, idleShare);
                    assetsWithdrawn = idleShare;
                }
            }
        }

        require(assetsWithdrawn >= assetsRequested, "Insufficient assets withdrawn");
    }

    function _collectManagementFee() internal {
        uint256 elapsed = block.timestamp - lastFeeTimestamp;
        if (elapsed == 0 || totalSupply() == 0) return;

        uint256 total = totalAssets();
        uint256 annualFee = (total * managementFeeBps) / 10000;
        uint256 fee = (annualFee * elapsed) / 365 days;

        if (fee > 0 && fee < total) {
            uint256 sharesToMint = (fee * totalSupply()) / (total - fee);
            if (sharesToMint > 0) {
                _mint(treasury, sharesToMint);
                emit FeesCharged(0, fee);
            }
        }
        lastFeeTimestamp = block.timestamp;
    }

    function _getPositionLiquidity() internal view returns (uint128) {
        if (!strategy.positionActive()) return 0;
        (,,,,,,,uint128 liquidity,,,,) = strategy.positionManager().positions(strategy.positionTokenId());
        return liquidity;
    }

    // ── ERC-4626 decimals override ─────────────────────────────────────────────

    function decimals() public view override(ERC20, IERC20Metadata) returns (uint8) {
        return ERC20.decimals();
    }
}
