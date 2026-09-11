import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/, so assets need that prefix.
  base: '/attestable/',
  plugins: [react()],
  server: { port: 5173 },
});
