/**
 * ABI fragments for MezRangeStrategy.
 * Only the view functions needed by the dashboard are included.
 */
export const STRATEGY_ABI = [
  { name: 'positionActive',         type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { name: 'currentTickLower',       type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'int24' }] },
  { name: 'currentTickUpper',       type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'int24' }] },
  { name: 'rebalanceCount',         type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'lastRebalanceTimestamp', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalFeesCollected0',    type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalFeesCollected1',    type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalValue',             type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'shouldRebalance',        type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { name: 'slippageBps',            type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  // Events
  { name: 'Rebalanced', type: 'event', inputs: [
    { name: 'oldLower',          type: 'int24',   indexed: false },
    { name: 'oldUpper',          type: 'int24',   indexed: false },
    { name: 'newLower',          type: 'int24',   indexed: false },
    { name: 'newUpper',          type: 'int24',   indexed: false },
    { name: 'feesCollected0',    type: 'uint256', indexed: false },
    { name: 'feesCollected1',    type: 'uint256', indexed: false },
  ]},
] as const;
