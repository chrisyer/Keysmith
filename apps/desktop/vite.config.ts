import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: ['es2022', 'safari16'],
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/zustand/')
          ) {
            return 'vendor-react';
          }
          if (id.includes('/node_modules/lucide-react/')) {
            return 'vendor-icons';
          }
          if (id.includes('/node_modules/@tauri-apps/')) {
            return 'vendor-tauri';
          }
          if (id.includes('/node_modules/@tanstack/')) {
            return 'vendor-virtual';
          }
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});
