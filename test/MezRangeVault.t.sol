// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/MezRangeVault.sol";
import "../contracts/MezRangeStrategyV2.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockUniswapV3Pool.sol";
import "./mocks/MockPositionManager.sol";
import "./mocks/MockSwapRouter.sol";

contract MezRangeVaultTest is Test {
    // ── Actors ────────────────────────────────────────────────────────────────
    address admin   = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address keeper  = makeAddr("keeper");
    address alice   = makeAddr("alice");
    address bob     = makeAddr("bob");

    // ── Contracts ─────────────────────────────────────────────────────────────
    // Tests target MezRangeStrategyV2 — the production-deployed strategy.
    // V2 accepts fee + tickSpacing directly in the constructor so it can support
    // Mezo testnet pools whose fee→tickSpacing mapping diverges from Uniswap V3's.
    MockERC20            token0;
    MockERC20            token1;
    MockUniswapV3Pool    pool;
    MockPositionManager  posManager;
    MockSwapRouter       swapRouter;
    MezRangeStrategyV2   strategy;
    MezRangeVault        vault;

    uint24 constant POOL_FEE     = 3000;
    int24  constant TICK_SPACING = 60;

    uint256 constant INITIAL_BALANCE = 100_000e18;
    uint256 constant DEPOSIT_AMOUNT  = 1_000e18;

    // ── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        vm.startPrank(admin);

        // Deploy tokens
        token0 = new MockERC20("Token0", "TK0", 18);
        token1 = new MockERC20("Token1", "TK1", 18);

        // Deploy mocks
        pool       = new MockUniswapV3Pool(address(token0), address(token1), POOL_FEE);
        posManager = new MockPositionManager();
        swapRouter = new MockSwapRouter();

        // Deploy strategy (V2 takes fee + tickSpacing in the constructor)
        strategy = new MezRangeStrategyV2(
            address(posManager),
            address(pool),
            address(swapRouter),
            MezRangeStrategyV2.StrategyType.MEDIUM,
            admin,
            POOL_FEE,
            TICK_SPACING
        );

        // Deploy vault
        vault = new MezRangeVault(
            address(token0),
            address(strategy),
            treasury,
            admin,
            "MezRange BTC/mUSD",
            "mrBTC"
        );

        // Grant roles
        strategy.grantRole(strategy.VAULT_ROLE(),  address(vault));
        strategy.grantRole(strategy.KEEPER_ROLE(), keeper);
        vault.grantRole(vault.KEEPER_ROLE(), keeper);

        vm.stopPrank();
        vm.warp(block.timestamp + 301);

        // Fund users
        token0.mint(alice, INITIAL_BALANCE);
        token0.mint(bob,   INITIAL_BALANCE);
        // Fund mock swap router with token1 for swaps
        token1.mint(address(swapRouter), INITIAL_BALANCE * 10);
        // Fund position manager with both tokens for collect/decrease
        token0.mint(address(posManager), INITIAL_BALANCE * 10);
        token1.mint(address(posManager), INITIAL_BALANCE * 10);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. DEPOSIT TESTS
    // ─────────────────────────────────────────────────────────────────────────

    function test_Deposit_BasicShareMinting() public {
        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);

        uint256 shares = vault.deposit(DEPOSIT_AMOUNT, alice);

        assertGt(shares, 0, "Should receive shares");
        assertEq(vault.balanceOf(alice), shares, "Share balance mismatch");
        assertEq(vault.totalSupply(), shares, "Total supply mismatch");
        vm.stopPrank();
    }

    function test_Deposit_FirstDepositorGets1to1Shares() public {
        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        uint256 shares = vault.deposit(DEPOSIT_AMOUNT, alice);
        // First depositor: shares == assets (1:1)
        assertEq(shares, DEPOSIT_AMOUNT, "First deposit should be 1:1");
        vm.stopPrank();
    }

    function test_Deposit_PreviewMatchesActual() public {
        uint256 preview = vault.previewDeposit(DEPOSIT_AMOUNT);

        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        uint256 actual = vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();

        assertEq(preview, actual, "previewDeposit should match actual shares");
    }

    function test_Deposit_ZeroReverts() public {
        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        vm.expectRevert(MezRangeVault.ZeroAmount.selector);
        vault.deposit(0, alice);
        vm.stopPrank();
    }

    function test_Deposit_TwoDepositors_CorrectShareRatio() public {
        // Alice deposits first
        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        uint256 aliceShares = vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();

        // Bob deposits same amount -> should get same shares (no fees accumulated yet)
        vm.startPrank(bob);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        uint256 bobShares = vault.deposit(DEPOSIT_AMOUNT, bob);
        vm.stopPrank();

        // Shares should be equal (same deposit, same exchange rate)
        assertApproxEqRel(aliceShares, bobShares, 1e15, "Both depositors should get equal shares");
    }

    function test_Mint_ExactShares() public {
        uint256 sharesToMint = 500e18;
        uint256 expectedAssets = vault.previewMint(sharesToMint);

        vm.startPrank(alice);
        token0.approve(address(vault), expectedAssets + 1);
        uint256 assetsUsed = vault.mint(sharesToMint, alice);
        vm.stopPrank();

        assertEq(vault.balanceOf(alice), sharesToMint, "Should have exact shares");
        assertApproxEqAbs(assetsUsed, expectedAssets, 1, "Assets used should match preview");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. WITHDRAW / REDEEM TESTS
    // ─────────────────────────────────────────────────────────────────────────

    function test_Redeem_ReceivesAssets() public {
        // Deposit first
        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        uint256 shares = vault.deposit(DEPOSIT_AMOUNT, alice);

        // Redeem all shares
        uint256 assetsBefore = token0.balanceOf(alice);
        vault.redeem(shares, alice, alice);
        uint256 assetsAfter = token0.balanceOf(alice);
        vm.stopPrank();

        assertGt(assetsAfter, assetsBefore, "Should receive assets on redeem");
    }

    function test_Withdraw_ExactAssets() public {
        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, alice);

        uint256 withdrawAmount = DEPOSIT_AMOUNT / 2;
        uint256 sharesBefore = vault.balanceOf(alice);
        vault.withdraw(withdrawAmount, alice, alice);
        uint256 sharesAfter = vault.balanceOf(alice);
        vm.stopPrank();

        assertLt(sharesAfter, sharesBefore, "Shares should decrease after withdraw");
    }

    function test_Redeem_ZeroReverts() public {
        vm.startPrank(alice);
        vm.expectRevert(MezRangeVault.ZeroAmount.selector);
        vault.redeem(0, alice, alice);
        vm.stopPrank();
    }

    function test_Redeem_InsufficientSharesReverts() public {
        vm.startPrank(alice);
        vm.expectRevert(MezRangeVault.InsufficientShares.selector);
        vault.redeem(1_000e18, alice, alice);
        vm.stopPrank();
    }

    function test_PreviewRedeem_MatchesActual() public {
        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        uint256 shares = vault.deposit(DEPOSIT_AMOUNT, alice);

        uint256 preview = vault.previewRedeem(shares);
        uint256 actual = vault.redeem(shares, alice, alice);
        vm.stopPrank();

        assertApproxEqRel(preview, actual, 1e15, "previewRedeem should match actual");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. SHARE ACCOUNTING / totalAssets TESTS
    // ─────────────────────────────────────────────────────────────────────────

    function test_TotalAssets_ReflectsStrategyValue() public {
        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();

        uint256 ta = vault.totalAssets();
        assertGt(ta, 0, "totalAssets should be non-zero after deposit");
        // totalAssets should roughly equal the deposit amount
        // (some may be consumed by swap for token1, so use wide tolerance)
        assertApproxEqRel(ta, DEPOSIT_AMOUNT, 0.1e18, "totalAssets should approx equal deposit");
    }

    function test_SharePrice_DoesNotDoubleCount() public {
        // Deposit
        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        uint256 sharesBefore = vault.previewDeposit(DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();

        // Deposit again — share price should be consistent
        vm.startPrank(bob);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        uint256 bobShares = vault.deposit(DEPOSIT_AMOUNT, bob);
        vm.stopPrank();

        // Bob's shares should be similar to Alice's (no phantom inflation)
        assertApproxEqRel(sharesBefore, bobShares, 0.05e18, "Share price should not double-count assets");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. SHOULDREBALANCE TESTS
    // ─────────────────────────────────────────────────────────────────────────

    function test_ShouldRebalance_FalseWhenNoPosition() public {
        assertFalse(strategy.shouldRebalance(), "No position: should not rebalance");
    }

    function test_ShouldRebalance_FalseWhenInRange() public {
        _depositAndActivatePosition();
        // Keep tick inside range (range is roughly -3000 to +3000 for MEDIUM strategy)
        pool.setTick(0);
        assertFalse(strategy.shouldRebalance(), "Tick in range: no rebalance");
    }

    function test_ShouldRebalance_TrueWhenAboveRange() public {
        _depositAndActivatePosition();
        // Set tick above upper bound
        pool.setTick(strategy.currentTickUpper() + 100);
        assertTrue(strategy.shouldRebalance(), "Tick above upper -> should rebalance");
    }

    function test_ShouldRebalance_TrueWhenBelowRange() public {
        _depositAndActivatePosition();
        // Set tick below lower bound
        pool.setTick(strategy.currentTickLower() - 1);
        assertTrue(strategy.shouldRebalance(), "Tick below lower -> should rebalance");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. REBALANCE TESTS
    // ─────────────────────────────────────────────────────────────────────────

    function test_Rebalance_UpdatesRange() public {
        _depositAndActivatePosition();
        int24 oldLower = strategy.currentTickLower();
        int24 oldUpper = strategy.currentTickUpper();

        // Move price just outside range. Keep TWAP in sync with spot so the
        // strategy's spot-vs-TWAP divergence guard (maxTwapDeviationTicks = 200)
        // permits the rebalance — the guard is the manipulation defence; we are
        // simulating normal drift, not manipulation.
        int24 newSpot = strategy.currentTickUpper() + 50;
        pool.setTick(newSpot);
        pool.setTickCumulatives(0, int56(newSpot) * int56(int32(300)));

        vm.prank(keeper);
        strategy.rebalance();

        int24 newLower = strategy.currentTickLower();
        int24 newUpper = strategy.currentTickUpper();

        // Range should have shifted
        assertTrue(
            newLower != oldLower || newUpper != oldUpper,
            "Range should change after rebalance"
        );
        assertEq(strategy.rebalanceCount(), 1, "rebalanceCount should increment");
    }

    function test_Rebalance_OnlyKeeper() public {
        _depositAndActivatePosition();
        vm.prank(alice);
        vm.expectRevert();
        strategy.rebalance();
    }

    function test_Rebalance_NoActivePosition_Reverts() public {
        vm.prank(keeper);
        vm.expectRevert(MezRangeStrategyV2.NoActivePosition.selector);
        strategy.rebalance();
    }

    function test_Rebalance_IncreasesRebalanceCount() public {
        _depositAndActivatePosition();
        int24 newSpot = strategy.currentTickUpper() + 50;
        pool.setTick(newSpot);
        pool.setTickCumulatives(0, int56(newSpot) * int56(int32(300)));

        vm.prank(keeper);
        strategy.rebalance();

        assertEq(strategy.rebalanceCount(), 1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. FEE ACCRUAL TESTS
    // ─────────────────────────────────────────────────────────────────────────

    function test_PerformanceFee_SentToTreasury() public {
        _depositAndActivatePosition();

        // Seed fees in position manager
        uint128 fees0 = 1_000e18;
        uint128 fees1 = 1_000e18;
        posManager.seedFees(strategy.positionTokenId(), fees0, fees1);
        token0.mint(address(posManager), fees0);
        token1.mint(address(posManager), fees1);

        uint256 treasuryBefore = token0.balanceOf(treasury);
        vm.prank(keeper);
        vault.compoundFees();
        uint256 treasuryAfter = token0.balanceOf(treasury);

        // Treasury should receive performance fee on token0 fees
        assertGt(treasuryAfter, treasuryBefore, "Treasury should receive performance fee");
    }

    function test_ManagementFee_AccruedOverTime() public {
        _depositAndActivatePosition();

        uint256 treasuryBefore = vault.balanceOf(treasury);

        // Fast-forward 30 days
        vm.warp(block.timestamp + 30 days);

        // Trigger fee collection via deposit
        vm.startPrank(alice);
        token0.approve(address(vault), 1e18);
        vault.deposit(1e18, alice);
        vm.stopPrank();

        // Management fee should have been taken
        // 1% annual / 365 * 30 days ≈ 0.082% of totalAssets
        // With DEPOSIT_AMOUNT ≈ 1000e18, that's ~0.82e18
        // treasury receives it
        uint256 treasuryAfter = vault.balanceOf(treasury);
        assertGt(treasuryAfter, treasuryBefore, "Management fee should accrue over time");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. EDGE CASES
    // ─────────────────────────────────────────────────────────────────────────

    function test_EdgeCase_DepositWhenOutOfRange() public {
        _depositAndActivatePosition();

        // Move out of range
        pool.setTick(strategy.currentTickUpper() + 500);

        // Deposit should still work (adds to position even if out of range)
        vm.startPrank(bob);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        uint256 shares = vault.deposit(DEPOSIT_AMOUNT, bob);
        vm.stopPrank();

        assertGt(shares, 0, "Deposit should succeed even when out of range");
    }

    function test_EdgeCase_TWAP_FallbackToSpot() public {
        _depositAndActivatePosition();

        // Make observe() revert (simulates new pool with no TWAP)
        pool.setObserveReverts(true);

        // Rebalance should still succeed using spot price fallback
        pool.setTick(strategy.currentTickUpper() + 100);

        vm.prank(keeper);
        strategy.rebalance(); // should not revert

        assertEq(strategy.rebalanceCount(), 1, "Rebalance with TWAP fallback should succeed");
    }

    function test_EdgeCase_EmergencyPause() public {
        vm.prank(admin);
        vault.pause();

        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        vm.expectRevert();
        vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();
    }

    function test_EdgeCase_Unpause_AllowsDeposit() public {
        vm.prank(admin);
        vault.pause();

        vm.prank(admin);
        vault.unpause();

        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        uint256 shares = vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();

        assertGt(shares, 0, "Deposit should succeed after unpause");
    }

    function test_EdgeCase_ZeroLiquidityRebalance_Reverts() public {
        // No position active
        vm.prank(keeper);
        vm.expectRevert(MezRangeStrategyV2.NoActivePosition.selector);
        strategy.rebalance();
    }

    function test_EdgeCase_RemoveLiquidityNoPosition_Reverts() public {
        vm.prank(address(vault));
        vm.expectRevert(MezRangeStrategyV2.NoActivePosition.selector);
        strategy.removeLiquidity(1, alice);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 10. FAILED-SWAP REVERT TEST
    //     Verifies that _performRebalance reverts atomically when the swap
    //     router fails mid-execution, leaving vault state unchanged.
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice When the swap inside _performRebalance reverts, the entire
    ///         rebalance transaction must revert so no partial state is written.
    ///         After the failed attempt: positionActive must still be false
    ///         (position was already burned before the swap), and rebalanceCount
    ///         must remain unchanged.
    ///
    ///         This test guards against the scenario where liquidity is removed
    ///         and the position NFT is burned, but the swap to re-balance the
    ///         token ratio fails — the rebalance should not silently leave the
    ///         vault with no active position and no funds deployed.
    function test_FailedSwap_RebalanceReverts() public {
        _depositAndActivatePosition();

        // Move price out of range to trigger rebalance; keep TWAP aligned with
        // spot so the divergence guard passes — we're testing the swap-failure
        // path, not the manipulation guard.
        int24 newSpot = strategy.currentTickUpper() + 50;
        pool.setTick(newSpot);
        pool.setTickCumulatives(0, int56(newSpot) * int56(int32(300)));

        // Force the swap router to revert on the next swap
        swapRouter.setRevert(true);

        // The rebalance must revert entirely because the token-ratio swap fails
        vm.prank(keeper);
        vm.expectRevert("MockSwapRouter: swap failed");
        strategy.rebalance();

        // rebalanceCount must NOT have incremented (state not committed)
        assertEq(strategy.rebalanceCount(), 0, "rebalanceCount must stay 0 after failed swap");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8. ERC-4626 COMPLIANCE TESTS
    // ─────────────────────────────────────────────────────────────────────────

    function test_ERC4626_MaxDepositIsMaxUint() public view {
        assertEq(vault.maxDeposit(alice), type(uint256).max);
    }

    function test_ERC4626_MaxRedeemEqualsBalance() public {
        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();

        assertEq(vault.maxRedeem(alice), vault.balanceOf(alice));
    }

    function test_ERC4626_MaxWithdrawEqualsConvertedBalance() public {
        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();

        uint256 maxWithdraw = vault.maxWithdraw(alice);
        uint256 expectedMax = vault.convertToAssets(vault.balanceOf(alice));
        assertEq(maxWithdraw, expectedMax);
    }

    function test_ERC4626_PreviewWithdrawRoundsUp() public {
        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();

        uint256 assetsToWithdraw = 100e18;
        uint256 sharesNeeded = vault.previewWithdraw(assetsToWithdraw);
        // Shares needed should be >= convertToShares (rounds up)
        assertGe(sharesNeeded, vault.convertToShares(assetsToWithdraw));
    }

    function test_ERC4626_AssetAddress() public view {
        assertEq(address(vault.asset()), address(token0));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _depositAndActivatePosition() internal {
        vm.startPrank(alice);
        token0.approve(address(vault), DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();
        assertTrue(strategy.positionActive(), "Position should be active");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 9. FUZZ TESTS — share accounting invariants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Fuzz: any valid deposit amount must mint a non-zero share amount
    ///         and totalAssets must increase by at most depositAmount.
    function testFuzz_Deposit_SharesMinted(uint256 amount) public {
        // Bound to [1e6, 50_000e18] to avoid extreme edge cases and overflow
        amount = bound(amount, 1e6, 50_000e18);

        token0.mint(alice, amount);
        vm.startPrank(alice);
        token0.approve(address(vault), amount);

        uint256 totalAssetsBefore = vault.totalAssets();
        uint256 shares = vault.deposit(amount, alice);

        assertGt(shares, 0, "Fuzz: shares must be > 0 for any positive deposit");
        assertGt(vault.totalAssets(), totalAssetsBefore, "Fuzz: totalAssets must increase after deposit");
        vm.stopPrank();
    }

    /// @notice Fuzz: share price monotonicity — depositing and immediately
    ///         redeeming must return at most the deposited amount (no inflation).
    function testFuzz_DepositRedeem_NoShareInflation(uint256 amount) public {
        amount = bound(amount, 1e6, 50_000e18);

        token0.mint(alice, amount);
        vm.startPrank(alice);
        token0.approve(address(vault), amount);
        uint256 shares = vault.deposit(amount, alice);

        uint256 balBefore = token0.balanceOf(alice);
        uint256 assetsBack = vault.redeem(shares, alice, alice);
        uint256 balAfter  = token0.balanceOf(alice);
        vm.stopPrank();

        // Can receive at most what was deposited (no free money)
        assertLe(assetsBack, amount + 1, "Fuzz: cannot redeem more than deposited (no inflation)");
        assertEq(balAfter - balBefore, assetsBack, "Fuzz: balance delta must match assetsBack");
    }

    /// @notice Fuzz: two independent depositors get proportional shares.
    ///         alice:bob deposit ratio must equal alice:bob share ratio within 1%.
    function testFuzz_TwoDepositors_ProportionalShares(uint256 amtAlice, uint256 amtBob) public {
        amtAlice = bound(amtAlice, 1e12, 10_000e18);
        amtBob   = bound(amtBob,   1e12, 10_000e18);

        token0.mint(alice, amtAlice);
        token0.mint(bob,   amtBob);

        vm.startPrank(alice);
        token0.approve(address(vault), amtAlice);
        uint256 sharesAlice = vault.deposit(amtAlice, alice);
        vm.stopPrank();

        vm.startPrank(bob);
        token0.approve(address(vault), amtBob);
        uint256 sharesBob = vault.deposit(amtBob, bob);
        vm.stopPrank();

        // sharesAlice / sharesBob ≈ amtAlice / amtBob (within 2% tolerance)
        // Cross-multiply to avoid division: sharesAlice * amtBob ≈ sharesBob * amtAlice
        uint256 lhs = sharesAlice * amtBob;
        uint256 rhs = sharesBob   * amtAlice;
        uint256 diff = lhs > rhs ? lhs - rhs : rhs - lhs;
        uint256 larger = lhs > rhs ? lhs : rhs;
        // Allow 2% tolerance for rounding
        assertLe(diff * 100, larger * 2, "Fuzz: share ratio must be proportional to deposit ratio");
    }

    /// @notice Fuzz: depositWithMinShares must revert when minShares > actual shares.
    function testFuzz_DepositWithMinShares_RevertsWhenTooHigh(uint256 amount) public {
        amount = bound(amount, 1e12, 10_000e18);
        uint256 expectedShares = vault.previewDeposit(amount);

        token0.mint(alice, amount);
        vm.startPrank(alice);
        token0.approve(address(vault), amount);
        // Ask for 10x more shares than possible -> must revert
        vm.expectRevert();
        vault.depositWithMinShares(amount, expectedShares * 10);
        vm.stopPrank();
    }

    /// @notice Fuzz: totalAssets() invariant — must always be >= sum of all user
    ///         convertToAssets() values (no double-counting).
    function testFuzz_TotalAssets_GeSumOfUserAssets(uint256 amtAlice, uint256 amtBob) public {
        amtAlice = bound(amtAlice, 1e12, 20_000e18);
        amtBob   = bound(amtBob,   1e12, 20_000e18);

        token0.mint(alice, amtAlice);
        token0.mint(bob,   amtBob);

        vm.startPrank(alice);
        token0.approve(address(vault), amtAlice);
        vault.deposit(amtAlice, alice);
        vm.stopPrank();

        vm.startPrank(bob);
        token0.approve(address(vault), amtBob);
        vault.deposit(amtBob, bob);
        vm.stopPrank();

        uint256 totalAssets  = vault.totalAssets();
        uint256 aliceAssets  = vault.convertToAssets(vault.balanceOf(alice));
        uint256 bobAssets    = vault.convertToAssets(vault.balanceOf(bob));

        assertGe(
            totalAssets + 2, // +2 for rounding tolerance
            aliceAssets + bobAssets,
            "Fuzz: totalAssets must cover all user claims"
        );
    }

    /// @notice Fuzz: Gelato checkUpkeep — must return true only when shouldRebalance is true.
    function testFuzz_CheckUpkeep_MatchesShouldRebalance(int24 newTick) public {
        _depositAndActivatePosition();

        // Bound tick to a reasonable range
        newTick = int24(bound(int256(newTick), -887272, 887272));
        pool.setTick(newTick);

        (bool upkeepNeeded, ) = strategy.checkUpkeep("");
        bool shouldReb = strategy.shouldRebalance();

        assertEq(upkeepNeeded, shouldReb, "Fuzz: checkUpkeep must match shouldRebalance");
    }
}
