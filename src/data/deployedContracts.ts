/**
 * Deployed contract addresses on Mezo Testnet.
 * Update these after running: forge script script/Deploy.s.sol:DeployMultiVault --broadcast
 *
 * Explorer: https://explorer.test.mezo.org
 * RPC:      https://rpc.test.mezo.org
 * Chain ID: 31611
 */

export const MEZO_TESTNET = {
  chainId: 31611,
  name: 'Mezo Testnet',
  rpcUrl: 'https://rpc.test.mezo.org',
  explorerUrl: 'https://explorer.test.mezo.org',
  explorerName: 'Mezo Explorer',
} as const;

export const MEZO_MAINNET = {
  chainId: 31612,
  name: 'Mezo Mainnet',
  rpcUrl: 'https://rpc.mezo.org',
  explorerUrl: 'https://explorer.mezo.org',
  explorerName: 'Mezo Explorer',
} as const;

/**
 * Contract addresses — replace with real values after deployment.
 * Addresses marked PENDING must be populated before the UI shows live data.
 */
export const DEPLOYED_CONTRACTS = {
  testnet: {
    // Vaults — redeployed 2026-05-11 (depositDual + TWAP sign fix for Mezo DEX)
    vaults: {
      btcMusd: {
        vault:    '0x9491dee32561cb64E2082F7eCc415cc076BDDdcC', // MezRangeVault MUSD/BTC-50
        strategy: '0xde1ef53FD61Ba529A107aC3C6776ce189E5BfF59', // MezRangeStrategyV2 MUSD/BTC-50
        token0:   '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503', // MUSD
        token1:   '0x7b7C000000000000000000000000000000000000', // BTC (Mezo)
        pool:     '0x026dB82AC7ABf60Bf1a81317c9DbD63702B85850', // MUSD/BTC 50bps pool
      },
      mezoMusd: {
        vault:    '0xdeef6A6F808cfF758F57Ea152Db06c9178EA7c21', // MezRangeVault MUSD/MEZO-200
        strategy: '0xEAdbAe284C83C7c9Ae88E63C0C34fFD0953aB5a5', // MezRangeStrategyV2 MUSD/MEZO-200
        token0:   '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503', // MUSD
        token1:   '0x7B7c000000000000000000000000000000000001', // MEZO
        pool:     '0x4CB9e8a9d0a2A72d3B0Eb6Ed1F56fa6f6EA50BEA', // MUSD/MEZO 200bps pool
      },
      btcMusd10: {
        vault:    '0x0E64E1E2c75E13ff15c19DCF63780a17C340e809', // MezRangeVault MUSD/BTC-10
        strategy: '0xb9c1C18A2938dC32Ffaf9C9f4d21fD7E35BF3D59', // MezRangeStrategyV2 MUSD/BTC-10
        token0:   '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503', // MUSD
        token1:   '0x7b7C000000000000000000000000000000000000', // BTC (Mezo)
        pool:     '0xFe31b6033BCda0ebEc9FB789ee21bbc400175997', // MUSD/BTC 10bps pool
      },
    },
    // Protocol infrastructure
    positionManager: '0x9B753e11bFEd0D88F6e1D2777E3c7dac42F96062',
    swapRouter:      '0x3112908bB72ce9c26a321Eeb22EC8e051F3b6E6a',
    keeperBot:       '0x03ffb3720214bDB0DB5F5F71b6cE16B008f762d2',
  },
  mainnet: {
    vaults: {
      btcMusd:  { vault: '', strategy: '', token0: '', token1: '', pool: '' },
      mezoMusd: { vault: '', strategy: '', token0: '', token1: '', pool: '' },
      btcMusd10:  { vault: '', strategy: '', token0: '', token1: '', pool: '' },
    },
    positionManager: '',
    swapRouter:      '',
    keeperBot:       '',
  },
} as const;

/** Returns the explorer link for a given address/tx hash */
export function explorerLink(
  hashOrAddr: string,
  type: 'address' | 'tx' = 'address',
  network: 'testnet' | 'mainnet' = 'testnet'
): string {
  const base = network === 'testnet' ? MEZO_TESTNET.explorerUrl : MEZO_MAINNET.explorerUrl;
  return `${base}/${type}/${hashOrAddr}`;
}

/** Returns true if a contract address has been populated (not zero address) */
export function isDeployed(address: string): boolean {
  return address !== '0x0000000000000000000000000000000000000000' && address !== '';
}
