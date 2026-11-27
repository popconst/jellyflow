import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/web',
  envDir: '../..',
  build: { outDir: '../../dist', emptyOutDir: true },
  plugins: [svelte()],
  // the API (server.ts, `npm start`) while developing: API=http://host:port to use another
  server: { proxy: { '/api': process.env['API'] ?? 'http://127.0.0.1:4173' } },
})
