import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/web',
  envDir: '../..',
  build: { outDir: '../../dist', emptyOutDir: true },
  plugins: [svelte()],
})
