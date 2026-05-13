# MezRange — Automated LP Rebalancing Vaults for Mezo DEX

> **ERC-4626 compliant vaults that automatically manage concentrated Uniswap V3 liquidity positions on Mezo, maximizing fee earnings 24/7 without manual rebalancing.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-blue)](https://soliditylang.org)
[![Foundry](https://img.shields.io/badge/Built%20with-Foundry-orange)](https://book.getfoundry.sh/)

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Vault Strategies](#vault-strategies)
- [Fee Model](#fee-model)
- [Security](#security)
- [Smart Contracts](#smart-contracts)
- [Setup & Development](#setup--development)
- [Deployment](#deployment)
- [Running the Keeper Bot](#running-the-keeper-bot)
- [Frontend](#frontend)
- [Testing](#testing)

---

## Overview

MezRange allows users to deposit a single token and automatically earn concentrated liquidity fees on Mezo's Uniswap V3-compatible DEX. When the market price moves outside the configured range, the keeper bot triggers a rebalance that:

1. Collects all accrued fees
2. Closes the out-of-range position
3. Swaps tokens to achieve the optimal ratio for the new range (delta-neutral rebalancing)
4. Opens a new position centered on the current TWAP price

Users receive **share tokens (ERC-4626)** representing their proportional ownership of the vault.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      User (Browser)                          │
└─────────────────────────┬────────────────────────────────────┘
                          │  deposit(assets, receiver)
                          │  redeem(shares, receiver, owner)
┌─────────────────────────▼────────────────────────────────────┐
│               MezRangeVault  (ERC-4626)                      │
│                                                              │
│  - Full IERC4626: deposit/mint/withdraw/redeem               │
│  - Accurate totalAssets() via strategy.totalValue()          │
│  - Performance fee (10%) + Management fee (1% annual)        │
│  - previewDeposit / previewMint / previewWithdraw            │
│  - Role-based access: KEEPER_ROLE, EMERGENCY_ROLE            │
└─────────────────────────┬────────────────────────────────────┘
                          │  addLiquidity / removeLiquidity
                          │  collectAndCompound
                          │  (VAULT_ROLE required)
┌─────────────────────────▼────────────────────────────────────┐
│         MezRangeStrategyV2  (Liquidity Manager)              │
│                                                              │
│  - Integrates Uniswap V3 NonfungiblePositionManager          │
│  - addLiquidity: mints/increases position; auto-swaps 50%    │
│    of token0 to token1 for balanced deposit                  │
│  - removeLiquidity: proportional exit with slippage          │
│  - rebalance(): TWAP-based range recalc + delta-neutral      │
│    token ratio swap + slippage-protected mint                │
│  - totalValue(): returns token0-equivalent of all assets     │
│  - IERC721Receiver for safe NFT receipt                      │
│  - Slippage on all liquidity ops (configurable, default 0.5%)│
└─────────────────────────┬────────────────────────────────────┘
                          │  mint/increase/decrease/collect/burn
┌─────────────────────────▼────────────────────────────────────┐
│         Uniswap V3-compatible DEX on Mezo                    │
│         NonfungiblePositionManager + SwapRouter              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                  Keeper Bot (keeper/keeper.ts)                │
│                                                              │
│  - Polls shouldRebalance() every ~1 block (12s)              │
│  - Calls rebalance() via keeper wallet when triggered        │
│  - Compounds fees every hour via collectAndCompound()        │
│  - Exponential backoff on tx failure (max 5 min)             │
│  - Gas price guard (skips if > 50 gwei)                      │
│  - Monitors multiple strategy contracts simultaneously       │
└──────────────────────────────────────────────────────────────┘
```

---

## Vault Strategies

Three range widths are available at deployment. Users can select their preferred strategy:

| Strategy | Range Width | Rebalance Frequency | APY Profile |
|---|---|---|---|
| **TIGHT** | ±3% (600 bps) | High (price exits range frequently) | Highest fees earned per unit of liquidity |
| **MEDIUM** | ±10% (2000 bps) | Moderate | Balanced risk/reward |
| **WIDE** | ±30% (6000 bps) | Low | Fewer rebalances, lower fee capture |

The range is always centered on the **5-minute TWAP price** to prevent MEV manipulation of range boundaries.

---

## Fee Model

| Fee Type | Rate | Description |
|---|---|---|
| Performance Fee | 10% (configurable ≤ 20%) | Taken from fees collected during each `compoundFees()` call |
| Management Fee | 1% annual (configurable ≤ 2%) | Pro-rated per second, collected on each deposit/redeem |

Both fees are sent to the `treasury` address. Fee caps are enforced on-chain.

---

## Security

| Feature | Implementation |
|---|---|
| Reentrancy protection | `ReentrancyGuard` on all state-changing functions in both contracts |
| Role-based access control | `AccessControl`: `VAULT_ROLE`, `KEEPER_ROLE`, `EMERGENCY_ROLE`, `DEFAULT_ADMIN_ROLE` |
| Emergency pause | Both contracts implement `Pausable`; paused by `EMERGENCY_ROLE` |
| Slippage protection (deposits) | `previewDeposit` / `depositWithMinShares` |
| Slippage protection (rebalance mint) | TWAP-derived `amount0Min`/`amount1Min` on re-mint |
| Slippage protection (rebalance burn) | `decreaseLiquidity` uses sqrtPrice-derived min amounts with `slippageBps` floor |
| Slippage protection (compound) | `collectAndCompound.increaseLiquidity` uses derived `amount0Min`/`amount1Min` (was 0/0) |
| Slippage protection (removeLiquidity) | sqrtPrice-based estimation with `slippageBps` floor |
| Single-price valuation | `totalValue()` uses one TWAP-derived sqrtPrice for both range-amount sizing and token1→token0 conversion (no spot/TWAP mixing) |
| Spot-vs-TWAP divergence guard | First-position mint and rebalance revert with `PriceDeviatedFromTwap` when `\|spotTick − twapTick\| > maxTwapDeviationTicks` (default 200 ticks ≈ 2%) |
| Minimum pool age | First-position mint requires the pool to have at least `minPoolAgeSecs` (default 300 s) of observation history; closes the TWAP-fallback manipulation surface |
| TWAP oracle | 5-minute TWAP via `pool.observe()`; falls back to spot only on a brand-new pool, gated by the minimum-pool-age check |
| Admin-change timelock | `setPerformanceFee` / `setManagementFee` / `setTreasury` replaced with `propose…` + `executeAdminChange` separated by `ADMIN_TIMELOCK_DELAY` (2 days). Single pending change at a time; `cancelAdminChange` clears it |
| Fee caps | `≤ 20%` performance and `≤ 2%` annual management, enforced on-chain at propose-time |
| Token rescue | Admin can recover stuck tokens when paused via `rescueTokens()` |
| ERC721 safe receipt | `IERC721Receiver` implemented on strategy for safe NFT handling |
| Keeper role pre-flight | Keeper bot verifies `KEEPER_ROLE` on every strategy and vault before starting its poll loop; exits with a clear error if any grant is missing |

**Known limitations:**
- Keeper bot is centralized. The contracts also expose Gelato / Chainlink `checkUpkeep` / `performUpkeep`; either external automation can be wired by granting `KEEPER_ROLE` to its forwarder.

---

## Smart Contracts

```
contracts/
├── MezRangeVault.sol              # ERC-4626 vault (full interface compliance)
├── MezRangeStrategyV2.sol         # Uniswap V3 liquidity strategy (Mezo testnet)
├── interfaces/
│   ├── INonfungiblePositionManager.sol
│   ├── IUniswapV3Pool.sol
│   └── IUniswapV3SwapRouter.sol
└── libraries/
    ├── TickMath.sol               # Tick math + getSqrtRatioAtTick
    └── LiquidityAmounts.sol       # Uniswap V3 liquidity math
```

### Mezo Testnet Deployments

Live deployments (Chain ID `31611`). Single source of truth lives in
[`src/data/deployedContracts.ts`](./src/data/deployedContracts.ts).

| Pair / Fee | Strategy | Vault | Pool |
|---|---|---|---|
| MUSD/BTC 50 bps | [`0x5165BA…dfDb8`](https://explorer.test.mezo.org/address/0x5165BA96bf100d0139d488898403DCF06d2dfDb8) | [`0xc7B54E…645492`](https://explorer.test.mezo.org/address/0xc7B54Efc2416291c0A52615598C949aa97645492) | [`0x026dB8…85850`](https://explorer.test.mezo.org/address/0x026dB82AC7ABf60Bf1a81317c9DbD63702B85850) |
| MUSD/MEZO 200 bps | [`0xc16dC0…0d714`](https://explorer.test.mezo.org/address/0xc16dC0e6d5aE12D2e192853Db16899f54130d714) | [`0x2BBA10…CA13Df`](https://explorer.test.mezo.org/address/0x2BBA10Aab8442F050B4DB8a3c2C0b4275dCA13Df) | [`0x4CB9e8…50BEA`](https://explorer.test.mezo.org/address/0x4CB9e8a9d0a2A72d3B0Eb6Ed1F56fa6f6EA50BEA) |
| MUSD/BTC 10 bps | [`0x650218…3c0A9`](https://explorer.test.mezo.org/address/0x65021835c49cf529BDa1e5B6F65294114053c0A9) | [`0xD8Fdf1…37B0C`](https://explorer.test.mezo.org/address/0xD8Fdf1b0973B76C5902CC28281b4F31184437B0C) | [`0xFe31b6…75997`](https://explorer.test.mezo.org/address/0xFe31b6033BCda0ebEc9FB789ee21bbc400175997) |

Shared infrastructure:

| Component | Address |
|---|---|
| NonfungiblePositionManager | `0x9B753e11bFEd0D88F6e1D2777E3c7dac42F96062` |
| SwapRouter | `0x3112908bB72ce9c26a321Eeb22EC8e051F3b6E6a` |
| Keeper / Treasury wallet | `0x03ffb3720214bDB0DB5F5F71b6cE16B008f762d2` |

> To redeploy: `forge script script/DeployTestnetDirect.s.sol:DeployTestnetDirect --rpc-url $RPC_URL --broadcast` and then update `src/data/deployedContracts.ts`.

---

## Setup & Development

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) — for smart contracts
- [Node.js ≥ 20](https://nodejs.org) — for frontend + keeper bot
- [npm](https://npmjs.com)

### Install dependencies

```bash
# Frontend / keeper
npm install

# Foundry (Solidity libs)
forge install OpenZeppelin/openzeppelin-contracts
```

### Copy environment file

```bash
cp .env.example .env
# Fill in RPC_URL, DEPLOYER_PK, KEEPER_PK, contract addresses
```

---

## Deployment

```bash
# Deploy all three vaults (MUSD/BTC-50, MUSD/BTC-10, MUSD/MEZO-200) in one transaction.
# Reads DEPLOYER_PK, KEEPER_ADDRESS, TREASURY_ADDRESS, POSITION_MANAGER, SWAP_ROUTER from env.
forge script script/DeployTestnetDirect.s.sol:DeployTestnetDirect \
  --rpc-url $RPC_URL \
  --broadcast \
  -vvvv
```

After deployment:
1. Copy the strategy + vault addresses printed at the end of the run into `src/data/deployedContracts.ts`.
2. Copy strategy addresses to `keeper/.env` as `STRATEGY_ADDRS` (or rely on the defaults in the keeper, which read `DEPLOYED_CONTRACTS.testnet`).

### Environment Variables

| Variable | Description |
|---|---|
| `DEPLOYER_PK` | Deployer wallet private key |
| `KEEPER_ADDRESS` | Keeper bot wallet address (gets KEEPER_ROLE) |
| `TREASURY_ADDRESS` | Protocol fee recipient |
| `TOKEN0_ADDRESS` | token0 (deposit token) address |
| `POOL_ADDRESS` | Uniswap V3 pool address on Mezo |
| `POSITION_MANAGER` | NonfungiblePositionManager address |
| `SWAP_ROUTER` | SwapRouter address |
| `RPC_URL` | Mezo RPC endpoint (default: `https://rpc.test.mezo.org`) |

---

## Running the Keeper Bot

```bash
# Set environment variables
export RPC_URL=https://rpc.test.mezo.org
export KEEPER_PK=0x...         # Keeper wallet private key
export STRATEGY_ADDRS=0x...,0x...,0x...  # Comma-separated strategy addresses
export POLL_MS=12000            # Optional: poll interval (default 12s)

# Run
npx tsx keeper/keeper.ts
```

The keeper bot will:
- Poll `shouldRebalance()` on each strategy every `POLL_MS` milliseconds
- Call `rebalance()` when the price exits the active range
- Call `collectAndCompound()` every hour to compound fees
- Apply exponential backoff (up to 5 minutes) on consecutive failures
- Skip rebalance if gas price exceeds 50 gwei

---

## Frontend

```bash
npm run dev       # Development server with HMR
npm run build     # Production build
npm run preview   # Preview production build
```

The frontend displays:
- **Vault Dashboard**: TVL, APY, current range, fee earnings per vault
- **Range Chart**: 48-hour price history vs upper/lower range bounds
- **Rebalance Timeline**: history of all rebalance events
- **IL Tracker**: impermanent loss estimation
- **APY Analytics**: strategy comparison charts
- **Contracts Tab**: deployed addresses + system architecture

To connect real blockchain data, update `src/data/deployedContracts.ts` with actual addresses and integrate `wagmi` hooks (see inline TODOs in `src/hooks/useVaultData.ts`).

---

## Testing

```bash
# Run all tests
forge test -vv

# Run with gas report
forge test --gas-report

# Run specific test
forge test --match-test test_Rebalance_UpdatesRange -vvvv

# Run with coverage
forge coverage
```

### Test Coverage

| Module | Tests |
|---|---|
| Deposit / Mint | `test_Deposit_*`, `test_Mint_*` |
| Withdraw / Redeem | `test_Redeem_*`, `test_Withdraw_*` |
| Share accounting | `test_TotalAssets_*`, `test_SharePrice_*` |
| Rebalance trigger | `test_ShouldRebalance_*` |
| Rebalance execution | `test_Rebalance_*` |
| Fee accrual | `test_PerformanceFee_*`, `test_ManagementFee_*` |
| Edge cases | `test_EdgeCase_*` — out-of-range deposit, TWAP fallback, pause/unpause |
| ERC-4626 compliance | `test_ERC4626_*` |

---

## License

MIT — see [LICENSE](./LICENSE)
