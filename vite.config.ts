import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    // Polyfills Buffer, global, process, crypto etc. that WalletConnect /
    // @mezo-org/passport require but browsers don't provide natively.
    nodePolyfills({ protocolImports: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    dedupe: ['react', 'react-dom', 'react-is', 'wagmi', 'viem'],
  },
})
