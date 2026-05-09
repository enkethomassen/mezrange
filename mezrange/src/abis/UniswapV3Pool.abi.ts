/**
 * Minimal ABI for a Uniswap V3 pool — only slot0 needed to get current tick.
 */
export const UNISWAP_V3_POOL_ABI = [
  {
    name: 'slot0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96',               type: 'uint160' },
      { name: 'tick',                         type: 'int24'   },
      { name: 'observationIndex',             type: 'uint16'  },
      { name: 'observationCardinality',       type: 'uint16'  },
      { name: 'observationCardinalityNext',   type: 'uint16'  },
      { name: 'feeProtocol',                  type: 'uint8'   },
      // NOTE: Mezo DEX omits `bool unlocked` — do not add it here
    ],
  },
] as const;
