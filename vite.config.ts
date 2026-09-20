import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      watch: {
        // Native Windows watching is much lighter than polling this whole
        // repository. Android/Gradle and generated Functions output do not
        // belong to the browser bundle, but their build writes were causing
        // repeated full page reloads and starving Vite's module transforms.
        usePolling: false,
        ignored: [
          '**/android/**',
          '**/.gradle-user/**',
          '**/functions/lib/**',
          '**/*.log',
          '**/*.map'
        ]
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
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'firebase-vendor': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/database', 'firebase/storage', 'firebase/functions'],
            'maplibre-vendor': ['maplibre-gl'],
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
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
