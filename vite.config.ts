import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Point assets to the repository subpath for GitHub Pages deployment.
  // Local development remains unaffected.
  base: '/AR_WEB_APP/',
  server: {
    host: true
  },
  build: {
    outDir: 'dist'
  }
});
