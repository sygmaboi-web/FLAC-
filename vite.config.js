import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ['buffer', 'process', 'stream', 'util']
    })
  ],
  server: {
    port: 5173
  },
  preview: {
    port: 4173
  }
});
