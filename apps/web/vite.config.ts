import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Which build this is, for problem reports: the commit on GitHub's deploy, else when it was built.
const version = process.env.GITHUB_SHA?.slice(0, 7) ?? new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  define: { __APP_VERSION__: JSON.stringify(version) },
});
