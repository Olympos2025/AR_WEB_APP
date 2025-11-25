import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Use a relative base so assets resolve correctly when deployed to GitHub Pages
  // under a repository subpath.
  base: './',
  server: {
    host: true
  },
  build: {
    outDir: 'dist'
  }
});
