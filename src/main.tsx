import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { PassportProvider } from '@mezo-org/passport';
import '@rainbow-me/rainbowkit/styles.css';
import { wagmiConfig } from './wagmiConfig';
import App from './App';
import './index.css';

const queryClient = new QueryClient();

// PassportProvider must wrap WagmiProvider to initialise Bitcoin wallet connectors
// (Unisat, OKX, Xverse) via @mezo-org/passport — satisfies bounty wallet requirement.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PassportProvider
      environment={
        (import.meta.env.VITE_MEZO_NETWORK as 'mainnet' | 'testnet') ?? 'testnet'
      }
    >
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider
            theme={darkTheme({
              accentColor: '#f97316',         // orange-500
              accentColorForeground: 'black',
              borderRadius: 'large',
              fontStack: 'system',
            })}
          >
            <App />
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </PassportProvider>
  </StrictMode>,
);
