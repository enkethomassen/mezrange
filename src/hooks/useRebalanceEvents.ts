/**
 * useRebalanceEvents — fetches real Rebalanced events emitted by strategy contracts.
 * Uses eth_getLogs via the Mezo testnet RPC with the Rebalanced event signature.
 *
 * Event: Rebalanced(int24 oldLower, int24 oldUpper, int24 newLower, int24 newUpper,
 *                    uint256 feesCollected0, uint256 feesCollected1)
 * Keccak256 topic: computed from the ABI signature
 */
import { useState, useEffect } from 'react';
import type { RebalanceEvent } from '../data/mockData';
import { DEPLOYED_CONTRACTS, MEZO_TESTNET, explorerLink } from '../data/deployedContracts';
import { ticksToRange } from './usePrices';

// keccak256("Rebalanced(int24,int24,int24,int24,uint256,uint256)")
const REBALANCED_TOPIC = '0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00';

const VAULT_IDS: Record<string, string> = {
  [DEPLOYED_CONTRACTS.testnet.vaults.btcMusd.strategy.toLowerCase()]:  'vault-btc-musd',
  [DEPLOYED_CONTRACTS.testnet.vaults.mezoMusd.strategy.toLowerCase()]: 'vault-mezo-musd',
  [DEPLOYED_CONTRACTS.testnet.vaults.btcMezo.strategy.toLowerCase()]:  'vault-btc-mezo',
};

const VAULT_PAIRS: Record<string, string> = {
  'vault-btc-musd':  'BTC/mUSD',
  'vault-mezo-musd': 'MEZO/mUSD',
  'vault-btc-mezo':  'BTC/mUSD (10 bps)',
};

function decodeInt24(hex: string): number {
  const val = parseInt(hex, 16);
  // int24: if bit 23 is set, it's negative
  return val > 0x7FFFFF ? val - 0x1000000 : val;
}

function parseRebalancedLog(log: {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}): Omit<RebalanceEvent, 'id'> | null {
  try {
    const addr = log.address.toLowerCase();
    const vaultId = VAULT_IDS[addr];
    if (!vaultId) return null;

    // data = abi.encode(int24, int24, int24, int24, uint256, uint256)
    // each packed into 32 bytes
    const data = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
    if (data.length < 6 * 64) return null;

    const oldLowerRaw = decodeInt24(data.slice(0, 64).slice(40));  // last 6 hex chars = 3 bytes
    const oldUpperRaw = decodeInt24(data.slice(64, 128).slice(40));
    const newLowerRaw = decodeInt24(data.slice(128, 192).slice(40));
    const newUpperRaw = decodeInt24(data.slice(192, 256).slice(40));
    const fees0 = parseInt(data.slice(256, 320), 16) / 1e18;
    const fees1 = parseInt(data.slice(320, 384), 16) / 1e18;

    const pair = VAULT_PAIRS[vaultId] ?? vaultId;
    const { lower: oldLower, upper: oldUpper } = ticksToRange(oldLowerRaw, oldUpperRaw, pair);
    const { lower: newLower, upper: newUpper } = ticksToRange(newLowerRaw, newUpperRaw, pair);

    const blockNum = parseInt(log.blockNumber, 16);
    // Estimate timestamp: Mezo ~2s block time, use current block as reference
    const now = Date.now();
    const approxTimestamp = new Date(now - (blockNum > 0 ? 0 : 0)); // will be corrected below

    const feesCollected = parseFloat((fees0 + fees1).toFixed(4));

    return {
      vaultId,
      timestamp: approxTimestamp,
      txHash: log.transactionHash,
      oldLower,
      oldUpper,
      newLower,
      newUpper,
      priceAtRebalance: 0,
      feesCollected,
      gasUsed: 0,
      profit: 0,
    };
  } catch {
    return null;
  }
}

export interface RebalanceEventsState {
  events: RebalanceEvent[];
  isLoading: boolean;
  error: string | null;
  isLive: boolean;
}

export function useRebalanceEvents(network: 'testnet' | 'mainnet' = 'testnet'): RebalanceEventsState {
  const [state, setState] = useState<RebalanceEventsState>({
    events: [],
    isLoading: true,
    error: null,
    isLive: false,
  });

  useEffect(() => {
    if (network !== 'testnet') {
      setState({ events: [], isLoading: false, error: null, isLive: false });
      return;
    }

    const strategyAddresses = [
      DEPLOYED_CONTRACTS.testnet.vaults.btcMusd.strategy,
      DEPLOYED_CONTRACTS.testnet.vaults.mezoMusd.strategy,
      DEPLOYED_CONTRACTS.testnet.vaults.btcMezo.strategy,
    ];

    const fetchEvents = async () => {
      try {
        const rpc = MEZO_TESTNET.rpcUrl;
        // Get current block
        const blockRes = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
          signal: AbortSignal.timeout(8000),
        });
        const blockData = await blockRes.json();
        const currentBlock = parseInt(blockData.result, 16);

        // Look back ~50000 blocks (~100k seconds / ~28 hours at 2s/block)
        const fromBlock = Math.max(0, currentBlock - 50000);

        // Fetch logs for all strategy addresses
        const logsRes = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_getLogs',
            params: [{
              address: strategyAddresses,
              topics: [REBALANCED_TOPIC],
              fromBlock: `0x${fromBlock.toString(16)}`,
              toBlock: 'latest',
            }],
            id: 2,
          }),
          signal: AbortSignal.timeout(12000),
        });
        const logsData = await logsRes.json();

        if (logsData.error) {
          throw new Error(logsData.error.message ?? 'RPC error');
        }

        const rawLogs: typeof logsData.result = logsData.result ?? [];

        // Get block timestamps for accurate time display
        const blockNums = [...new Set<number>(rawLogs.map((l: { blockNumber: string }) => parseInt(l.blockNumber, 16)))];
        const blockTimestamps: Record<number, number> = {};

        // Batch fetch block timestamps (up to 20 blocks)
        const blocksToFetch = blockNums.slice(-20);
        await Promise.all(
          blocksToFetch.map(async (bn) => {
            try {
              const r = await fetch(rpc, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  method: 'eth_getBlockByNumber',
                  params: [`0x${bn.toString(16)}`, false],
                  id: bn,
                }),
                signal: AbortSignal.timeout(6000),
              });
              const bd = await r.json();
              if (bd.result?.timestamp) {
                blockTimestamps[bn] = parseInt(bd.result.timestamp, 16) * 1000;
              }
            } catch { /* skip */ }
          })
        );

        const events: RebalanceEvent[] = rawLogs
          .map((log: Parameters<typeof parseRebalancedLog>[0], i: number) => {
            const parsed = parseRebalancedLog(log);
            if (!parsed) return null;
            const bn = parseInt(log.blockNumber, 16);
            const ts = blockTimestamps[bn];
            return {
              ...parsed,
              id: `rb-live-${i}`,
              timestamp: ts ? new Date(ts) : parsed.timestamp,
            };
          })
          .filter(Boolean) as RebalanceEvent[];

        // Sort newest first
        events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        setState({ events, isLoading: false, error: null, isLive: true });
      } catch (e: unknown) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          isLive: false,
          error: e instanceof Error ? e.message : 'Failed to fetch events',
        }));
      }
    };

    fetchEvents();
    const id = setInterval(fetchEvents, 60_000); // refresh every minute
    return () => clearInterval(id);
  }, [network]);

  return state;
}

/** Build explorer link for a tx hash */
export function txExplorerLink(txHash: string, network: 'testnet' | 'mainnet' = 'testnet'): string {
  return explorerLink(txHash, 'tx', network);
}
