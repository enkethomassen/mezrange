# MezRange — 6-Month Maintenance Commitment

**Project:** MezRange — Automated LP Rebalancing Vault for Mezo DEX  
**Repository:** https://github.com/enkethomassen/mezrange  
**Effective Date:** Upon mainnet deployment approval by the Supernormal Foundation  
**Commitment Period:** 6 months from mainnet deployment date  

---

## 1. Support Model

### Active Monitoring
- **On-call coverage:** Primary maintainer available Mon–Fri, 09:00–18:00 UTC. Emergency response within 4 hours for critical issues (fund safety, paused vaults, keeper failure) 24/7.
- **Keeper bot uptime:** Keeper bot maintained with ≥99.5% uptime target. Alerts configured for keeper wallet balance, gas failures, and missed rebalance windows.
- **Health dashboard:** Public status page tracking keeper status, vault TVL, and rebalance frequency.

### Bug Fix SLA
| Severity | Response | Resolution Target |
|----------|----------|-------------------|
| Critical (fund risk, exploit) | < 4 hours | < 24 hours + emergency pause |
| High (rebalance logic failure, incorrect fee accounting) | < 24 hours | < 7 days |
| Medium (UI issues, non-critical contract edge cases) | < 72 hours | < 30 days |
| Low (documentation, cosmetic) | < 1 week | Next release cycle |

---

## 2. Upgrade Path

### Smart Contracts
- Vault and Strategy contracts are **non-upgradeable by design** to maximise trust.
- If a critical vulnerability is discovered:
  1. Admin immediately calls `pause()` on affected contracts.
  2. Users are notified via GitHub, Twitter/X, and the project's Telegram channel.
  3. A replacement contract is deployed and audited.
  4. Users are guided through migrating funds to the new vault.
- No proxy pattern is used — upgrades are opt-in migrations, never forced.

### Frontend & Keeper Bot
- Frontend and keeper bot may be updated without user action.
- All frontend deployments go through a staging environment first.
- Keeper bot updates are tested on Mezo Testnet before mainnet rollout.

---

## 3. Security Review Process

- **Pre-mainnet:** All critical and high-severity findings from the Supernormal Foundation's security audit will be remediated before deployment.
- **Ongoing:** Monthly internal review of contract interactions, keeper logs, and known DeFi exploit patterns.
- **Responsible disclosure:** Security researchers can report vulnerabilities via the private contact listed in `SECURITY.md`. We commit to acknowledging reports within 24 hours.
- **Bug bounty:** A bug bounty program will be established within 30 days of mainnet launch, covering up to 10% of TVL for critical findings (capped at $50,000).

---

## 4. Communication Channels

| Channel | Purpose |
|---------|---------|
| GitHub Issues | Bug reports, feature requests |
| GitHub Discussions | Architecture questions, integration support |
| Telegram: @mezrange | Community support, announcements |
| Email: security@mezrange.io | Security disclosures (private) |

All critical announcements (emergency pauses, contract migrations) will be posted simultaneously on GitHub and Telegram within 30 minutes of the decision.

---

## 5. Fee Structure & Sustainability

The protocol charges a 10% performance fee on earned trading fees and a 1% annual management fee. These fees fund:
- Developer time for maintenance and upgrades
- Keeper bot infrastructure costs (VPS, gas top-ups)
- Future security audits
- Bug bounty pool

Both fees are **capped on-chain** (max 20% performance, max 2% management) and cannot be changed unilaterally without a timelock.

---

## 6. Commitment Statement

The MezRange team commits to:

1. Maintaining the smart contracts, keeper bot, and frontend for a minimum of **6 months** following mainnet deployment.
2. Remediating all critical and high-severity security findings identified in the Supernormal Foundation's security audit prior to mainnet launch.
3. Providing timely bug fixes per the SLA table above.
4. Keeping the keeper bot funded and operational so rebalancing continues uninterrupted.
5. Publishing a public post-mortem within 7 days of any incident involving user funds.
6. Notifying the Mezo community at least 30 days before any planned winding-down or handoff of the project.

---

*This document constitutes the formal maintenance commitment as required by the Mezo Automated LP Rebalancing Vault bounty specification.*
