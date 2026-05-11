// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
// MezRangeStrategyV2: accepts fee and tickSpacing directly in constructor
// to support Mezo testnet pools that use non-standard fee->tickSpacing mappings.

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "./interfaces/INonfungiblePositionManager.sol";
import "./interfaces/IUniswapV3Pool.sol";
import "./interfaces/IUniswapV3SwapRouter.sol";
import "./libraries/TickMath.sol";
import "./libraries/LiquidityAmounts.sol";

/// @title MezRangeStrategy
/// @notice Manages concentrated liquidity positions on Uniswap V3-compatible DEX for Mezo.
///         Handles adding/removing liquidity, fee collection, and auto-rebalancing.
///         Implements IERC721Receiver to safely hold Uniswap V3 position NFTs.
contract MezRangeStrategyV2 is AccessControl, ReentrancyGuard, Pausable, IERC721Receiver {
    using SafeERC20 for IERC20;

    // ── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant KEEPER_ROLE    = keccak256("KEEPER_ROLE");
    bytes32 public constant VAULT_ROLE     = keccak256("VAULT_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // ── Strategy types ───────────────────────────────────────────────────────
    enum StrategyType { TIGHT, MEDIUM, WIDE }

    // Width in basis points for each strategy
    // TIGHT:  +/-3%  => 600 bps total range
    // MEDIUM: +/-10% => 2000 bps total range
    // WIDE:   +/-30% => 6000 bps total range
    uint24[3] public STRATEGY_WIDTHS = [600, 2000, 6000];

    // ── State ────────────────────────────────────────────────────────────────
    INonfungiblePositionManager public immutable positionManager;
    IUniswapV3Pool              public immutable pool;
    IUniswapV3SwapRouter        public immutable swapRouter;
    IERC20                      public immutable token0;
    IERC20                      public immutable token1;
    uint24                      public immutable fee;
    int24                       public immutable tickSpacing;

    uint256 public positionTokenId;
    bool    public positionActive;
    int24   public currentTickLower;
    int24   public currentTickUpper;
    StrategyType public strategy;

    uint256 public totalFeesCollected0;
    uint256 public totalFeesCollected1;
    uint256 public rebalanceCount;
    uint256 public lastRebalanceTimestamp;

    // Slippage tolerance in basis points (default 50 = 0.5%)
    uint256 public slippageBps = 50;

    // TWAP window in seconds
    uint32  public twapSeconds = 300;

    // Minimum pool observation age (seconds) before TWAP is considered reliable.
    // Admin should not deploy vaults on pools younger than this value.
    // Default 300 s matches twapSeconds. Raise on mainnet for extra safety.
    uint32  public minPoolAgeSecs = 300;

    // Maximum allowed |spotTick - twapTick| in ticks. If the spot drifts further
    // than this from the TWAP, write-paths that would otherwise consume manipulated
    // spot prices revert. ~200 ticks ≈ 2%, well above normal block-to-block jitter
    // on a real pool but small enough to make flash-loan price manipulation visible.
    int24   public maxTwapDeviationTicks = 200;

    // Max iterations for iterative ratio optimizer in _rebalanceTokenRatio
    uint8   private constant MAX_RATIO_ITERS = 4;
    uint256 private constant Q96 = 0x1000000000000000000000000;

    // ── Events ───────────────────────────────────────────────────────────────
    event PositionOpened(uint256 indexed tokenId, int24 tickLower, int24 tickUpper, uint128 liquidity);
    event PositionClosed(uint256 indexed tokenId, uint256 amount0, uint256 amount1);
    event FeesCollected(uint256 amount0, uint256 amount1);
    event Rebalanced(int24 oldLower, int24 oldUpper, int24 newLower, int24 newUpper, uint256 feesCollected0, uint256 feesCollected1);
    event StrategyChanged(StrategyType newStrategy);
    event SlippageUpdated(uint256 newSlippageBps);
    event TokensSwappedForRebalance(uint256 amountIn, uint256 amountOut, bool zeroForOne);

    // ── Errors ───────────────────────────────────────────────────────────────
    error NotInRange();
    error PositionAlreadyActive();
    error NoActivePosition();
    error SlippageExceeded();
    error ZeroLiquidity();
    error PoolTooYoung();
    error PriceDeviatedFromTwap();

    constructor(
        address _positionManager,
        address _pool,
        address _swapRouter,
        StrategyType _strategy,
        address _admin,
        uint24 _fee,
        int24 _tickSpacing
    ) {
        positionManager = INonfungiblePositionManager(_positionManager);
        pool = IUniswapV3Pool(_pool);
        swapRouter = IUniswapV3SwapRouter(_swapRouter);
        token0 = IERC20(pool.token0());
        token1 = IERC20(pool.token1());
        fee = _fee;
        tickSpacing = _tickSpacing;
        strategy = _strategy;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _admin);
    }

    // ── IERC721Receiver ──────────────────────────────────────────────────────

    function onERC721Received(address, address, uint256, bytes calldata)
        external pure override returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    // ── External: Vault-callable ─────────────────────────────────────────────

    /// @notice Open or increase a liquidity position at the current optimal range.
    ///         If only token0 is provided, automatically swaps ~50% to token1.
    function addLiquidity(uint256 amount0, uint256 amount1)
        external
        onlyRole(VAULT_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint128 liquidity)
    {
        // Opening (not increasing) a position requires:
        //   1. The pool to have at least `minPoolAgeSecs` of observation history
        //      (otherwise TWAP silently falls back to spot — a known manipulation
        //      surface called out in the README).
        //   2. Spot tick to be close to the TWAP tick. The first mint anchors the
        //      vault's range around the live price; if spot has been pumped the
        //      mint would lock in an attacker-chosen range. Subsequent
        //      `increaseLiquidity` calls reuse the existing range, so this check
        //      only applies on the open path.
        if (!positionActive) {
            _requireMinPoolAge();
            _requireSpotNearTwap();
        }

        (int24 tickLower, int24 tickUpper) = _calcOptimalRange();

        token0.safeTransferFrom(msg.sender, address(this), amount0);
        if (amount1 > 0) token1.safeTransferFrom(msg.sender, address(this), amount1);

        if (amount1 == 0 && amount0 > 0) {
            uint256 swapAmt = amount0 / 2;
            amount1 = _swapToken0ForToken1(swapAmt);
        }

        // Align the inventory with the live range before minting the initial
        // position. This avoids first-deposit failures when a naive 50/50 split
        // cannot satisfy both min-amount constraints on concentrated liquidity.
        _rebalanceTokenRatio(tickLower, tickUpper);

        amount0 = token0.balanceOf(address(this));
        amount1 = token1.balanceOf(address(this));

        token0.forceApprove(address(positionManager), amount0);
        token1.forceApprove(address(positionManager), amount1);

        (uint160 sqrtPriceX96,,,,,) = pool.slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        uint128 estLiquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, amount0, amount1
        );
        if (estLiquidity == 0) revert ZeroLiquidity();

        (uint256 est0, uint256 est1) = LiquidityAmounts.getAmountsForLiquidity(
            sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, estLiquidity
        );
        uint256 amount0Min = est0 * (10000 - slippageBps) / 10000;
        uint256 amount1Min = est1 * (10000 - slippageBps) / 10000;

        if (!positionActive) {
            (uint256 tokenId, uint128 liq,,) = positionManager.mint(
                INonfungiblePositionManager.MintParams({
                    token0:          address(token0),
                    token1:          address(token1),
                    fee:             fee,
                    tickLower:       tickLower,
                    tickUpper:       tickUpper,
                    amount0Desired:  amount0,
                    amount1Desired:  amount1,
                    amount0Min:      amount0Min,
                    amount1Min:      amount1Min,
                    recipient:       address(this),
                    deadline:        block.timestamp + 60
                })
            );
            positionTokenId = tokenId;
            positionActive  = true;
            currentTickLower = tickLower;
            currentTickUpper = tickUpper;
            liquidity = liq;
            emit PositionOpened(tokenId, tickLower, tickUpper, liq);
        } else {
            (uint128 liq,,) = positionManager.increaseLiquidity(
                INonfungiblePositionManager.IncreaseLiquidityParams({
                    tokenId:        positionTokenId,
                    amount0Desired: amount0,
                    amount1Desired: amount1,
                    amount0Min:     amount0Min,
                    amount1Min:     amount1Min,
                    deadline:       block.timestamp + 60
                })
            );
            liquidity = liq;
        }
    }

    /// @notice Remove liquidity proportionally and return tokens to vault
    function removeLiquidity(uint128 liquidity, address recipient)
        external
        onlyRole(VAULT_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 amount0, uint256 amount1)
    {
        if (!positionActive) revert NoActivePosition();
        if (liquidity == 0) revert ZeroLiquidity();

        (uint160 sqrtPriceX96,,,,,) = pool.slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(currentTickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(currentTickUpper);
        (uint256 est0, uint256 est1) = LiquidityAmounts.getAmountsForLiquidity(
            sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, liquidity
        );
        uint256 amount0Min = est0 * (10000 - slippageBps) / 10000;
        uint256 amount1Min = est1 * (10000 - slippageBps) / 10000;

        positionManager.decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId:    positionTokenId,
                liquidity:  liquidity,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                deadline:   block.timestamp + 60
            })
        );

        (uint256 collected0, uint256 collected1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId:     positionTokenId,
                recipient:   recipient,
                amount0Max:  type(uint128).max,
                amount1Max:  type(uint128).max
            })
        );
        return (collected0, collected1);
    }

    /// @notice Remove liquidity and convert all output to token0, returning a single asset amount.
    ///         Called by MezRangeVault._withdrawFromStrategy() for standard ERC-4626 withdrawals.
    function removeLiquidityAsToken0(uint128 liquidity, address recipient)
        external
        onlyRole(VAULT_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 assetsOut)
    {
        if (!positionActive) revert NoActivePosition();
        if (liquidity == 0) revert ZeroLiquidity();

        _decreaseLiquidity(liquidity);
        (uint256 collected0, uint256 collected1) = _collectPositionFees(address(this));

        assetsOut = collected0;
        if (collected1 > 0) {
            assetsOut += _swapToken1ForToken0(collected1);
        }

        if (assetsOut > 0) {
            token0.safeTransfer(recipient, assetsOut);
        }
    }

    /// @notice Collect accrued fees to a recipient without compounding.
    ///         Called by MezRangeVault.compoundFees() to collect fees before reinvesting.
    function collectFees(address recipient)
        external
        onlyRole(VAULT_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 fees0, uint256 fees1)
    {
        if (!positionActive) revert NoActivePosition();
        return _collectPositionFees(recipient);
    }

    /// @notice Collect accrued fees and compound back into position
    function collectAndCompound()
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 fees0, uint256 fees1)
    {
        if (!positionActive) revert NoActivePosition();

        (fees0, fees1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId:    positionTokenId,
                recipient:  address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        totalFeesCollected0 += fees0;
        totalFeesCollected1 += fees1;
        emit FeesCollected(fees0, fees1);

        if (fees0 > 0 || fees1 > 0) {
            token0.forceApprove(address(positionManager), fees0);
            token1.forceApprove(address(positionManager), fees1);

            // Slippage-protected re-mint of collected fees. Without min-amounts the
            // keeper's compound tx is sandwichable: an attacker shifts the pool price
            // so increaseLiquidity consumes far more of one side than the other and
            // returns the rest as idle, where the share-price math then misvalues it.
            (uint160 sqrtPriceX96,,,,,) = pool.slot0();
            uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(currentTickLower);
            uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(currentTickUpper);
            uint128 estLiq = LiquidityAmounts.getLiquidityForAmounts(
                sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, fees0, fees1
            );
            uint256 amount0Min = 0;
            uint256 amount1Min = 0;
            if (estLiq > 0) {
                (uint256 est0, uint256 est1) = LiquidityAmounts.getAmountsForLiquidity(
                    sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, estLiq
                );
                amount0Min = est0 * (10000 - slippageBps) / 10000;
                amount1Min = est1 * (10000 - slippageBps) / 10000;
            }

            positionManager.increaseLiquidity(
                INonfungiblePositionManager.IncreaseLiquidityParams({
                    tokenId:        positionTokenId,
                    amount0Desired: fees0,
                    amount1Desired: fees1,
                    amount0Min:     amount0Min,
                    amount1Min:     amount1Min,
                    deadline:       block.timestamp + 60
                })
            );
        }
    }

    /// @notice Rebalance position into new optimal range around current TWAP price.
    ///         Collects fees, removes all liquidity, burns old NFT, computes new range,
    ///         swaps to optimal token ratio, and re-mints at new range with slippage protection.
    /// @notice Rebalance via custom keeper bot (direct KEEPER_ROLE call).
    function rebalance()
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (!positionActive) revert NoActivePosition();
        _performRebalance();
    }

    // ── Keeper trigger check ─────────────────────────────────────────────────

    function shouldRebalance() external view returns (bool) {
        if (!positionActive) return false;
        (, int24 currentTick,,,,) = pool.slot0();
        return currentTick < currentTickLower || currentTick >= currentTickUpper;
    }

    // ── View: total value accounting ─────────────────────────────────────────

    /// @notice Total assets under management denominated in token0.
    /// @dev All valuation math uses a single TWAP-derived sqrtPrice. Mixing spot
    ///      (`pool.slot0`) with TWAP for different terms — as the prior version did —
    ///      lets a flash-swap manipulate `getAmountsForLiquidity` and inflate or
    ///      deflate share price in a single block. Using TWAP everywhere closes that.
    function totalValue() external view returns (uint256 value0) {
        uint256 idle0 = token0.balanceOf(address(this));
        uint256 idle1 = token1.balanceOf(address(this));

        // Single price reference for the entire valuation pass. _getTwapTick falls
        // back to the spot tick only when the pool has no observation history; the
        // separate minPoolAgeSecs gate on addLiquidity guarantees that fallback is
        // not exploitable during normal operation.
        uint160 sqrtPriceTwap = TickMath.getSqrtRatioAtTick(_getTwapTick());

        uint256 pos0 = 0;
        uint256 pos1 = 0;
        if (positionActive && sqrtPriceTwap > 0) {
            uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(currentTickLower);
            uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(currentTickUpper);
            (,,,,,,, uint128 liquidity,, ,uint128 tokensOwed0, uint128 tokensOwed1) =
                positionManager.positions(positionTokenId);
            (pos0, pos1) = LiquidityAmounts.getAmountsForLiquidity(
                sqrtPriceTwap, sqrtRatioAX96, sqrtRatioBX96, liquidity
            );
            pos0 += tokensOwed0;
            pos1 += tokensOwed1;
        }

        uint256 total1 = idle1 + pos1;
        if (total1 > 0 && sqrtPriceTwap > 0) {
            uint256 token1InToken0 = LiquidityAmounts.mulDiv(total1, Q96, uint256(sqrtPriceTwap));
            token1InToken0 = LiquidityAmounts.mulDiv(token1InToken0, Q96, uint256(sqrtPriceTwap));
            value0 = idle0 + pos0 + token1InToken0;
        } else {
            value0 = idle0 + pos0;
        }
    }

    // ── Admin functions ──────────────────────────────────────────────────────

    function setStrategy(StrategyType _strategy) external onlyRole(DEFAULT_ADMIN_ROLE) {
        strategy = _strategy;
        emit StrategyChanged(_strategy);
    }

    function setSlippage(uint256 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps <= 500, "Max 5% slippage");
        slippageBps = _bps;
        emit SlippageUpdated(_bps);
    }

    function setTwapSeconds(uint32 _seconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_seconds >= 60, "Min 60s TWAP");
        twapSeconds = _seconds;
    }

    /// @notice Set the minimum pool observation age required before trusting TWAP.
    ///         Raise this on mainnet (e.g. 1800s) to further limit new-pool manipulation risk.
    function setMinPoolAgeSecs(uint32 _secs) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_secs >= 60, "Min 60s");
        minPoolAgeSecs = _secs;
    }

    /// @notice Set the maximum tolerated |spot - TWAP| in ticks for write-paths.
    ///         Capped at 1000 (~10%) to keep the protection meaningful — anything
    ///         higher effectively disables the manipulation guard.
    function setMaxTwapDeviationTicks(int24 _ticks) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_ticks > 0 && _ticks <= 1000, "Out of bounds");
        maxTwapDeviationTicks = _ticks;
    }

    function pause()   external onlyRole(EMERGENCY_ROLE) { _pause(); }
    function unpause() external onlyRole(EMERGENCY_ROLE) { _unpause(); }

    function rescueTokens(address token, address to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        whenPaused
    {
        IERC20(token).safeTransfer(to, amount);
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _calcOptimalRange() internal view returns (int24 tickLower, int24 tickUpper) {
        int24 twapTick = _getTwapTick();
        uint24 widthBps = STRATEGY_WIDTHS[uint256(strategy)];
        (tickLower, tickUpper) = TickMath.calcRange(twapTick, widthBps, tickSpacing);
    }

    /// @dev Reverts unless the pool has at least `minPoolAgeSecs` seconds of
    ///      observation history older than `block.timestamp`. Read from
    ///      `observations(0)`, which Uniswap V3 always initialises at pool creation.
    function _requireMinPoolAge() internal view {
        (uint32 obsTs, , , bool initialized) = pool.observations(0);
        if (!initialized || obsTs == 0) revert PoolTooYoung();
        if (block.timestamp < uint256(obsTs) + uint256(minPoolAgeSecs)) revert PoolTooYoung();
    }

    /// @dev Reverts when spot tick has drifted more than `maxTwapDeviationTicks`
    ///      from the TWAP tick. Callers use this before consuming spot in a
    ///      state-changing path (rebalance, first-mint sizing). When the pool has
    ///      no TWAP history the check is silently skipped — pool-age gating and
    ///      the deposit-side slippage floor remain in force.
    function _requireSpotNearTwap() internal view {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapSeconds;
        secondsAgos[1] = 0;
        try pool.observe(secondsAgos) returns (int56[] memory cumulatives, uint160[] memory) {
            int56 delta = cumulatives[1] - cumulatives[0];
            int24 twapTick = int24(delta / int56(int32(twapSeconds)));
            (, int24 spotTick,,,,) = pool.slot0();
            int24 diff = spotTick > twapTick ? spotTick - twapTick : twapTick - spotTick;
            if (diff > maxTwapDeviationTicks) revert PriceDeviatedFromTwap();
        } catch {
            // No TWAP history — fall through. minPoolAgeSecs guards the open path.
        }
    }

    /// @notice Compute TWAP tick. Falls back to spot if pool.observe() reverts
    ///         (brand-new pool with insufficient history).
    function _getTwapTick() internal view returns (int24) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapSeconds;
        secondsAgos[1] = 0;

        try pool.observe(secondsAgos) returns (int56[] memory cumulatives, uint160[] memory) {
            int56 tickDelta = cumulatives[1] - cumulatives[0];
            return int24(tickDelta / int56(int32(twapSeconds)));
        } catch {
            // Fallback to spot tick for brand-new pools without TWAP history.
            // Admin: set minPoolAgeSecs and avoid deploying on pools younger than this value.
            (, int24 tick,,,,) = pool.slot0();
            return tick;
        }
    }

    /// @notice Iterative delta-neutral ratio optimizer.
    ///         Swaps tokens toward the ideal ratio for the new tick range to minimise idle waste.
    ///         Converges within MAX_RATIO_ITERS iterations (default 4) or a 1% balance tolerance.
    ///         Replaces the previous hard /2 halving heuristic.
    function _rebalanceTokenRatio(int24 tickLower, int24 tickUpper) internal {
        (uint160 sqrtPriceX96,,,,,) = pool.slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        for (uint8 i = 0; i < MAX_RATIO_ITERS; i++) {
            uint256 bal0 = token0.balanceOf(address(this));
            uint256 bal1 = token1.balanceOf(address(this));
            if (bal0 == 0 && bal1 == 0) return;

            uint128 liq0 = LiquidityAmounts.getLiquidityForAmount0(sqrtPriceX96, sqrtRatioBX96, bal0);
            uint128 liq1 = LiquidityAmounts.getLiquidityForAmount1(sqrtRatioAX96, sqrtPriceX96, bal1);
            if (liq0 == 0 && liq1 == 0) return;

            // Convergence: stop if within 1% of target ratio
            if (liq0 > 0 && liq1 > 0) {
                uint256 diff = liq0 > liq1 ? uint256(liq0 - liq1) : uint256(liq1 - liq0);
                uint256 larger = liq0 > liq1 ? uint256(liq0) : uint256(liq1);
                if (diff * 100 <= larger) break;
            }

            if (liq0 > liq1) {
                uint128 targetLiq = liq1;
                (uint256 need0,) = LiquidityAmounts.getAmountsForLiquidity(
                    sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, targetLiq
                );
                if (bal0 <= need0) break;
                uint256 swapAmt = bal0 - need0;
                if (swapAmt == 0) break;
                _swapToken0ForToken1(swapAmt);
            } else {
                uint128 targetLiq = liq0;
                (, uint256 need1) = LiquidityAmounts.getAmountsForLiquidity(
                    sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, targetLiq
                );
                if (bal1 <= need1) break;
                uint256 swapAmt = bal1 - need1;
                if (swapAmt == 0) break;
                _swapToken1ForToken0(swapAmt);
            }
        }
    }

    /// @dev TWAP-based minimum output for token0->token1 swap (MEV protection).
    ///      price(token1/token0) = (sqrtP)^2 / 2^192
    function _calcAmountOutMin0For1(uint256 amountIn) internal view returns (uint256) {
        int24 twapTick = _getTwapTick();
        uint160 sqrtP = TickMath.getSqrtRatioAtTick(twapTick);
        if (sqrtP == 0 || amountIn == 0) return 0;
        uint256 step1   = (amountIn * uint256(sqrtP)) >> 96;
        uint256 expected = (step1   * uint256(sqrtP)) >> 96;
        return expected * (10000 - slippageBps) / 10000;
    }

    /// @dev TWAP-based minimum output for token1->token0 swap (MEV protection).
    ///      price(token0/token1) = 2^192 / (sqrtP)^2
    function _calcAmountOutMin1For0(uint256 amountIn) internal view returns (uint256) {
        int24 twapTick = _getTwapTick();
        uint160 sqrtP = TickMath.getSqrtRatioAtTick(twapTick);
        if (sqrtP == 0 || amountIn == 0) return 0;
        uint256 step1   = (amountIn << 96) / uint256(sqrtP);
        uint256 expected = (step1  << 96) / uint256(sqrtP);
        return expected * (10000 - slippageBps) / 10000;
    }

    /// @notice Swap token0 -> token1 with TWAP-enforced slippage floor.
    /// @dev Mezo router uses exactInput (path-encoded) not exactInputSingle.
    function _swapToken0ForToken1(uint256 amountIn) internal returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        token0.forceApprove(address(swapRouter), amountIn);
        amountOut = swapRouter.exactInput(
            IUniswapV3SwapRouter.ExactInputParams({
                path:             abi.encodePacked(address(token0), fee, address(token1)),
                recipient:        address(this),
                deadline:         block.timestamp + 60,
                amountIn:         amountIn,
                amountOutMinimum: _calcAmountOutMin0For1(amountIn)
            })
        );
        emit TokensSwappedForRebalance(amountIn, amountOut, true);
    }

    /// @notice Swap token1 -> token0 with TWAP-enforced slippage floor.
    /// @dev Mezo router uses exactInput (path-encoded) not exactInputSingle.
    function _swapToken1ForToken0(uint256 amountIn) internal returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        token1.forceApprove(address(swapRouter), amountIn);
        amountOut = swapRouter.exactInput(
            IUniswapV3SwapRouter.ExactInputParams({
                path:             abi.encodePacked(address(token1), fee, address(token0)),
                recipient:        address(this),
                deadline:         block.timestamp + 60,
                amountIn:         amountIn,
                amountOutMinimum: _calcAmountOutMin1For0(amountIn)
            })
        );
        emit TokensSwappedForRebalance(amountIn, amountOut, false);
    }

    /// @dev Core rebalance logic — called by rebalance() and performUpkeep().
    ///      Must only be invoked after nonReentrant / whenNotPaused / role checks.
    function _performRebalance() internal {
        // Refuse to rebalance when spot has drifted from TWAP — otherwise an
        // attacker can pump the price into our range boundary, force a rebalance,
        // and sandwich the ratio-swap that follows.
        _requireSpotNearTwap();

        int24 oldLower = currentTickLower;
        int24 oldUpper = currentTickUpper;

        // 1. Collect fees before removing
        (uint256 fees0, uint256 fees1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId:    positionTokenId,
                recipient:  address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        totalFeesCollected0 += fees0;
        totalFeesCollected1 += fees1;

        // 2. Remove all liquidity — slippage-protected: derive min amounts from the
        //    same spot sqrtPrice the position manager will use for the burn quote.
        //    Combined with the TWAP-derived swap floor below, this stops a flash-swap
        //    from making the rebalance's exit price arbitrarily bad.
        (,,,,,,, uint128 currentLiquidity,,,, ) = positionManager.positions(positionTokenId);
        if (currentLiquidity > 0) {
            (uint160 _decSqrt,,,,,) = pool.slot0();
            (uint256 _decEst0, uint256 _decEst1) = LiquidityAmounts.getAmountsForLiquidity(
                _decSqrt,
                TickMath.getSqrtRatioAtTick(oldLower),
                TickMath.getSqrtRatioAtTick(oldUpper),
                currentLiquidity
            );
            positionManager.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId:    positionTokenId,
                    liquidity:  currentLiquidity,
                    amount0Min: _decEst0 * (10000 - slippageBps) / 10000,
                    amount1Min: _decEst1 * (10000 - slippageBps) / 10000,
                    deadline:   block.timestamp + 60
                })
            );
            positionManager.collect(
                INonfungiblePositionManager.CollectParams({
                    tokenId:    positionTokenId,
                    recipient:  address(this),
                    amount0Max: type(uint128).max,
                    amount1Max: type(uint128).max
                })
            );
        }

        // 3. Burn old position NFT
        positionManager.burn(positionTokenId);
        positionActive = false;

        // 4. Calculate new optimal range using TWAP
        (int24 newTickLower, int24 newTickUpper) = _calcOptimalRange();

        // 5. Iterative delta-neutral ratio rebalancing
        _rebalanceTokenRatio(newTickLower, newTickUpper);

        // 6. Re-add liquidity at new range with slippage protection
        uint256 bal0 = token0.balanceOf(address(this));
        uint256 bal1 = token1.balanceOf(address(this));

        if (bal0 > 0 || bal1 > 0) {
            token0.forceApprove(address(positionManager), bal0);
            token1.forceApprove(address(positionManager), bal1);

            (uint160 sqrtPriceX96,,,,,) = pool.slot0();
            uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(newTickLower);
            uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(newTickUpper);

            uint128 estLiquidity = LiquidityAmounts.getLiquidityForAmounts(
                sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, bal0, bal1
            );
            (uint256 est0, uint256 est1) = LiquidityAmounts.getAmountsForLiquidity(
                sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, estLiquidity
            );

            (uint256 newTokenId,,,) = positionManager.mint(
                INonfungiblePositionManager.MintParams({
                    token0:         address(token0),
                    token1:         address(token1),
                    fee:            fee,
                    tickLower:      newTickLower,
                    tickUpper:      newTickUpper,
                    amount0Desired: bal0,
                    amount1Desired: bal1,
                    amount0Min:     est0 * (10000 - slippageBps) / 10000,
                    amount1Min:     est1 * (10000 - slippageBps) / 10000,
                    recipient:      address(this),
                    deadline:       block.timestamp + 60
                })
            );

            positionTokenId  = newTokenId;
            positionActive   = true;
            currentTickLower = newTickLower;
            currentTickUpper = newTickUpper;
        }

        rebalanceCount++;
        lastRebalanceTimestamp = block.timestamp;

        emit Rebalanced(oldLower, oldUpper, newTickLower, newTickUpper, fees0, fees1);
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    function _decreaseLiquidity(uint128 liquidity) internal {
        (uint160 sqrtPriceX96,,,,,) = pool.slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(currentTickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(currentTickUpper);
        (uint256 est0, uint256 est1) = LiquidityAmounts.getAmountsForLiquidity(
            sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, liquidity
        );

        positionManager.decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId:    positionTokenId,
                liquidity:  liquidity,
                amount0Min: est0 * (10000 - slippageBps) / 10000,
                amount1Min: est1 * (10000 - slippageBps) / 10000,
                deadline:   block.timestamp + 60
            })
        );
    }

    function _collectPositionFees(address recipient) internal returns (uint256 fees0, uint256 fees1) {
        (fees0, fees1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId:    positionTokenId,
                recipient:  recipient,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        totalFeesCollected0 += fees0;
        totalFeesCollected1 += fees1;
        emit FeesCollected(fees0, fees1);
    }

    // ── Gelato / Chainlink Automation compatibility ───────────────────────────
    // Implements the standard AutomationCompatible interface so the contract can
    // be registered with either Gelato (resolver / custom logic) or Chainlink
    // Automation (forwarder-based) with zero off-chain changes.
    //
    // Gelato usage:
    //   1. Deploy this contract.
    //   2. Create a Gelato task targeting checkUpkeep on this address.
    //   3. Gelato will call performUpkeep when checkUpkeep returns (true, "").
    //
    // Chainlink Automation usage:
    //   1. Register contract at automation.chain.link with this address.
    //   2. The Automation Registry calls checkUpkeep off-chain every block.
    //   3. When true is returned it calls performUpkeep on-chain.
    //
    // The KEEPER_ROLE is granted to the Gelato/Chainlink forwarder address after
    // registration so that performUpkeep is permissioned.

    /// @notice Off-chain simulation — returns true when a rebalance is needed.
    /// @dev    Compatible with Chainlink AutomationCompatibleInterface.checkUpkeep
    ///         and Gelato resolver pattern.
    function checkUpkeep(bytes calldata /* checkData */)
        external
        view
        returns (bool upkeepNeeded, bytes memory performData)
    {
        upkeepNeeded = !paused() && this.shouldRebalance();
        performData  = ""; // no extra data needed; rebalance() reads state itself
    }

    /// @notice On-chain execution — triggers rebalance.
    /// @dev    Called by Gelato/Chainlink forwarder wallet (must hold KEEPER_ROLE).
    function performUpkeep(bytes calldata /* performData */)
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (!this.shouldRebalance()) revert NotInRange();
        // Delegate to internal rebalance logic (avoids duplicating access-control check)
        _performRebalance();
    }

    /// @notice Collect fees and compound back into position — Gelato hourly task.
    /// @dev    Separate from performUpkeep so Gelato can schedule this independently
    ///         (e.g. every hour) while rebalancing runs on shouldRebalance trigger.
    function checkCompound(bytes calldata)
        external
        view
        returns (bool upkeepNeeded, bytes memory performData)
    {
        // Compound if position is active and at least 1 hour since last action
        upkeepNeeded = positionActive
            && !paused()
            && (block.timestamp - lastRebalanceTimestamp >= 1 hours || lastRebalanceTimestamp == 0);
        performData  = "";
    }
}
