#!/usr/bin/env bash
# Turnkey redeploy for MezRange on Mezo testnet.
#
# WHY: The smart contracts are immutable. Pushing code to GitHub/Vercel only
# updates the frontend — it does NOT change the on-chain vaults. Deposits will
# keep reverting until you redeploy the (now-fixed) contracts and point the
# frontend at the new addresses.
#
# USAGE:
#   1. cp .env.example .env   &&   edit .env:
#        DEPLOYER_PK        = your deployer private key (must hold Mezo gas)
#        KEEPER_ADDRESS     = keeper bot wallet (gets KEEPER_ROLE)
#        TREASURY_ADDRESS   = fee recipient
#        POSITION_MANAGER   = 0x509Bc221df2B83927c695FA0bb0f5B21053C874c  (already set)
#   2. ./deploy.sh
#   3. Copy the printed addresses into src/data/deployedContracts.ts, commit, push.
#
# After redeploy, deposits work right away (they are pool-free); the keeper
# opens the first LP position via deployIdle() on its next poll.
set -euo pipefail

if [[ ! -f .env ]]; then echo "Missing .env — run: cp .env.example .env && edit it"; exit 1; fi
set -a; source .env; set +a

: "${DEPLOYER_PK:?set DEPLOYER_PK in .env}"
: "${KEEPER_ADDRESS:?set KEEPER_ADDRESS in .env}"
: "${TREASURY_ADDRESS:?set TREASURY_ADDRESS in .env}"
RPC_URL="${RPC_URL:-https://rpc.test.mezo.org}"
export POSITION_MANAGER="${POSITION_MANAGER:-0x509Bc221df2B83927c695FA0bb0f5B21053C874c}"
export SWAP_ROUTER="${SWAP_ROUTER:-0x3112908bB72ce9c26a321Eeb22EC8e051F3b6E6a}"

echo "→ Deploying matched CL vaults with PM $POSITION_MANAGER"
forge script script/DeployTestnetDirect.s.sol:DeployTestnetDirect \
  --rpc-url "$RPC_URL" --broadcast -vvvv

echo
echo "✅ Done. Now paste the 'COPY THESE TO deployedContracts.ts' addresses above"
echo "   into src/data/deployedContracts.ts, then: git commit -am 'redeploy' && git push"
