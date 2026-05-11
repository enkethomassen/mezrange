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
    // Vaults — redeployed 2026-05-09 (exactInput swap fix for Mezo router)
    vaults: {
      btcMusd: {
        vault:    '0xc7B54Efc2416291c0A52615598C949aa97645492', // MezRangeVault MUSD/BTC-50
        strategy: '0x5165BA96bf100d0139d488898403DCF06d2dfDb8', // MezRangeStrategyV2 MUSD/BTC-50
        token0:   '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503', // MUSD
        token1:   '0x7b7C000000000000000000000000000000000000', // BTC (Mezo)
        pool:     '0x026dB82AC7ABf60Bf1a81317c9DbD63702B85850', // MUSD/BTC 50bps pool
      },
      mezoMusd: {
        vault:    '0x2BBA10Aab8442F050B4DB8a3c2C0b4275dCA13Df', // MezRangeVault MUSD/MEZO-200
        strategy: '0xc16dC0e6d5aE12D2e192853Db16899f54130d714', // MezRangeStrategyV2 MUSD/MEZO-200
        token0:   '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503', // MUSD
        token1:   '0x7B7c000000000000000000000000000000000001', // MEZO
        pool:     '0x4CB9e8a9d0a2A72d3B0Eb6Ed1F56fa6f6EA50BEA', // MUSD/MEZO 200bps pool
      },
      btcMusd10: {
        vault:    '0xD8Fdf1b0973B76C5902CC28281b4F31184437B0C', // MezRangeVault MUSD/BTC-10
        strategy: '0x65021835c49cf529BDa1e5B6F65294114053c0A9', // MezRangeStrategyV2 MUSD/BTC-10
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
