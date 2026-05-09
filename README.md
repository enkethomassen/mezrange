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
│           MezRangeStrategy  (Liquidity Manager)              │
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
| Slippage protection (rebalance) | TWAP-derived `amount0Min`/`amount1Min` applied to re-mint |
| Slippage protection (removeLiquidity) | sqrtPrice-based estimation with `slippageBps` floor |
| TWAP oracle | 5-minute TWAP via `pool.observe()`, falls back to spot only if pool has no history |
| Token rescue | Admin can recover stuck tokens when paused via `rescueTokens()` |
| ERC721 safe receipt | `IERC721Receiver` implemented on strategy for safe NFT handling |

**Known limitations:**
- The TWAP fallback to spot tick (for new pools) remains a manipulation surface. Consider requiring minimum pool age before activation.
- Keeper bot is centralized. Consider migrating to Gelato or Chainlink Automation for trustless operation.

---

## Smart Contracts

```
contracts/
├── MezRangeVault.sol              # ERC-4626 vault (full interface compliance)
├── MezRangeStrategy.sol           # Uniswap V3 liquidity strategy
├── interfaces/
│   ├── INonfungiblePositionManager.sol
│   ├── IUniswapV3Pool.sol
│   └── IUniswapV3SwapRouter.sol   # NEW: swap router interface
└── libraries/
    ├── TickMath.sol               # Tick math + getSqrtRatioAtTick
    └── LiquidityAmounts.sol       # NEW: Uniswap V3 liquidity math
```

### Mezo Testnet Deployments

| Contract | Address | Explorer |
|---|---|---|
| MezRangeStrategy | `0x...` | [View](https://explorer.test.mezo.org) |
| MezRangeVault (BTC/mUSD) | `0x...` | [View](https://explorer.test.mezo.org) |
| MezRangeVault (MEZO/mUSD) | `0x...` | [View](https://explorer.test.mezo.org) |
| MezRangeVault (BTC/MEZO) | `0x...` | [View](https://explorer.test.mezo.org) |

> Run `forge script script/Deploy.s.sol:Deploy` to deploy and get real addresses.

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
# Deploy single vault
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify \
  -vvvv

# Deploy all three vaults (BTC/mUSD, MEZO/mUSD, BTC/MEZO)
forge script script/Deploy.s.sol:DeployMultiVault \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify \
  -vvvv
```

After deployment:
1. Copy deployed contract addresses to `src/data/deployedContracts.ts`
2. Copy strategy addresses to `keeper/.env` as `STRATEGY_ADDRS`

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
