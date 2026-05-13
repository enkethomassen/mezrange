# 🔐 Security Review — MezRange

---

## Scope

|                                  |                                                                        |
| -------------------------------- | ---------------------------------------------------------------------- |
| **Mode**                         | ALL                                                                    |
| **Files reviewed**               | `MezRangeVault.sol` · `MezRangeStrategyV2.sol`<br>`libraries/TickMath.sol` · `libraries/LiquidityAmounts.sol` |
| **Confidence threshold (1-100)** | 70                                                                     |

---

## Findings

[100] **1. `removeLiquidityAsToken0` Collects 100% of Pending Fees on Any Partial Withdrawal**

`MezRangeStrategyV2.removeLiquidityAsToken0` · Confidence: 100 · [agents: 2]

**Description**

`removeLiquidityAsToken0` called `_collectPositionFees(address(this))` with `amount0Max: type(uint128).max` and `amount1Max: type(uint128).max` after a partial liquidity decrease — draining 100% of all accumulated `tokensOwed` from the position regardless of the fraction of liquidity removed, so the first redeemer steals all pending fee income from every other depositor.

**Fix**

```diff
- _decreaseLiquidity(liquidity);
- (uint256 collected0, uint256 collected1) = _collectPositionFees(address(this));
+ uint256 bal0Before = token0.balanceOf(address(this));
+ uint256 bal1Before = token1.balanceOf(address(this));
+ _decreaseLiquidity(liquidity);
+ positionManager.collect(CollectParams({
+     tokenId: positionTokenId, recipient: address(this),
+     amount0Max: type(uint128).max, amount1Max: type(uint128).max
+ }));
+ uint256 collected0 = token0.balanceOf(address(this)) - bal0Before;
+ uint256 collected1 = token1.balanceOf(address(this)) - bal1Before;
```

**Status: FIXED** — Balance-delta approach now captures only tokens unlocked by the specific `decreaseLiquidity` call.

---

[90] **2. `_calcAmountOutMin0For1` Integer Overflow DoS on Large Deposits**

`MezRangeStrategyV2._calcAmountOutMin0For1` · Confidence: 90 · [agents: 2]

**Description**

`(amountIn * uint256(sqrtP)) >> 96` overflows `uint256` when `amountIn` is large and `sqrtP` is near `MAX_SQRT_RATIO` (~2^160): the product `amountIn * sqrtP` can exceed 2^256, causing a Solidity 0.8 checked-arithmetic panic revert that permanently blocks all `_swapToken0ForToken1` calls — blocking all deposits, rebalances, and ratio corrections.

**Fix**

```diff
- uint256 step1   = (amountIn * uint256(sqrtP)) >> 96;
- uint256 expected = (step1   * uint256(sqrtP)) >> 96;
+ uint256 expected = LiquidityAmounts.mulDiv(amountIn, uint256(sqrtP), Q96);
+ expected = LiquidityAmounts.mulDiv(expected, uint256(sqrtP), Q96);
```

**Status: FIXED** — Uses `mulDiv` (512-bit overflow-safe) mirroring the existing `_calcAmountOutMin1For0` fix.

---

[85] **3. `addLiquidity` Increase Path Missing `_requireSpotNearTwap()`**

`MezRangeStrategyV2.addLiquidity` · Confidence: 85 · [agents: 5]

**Description**

`addLiquidity` only called `_requireSpotNearTwap()` on the position-open path (`!positionActive`); on the increase path (`positionActive == true`) spot price was never validated, so an attacker could sandwich any permissionless `deposit()` call (which triggers `addLiquidity`) by pushing the pool spot within the 200-tick window, causing `_rebalanceTokenRatio` to compute a skewed ratio and minting LP at an unfavorable rate.

**Fix**

```diff
  if (!positionActive) {
      _requireMinPoolAge();
-     _requireSpotNearTwap();
  }
+ _requireSpotNearTwap();   // applies on both open and increase paths
```

**Status: FIXED** — `_requireSpotNearTwap()` now runs unconditionally for both open and increase paths.

---

[75] **4. Keeper Paths Use Spot Price for Slippage Min-Amounts (Sandwichable Within TWAP Window)**

`MezRangeStrategyV2.collectAndCompound` · `MezRangeStrategyV2._performRebalance` · Confidence: 75 · [agents: 2]

**Description**

Both `collectAndCompound` and `_performRebalance` derive `amount0Min`/`amount1Min` for `positionManager.increaseLiquidity`/`mint` from `pool.slot0()` (spot sqrtPrice); an attacker who controls a block can shift price up to `maxTwapDeviationTicks` (200 ticks ≈ 2%) before the keeper call, making the spot-derived min-amounts low enough that the LP mints at a manipulated ratio, capturing extra tokens from the vault at the expense of existing depositors.

> **Note:** Only KEEPER_ROLE callers can trigger these functions. Exploitation requires a compromised or colluding keeper. Recommend deriving min-amounts from `TickMath.getSqrtRatioAtTick(_getTwapTick())` rather than `pool.slot0()`.

---

[75] **5. `_getTwapTick` Sign-Heuristic False-Positive Corrupts All Valuations Near Tick Zero**

`MezRangeStrategyV2._getTwapTick` · Confidence: 75 · [agents: 4]

**Description**

The Mezo sign-correction `if ((twapTick > 0 && spotTick < 0) || (twapTick < 0 && spotTick > 0)) twapTick = -twapTick` fires incorrectly whenever normal price volatility causes TWAP and spot to straddle tick 0 (e.g. TWAP = −1, spot = +1 during normal movement near par), silently negating the TWAP result and feeding all downstream functions — `totalValue()`, `_calcOptimalRange()`, swap slippage floors — a wrong price. Recommend adding a magnitude threshold: only apply correction when `|twapTick| > someMinimumTicks`.

---

[70] **6. Strategy Idle `token1` Dust Inflates `totalAssets()` But Is Never Returned to Withdrawers**

`MezRangeStrategyV2.totalValue` · Confidence: 70 · [agents: 1]

**Description**

LP minting leaves token1 dust in the strategy (`token1.balanceOf(address(this))`) that is included in `totalValue()` / `totalAssets()` but is never swept out by `removeLiquidityAsToken0`, causing share price to appear higher than the redeemable amount and preventing depositors from fully claiming their entitled idle token1. Recommend that `removeLiquidityAsToken0` also sweep proportional idle token1 from the strategy after the decrease-and-collect.

---

[70] **7. `depositDual` Share Inflation via Fee-on-Transfer `token1`**

`MezRangeVault.depositDual` · Confidence: 70 · [agents: 1]

**Description**

`depositDual` computes `shares` from `amount1` before calling `safeTransferFrom`, so if `token1` is fee-on-transfer the vault receives less than `amount1` but mints shares against the pre-fee value, diluting all existing depositors. For the known token1 assets (MEZO, BTC) this is currently impractical, but recommend post-transfer balance checks if the vault is ever extended to other token pairs.

---

## Leads

_Vulnerability trails with concrete code smells where the full exploit path could not be completed in one analysis pass. These are not false positives — they are high-signal leads for manual review. Not scored._

- **Spot-Derived Min-Amounts in `collectAndCompound` Re-mint** — `MezRangeStrategyV2.collectAndCompound` — Code smells: `pool.slot0()` used for `estLiq`/`amount0Min`/`amount1Min` before `increaseLiquidity`; TWAP check allows 200-tick window — Only KEEPER_ROLE can trigger; confirm keeper key hardening in deployment; consider deriving all slippage floors from TWAP sqrtPrice.

- **`_performRebalance` Final Mint Uses Spot Price** — `MezRangeStrategyV2._performRebalance` — Code smells: `pool.slot0()` used on line ~822 for final `estLiquidity`/`amount0Min`/`amount1Min` in `positionManager.mint` — Full P&L extraction not traced due to KEEPER_ROLE requirement; recommend using TWAP sqrtPrice for all slippage computations in the rebalance path.

- **`TickMath.calcRange` Integer Division Noop** — `TickMath.calcRange` — Code smells: `(oneSidedBps * 10000) / 9999` truncates to same result as `oneSidedBps` for all current strategy widths — The stated log-approximation improvement is silently discarded by integer truncation; the formula is effectively unchanged from the previous linear version.

- **`_getTwapTick` Inverted-Cumulative Heuristic Brittleness** — `MezRangeStrategyV2._getTwapTick` — Code smells: sign-flip conditioned only on opposite-sign comparison with no magnitude threshold — Exact Mezo DEX oracle accumulator spec not independently verified; if the standard Uniswap V3 accumulator direction is used, the heuristic incorrectly negates valid TWAP ticks for any pool priced above par (tick > 0).

---

> ⚠️ This review was performed by an AI assistant. AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. Team security reviews, bug bounty programs, and on-chain monitoring are strongly recommended. For a consultation regarding your projects' security, visit [https://www.pashov.com](https://www.pashov.com)
