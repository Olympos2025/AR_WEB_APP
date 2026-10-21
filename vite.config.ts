import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const basePath = process.env.VITE_BASE_PATH ?? (repositoryName ? `/${repositoryName}/` : '/');

export default defineConfig({
  plugins: [react()],
  // Use a dynamic base path so the app works both locally and on GitHub Pages.
  // `GITHUB_REPOSITORY` is available in GitHub Actions (owner/repo).
  // `VITE_BASE_PATH` can override this when needed.
  base: basePath,
  server: {
    host: true
  },
  build: {
    outDir: 'dist'
  }
});
