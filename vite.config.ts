import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3001,
      host: 'localhost',
      watch: {
        usePolling: true,
      },
      proxy: {
        '/maps-api': {
          target: 'https://maps.googleapis.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/maps-api/, ''),
        },
      },
    },
    plugins: [
      react(),
    ],
    // SECURITY: API keys removed from client bundle
    // All sensitive APIs are accessed via Firebase Functions proxy (see functions/src/index.ts)
    define: {},
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
