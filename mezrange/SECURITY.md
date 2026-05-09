# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest (`main` branch) | ✅ Active |
| Previous releases | ⚠️ Critical fixes only |

---

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Please report security vulnerabilities privately to:

**Email:** security@mezrange.io
**Response SLA:** Acknowledgement within **24 hours**, triage within **72 hours**.

Include in your report:
- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept (preferably a Foundry test)
- Affected contract(s) / component(s)
- Your suggested severity (Critical / High / Medium / Low)

We will keep you informed of our remediation progress and credit you in the post-mortem (unless you prefer to remain anonymous).

---

## Severity Definitions

| Severity | Description | Resolution Target |
|----------|-------------|-------------------|
| **Critical** | Direct loss or lock of user funds, complete access control bypass | Emergency pause + fix < 24 h |
| **High** | Incorrect rebalancing logic, fee theft, significant MEV exposure | < 7 days |
| **Medium** | Non-critical logic errors, UI data inconsistencies | < 30 days |
| **Low** | Documentation gaps, best-practice deviations | Next release cycle |

---

## Bug Bounty

A formal bug bounty program will be launched within **30 days of mainnet deployment**.

Interim rewards for responsibly disclosed vulnerabilities:
- **Critical:** Up to 10% of TVL (capped at $50,000 USD equivalent)
- **High:** Up to $10,000 USD equivalent
- **Medium / Low:** Acknowledgement + discretionary reward

---

## Security Architecture

MezRange vaults are designed with defence-in-depth:

### Smart Contract Protections
- **ReentrancyGuard** on all state-changing external functions
- **Pausable** — admin and emergency roles can halt all vault operations instantly
- **AccessControl** — three-tier role system (ADMIN / KEEPER / EMERGENCY)
- **Slippage protection** — configurable `slippageBps` enforced on every liquidity operation and swap (both `decreaseLiquidity` and `mint` in rebalances)
- **TWAP oracle** — 5-minute TWAP used for price-based range calculation; resists single-block manipulation
- **Pool age guard** — `minPoolAgeSecs` prevents operating on pools too young to have a reliable TWAP history
- **Fee caps** — max 20% performance fee and 2% management fee enforced on-chain
- **Token rescue** — admin can recover stuck tokens only when vault is paused

### Known Limitations / Risk Disclosures
1. **Non-upgradeable contracts** — any critical bug requires deploying a new vault and user migration (see `MAINTENANCE.md`)
2. **Oracle fallback** — if `pool.observe()` reverts and the pool has passed the age check, the contract falls back to the spot tick; this is acceptable for brief observation gaps but increases MEV surface marginally
3. **Keeper centralisation** — the keeper bot is off-chain; a keeper outage means rebalancing pauses (positions may drift out of range) but user funds remain safe and can always be withdrawn
4. **Uniswap V3 fork risk** — MezRange relies on the correctness of the DEX's NonfungiblePositionManager; any bug in the underlying DEX is out of scope

---

## Audit Status

| Auditor | Scope | Status |
|---------|-------|--------|
| Supernormal Foundation (arranged) | Full smart contract review | Pending mainnet approval |
| Internal review | Contracts + keeper bot | Ongoing |

Audit reports will be published in the `/audits` directory of this repository once completed.

---

## Responsible Disclosure Policy

MezRange follows a **coordinated disclosure** model:

1. Reporter contacts `security@mezrange.io` with vulnerability details.
2. We acknowledge within 24 hours and begin triage.
3. We work with the reporter on a fix timeline (target: ≤ 7 days for Critical/High).
4. We deploy the fix and issue a public post-mortem within 7 days of the incident.
5. Reporter is credited (with permission) and rewarded per the bug bounty tiers above.

We will not pursue legal action against security researchers acting in good faith.
