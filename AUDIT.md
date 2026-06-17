# MezRange — Deposit Failure Audit & 3-Project Bounty Comparison

**Date:** 2026-06-17
**Scope:** Why deposits revert on `mezrange` (this repo), how the two other bounty
submissions compare, and the fixes applied here.
**Network:** Mezo Testnet (chainId `31611`), all evidence gathered live via `cast`.

---

## TL;DR

Deposits to every MezRange vault revert. There are **two independent root causes**, both
confirmed on-chain:

1. **Wrong DEX interface.** Mezo's DEX is a **Velodrome Slipstream–style concentrated-liquidity
   fork, not vanilla Uniswap V3.** Its `NonfungiblePositionManager.mint` expects
   `int24 tickSpacing` (not `uint24 fee`) plus a trailing `uint160 sqrtPriceX96`. MezRange
   encoded Uniswap-V3 `MintParams`, so the mint calldata is misaligned and **every mint reverts.**
   It also pointed at the wrong PM address (`0x9B753e11…`); the canonical Mezo PM is
   `0x509Bc221df2B83927c695FA0bb0f5B21053C874c`.

2. **Forced swap on a shallow pool.** The single-sided deposit path swaps ~50% of the deposit
   through the pool before minting. Mezo's testnet pools are tiny (MUSD/BTC-50 holds
   `~1.68e17` liquidity), so the swap either can't fill (`require(amount0Delta==amountIn)` →
   *"swap input mismatch"*) or executes below the TWAP floor (`SlippageExceeded`).

Result: **all three MezRange vaults have `totalSupply == 0` — no deposit has ever succeeded.**

The one bounty submission that **works** (Project B) avoids both problems: it uses the correct
Slipstream CL interface + PM, and supports dual-token deposits so it never force-swaps.

---

## On-chain evidence

Simulated a real deposit from the keeper wallet `0x03ffb3720214bDB0DB5F5F71b6cE16B008f762d2`
(holds 2,763 MUSD), overriding only the MUSD→vault allowance:

| Deposit | Result |
|---|---|
| `depositWithMinShares(1 MUSD, 0)` | revert `SlippageExceeded()` (`0x8199f5f3`) |
| `depositWithMinShares(10 MUSD, 0)` | revert `"Strategy: swap input mismatch"` |
| `depositWithMinShares(50 MUSD, 0)` | revert `"Strategy: swap input mismatch"` |
| `depositDual(…, amount1>0, …)` | revert `0x` — deployed strategy lacks `getTwapTick()` |

`slot0()` returns **6 fields (192 bytes)** — Mezo omits Uniswap V3's `uint8 feeProtocol`.
Pool liquidity: MUSD/BTC-50 `1.68e17`, MUSD/MEZO-200 `5.16e18`, MUSD/BTC-10 `2.56e21`.

The live deployed **strategy and vault are also mismatched builds** (strategy predates
`getTwapTick()` while the vault's `depositDual` calls it) — so even the intended dual-deposit
workaround reverts on the current deployment.

---

## 3-Project comparison

| | **A — mezrange** (this repo, `enkethomassen`) | **B — `MananSinghal123/range`** | **C — `Demiladepy/mezorange`** |
|---|---|---|---|
| Live vault | 3 vaults, all `totalSupply=0` | `0x3C65B63B…` `totalSupply=1.23e18`, **~110 MUSD** | `0x520a8466…` `totalSupply=0`, `totalAssets` reverts |
| **Deposits work on-chain?** | ❌ No | ✅ **Yes** | ❌ No (pool liquidity `0`) |
| DEX interface | ❌ Uniswap V3 (`fee`) | ✅ Slipstream CL (`tickSpacing` + `sqrtPriceX96`) | CL-aware, but pool never seeded |
| Position manager | ❌ `0x9B753e11…` (wrong) | ✅ `0x509Bc221…` (canonical) | uses CL PM |
| Swap for ratio | forced 50% swap on thin pool | CL router + minimal ratio swap; `depositToken1` path | n/a |
| Dual / single-sided deposit | single-sided default (breaks) | ✅ both (`deposit` + `depositToken1`) | single |
| Architecture | ERC-4626, keeper, timelock, 43 tests | Upgradeable + factory + Lens + keeper | factory + keeper + subgraph |

**Closest to working: Project B — and it actually works.** Its decisive advantages are exactly
the two fixes this PR ports into MezRange: the **correct Slipstream CL ABI/PM**, and a
**dual-token deposit path that avoids force-swapping on shallow pools**.

Project C is architecturally reasonable but its CL pool (`0xB34cAF03…`) has **zero liquidity**
and `totalAssets()` reverts, so it is non-functional today.

---

## The fix that makes deposits work (ported from Project B)

Project B's deposits succeed because **`deposit()` never touches the pool** — it takes token0,
mints shares, and leaves funds **idle** in the vault; the keeper deploys idle funds into the LP
later. A user deposit therefore cannot revert on a shallow-pool swap/mint.

This PR adopts the same architecture:

- `MezRangeVault.deposit()` / `mint()` / `depositDual()` **no longer call `strategy.addLiquidity()`**.
  They transfer the token(s) in, mint shares, and hold funds idle. `totalAssets()` already counts
  idle vault balances, so share pricing stays exact.
- New `MezRangeVault.deployIdle()` (`KEEPER_ROLE`) batches idle balances into the LP position.
  The keeper may pre-fund token1 to skip the swap entirely (dual deployment).
- The keeper bot calls `deployIdle()` on poll cycles (best-effort, isolated from the rebalance
  backoff so a shallow-pool revert never stalls rebalancing).

Net effect: **single-sided MUSD deposits now succeed regardless of pool depth** — the original
"users cannot deposit" symptom is fixed at the contract level, exactly as Project B does it.

## Other fixes in this PR

**Contracts**
- `interfaces/INonfungiblePositionManager.sol` — `MintParams` now uses `int24 tickSpacing`
  (was `uint24 fee`) and appends `uint160 sqrtPriceX96`; `positions()` returns `int24 tickSpacing`.
  Matches Mezo's Slipstream PM ABI.
- `MezRangeStrategyV2.sol`
  - both `mint` calls pass `tickSpacing` + `sqrtPriceX96: 0`.
  - `addLiquidity` **no longer swaps when both tokens are supplied** (dual deposit) — it respects
    the caller's ratio and lets `mint` consume what fits. Ratio-optimising swaps run **only** for
    single-sided deposits.
  - `_swapToken0ForToken1` / `_swapToken1ForToken0` **tolerate partial fills** — the slippage
    floor is enforced against the amount actually swapped instead of hard-reverting on a partial
    fill (removes the *"swap input mismatch"* revert).

**Config / frontend**
- `POSITION_MANAGER` default and `deployedContracts.ts` updated to the canonical CL PM
  `0x509Bc221df2B83927c695FA0bb0f5B21053C874c`.
- `VaultModal` deposit UI **defaults to dual deposit** (the reliable path) with clear copy.

All 43 Foundry unit tests pass after these changes.

> Note: these contract changes are validated against the mock-based unit suite. End-to-end
> testing on a fork is **not possible** because Mezo's BTC/MEZO are chain precompiles that
> anvil does not replay — final validation must happen on a real testnet redeploy.

---

## Required to make the live site accept deposits (redeploy)

The on-chain contracts are immutable and were built against the wrong PM, so a **redeploy is
mandatory** — no code push alone can fix the live deployment.

```bash
# 1. Fill .env (DEPLOYER_PK, KEEPER_ADDRESS, TREASURY_ADDRESS).
#    POSITION_MANAGER is already set to the canonical CL PM in .env.example.
cp .env.example .env && $EDITOR .env

# 2. Deploy all three vaults (matched strategy+vault from current source).
forge script script/DeployTestnetDirect.s.sol:DeployTestnetDirect \
  --rpc-url https://rpc.test.mezo.org --broadcast -vvvv

# 3. Copy the printed strategy/vault addresses into src/data/deployedContracts.ts
#    (replace the stale ones), then redeploy the frontend.

# 4. Seed an initial dual deposit (MUSD + BTC) so the first position opens, then
#    verify: cast call <vault> 'totalSupply()(uint256)' -r https://rpc.test.mezo.org
```

After redeploy, deposits should use **Dual Deposit** (MUSD + BTC/MEZO) — the single-sided path
remains available but is unreliable on shallow testnet pools until liquidity deepens.
