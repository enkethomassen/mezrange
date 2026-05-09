/**
 * Wagmi + RainbowKit configuration for MezRange.
 * Uses @mezo-org/passport's getConfig() to include Bitcoin wallet connectors
 * (Unisat, OKX, Xverse) alongside standard EVM wallets (MetaMask, WalletConnect).
 * Bounty requirement: "Support Bitcoin wallets with @mezo-org/passport (built on RainbowKit)"
 */
import { getConfig } from '@mezo-org/passport';

// Re-export Mezo chain definitions from the passport package constants so the
// rest of the app can import them from this single module.
export { mezoTestnet, mezoMainnet } from '@mezo-org/passport';

// getConfig() from @mezo-org/passport replaces getDefaultConfig() from RainbowKit.
// It automatically adds Bitcoin wallet connectors (Unisat, OKX, Xverse) and
// configures Mezo Testnet / Mainnet chains and transports.
export const wagmiConfig = getConfig({
  appName: 'MezRange',
  walletConnectProjectId:
    import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? 'YOUR_WALLETCONNECT_PROJECT_ID',
  mezoNetwork: (import.meta.env.VITE_MEZO_NETWORK as 'mainnet' | 'testnet') ?? 'testnet',
});
