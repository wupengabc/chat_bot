import { fileURLToPath, URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url))
const projectConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'config.json'), 'utf-8')) as {
  web_host?: string
  web_port?: number
}
const webHost = projectConfig.web_host || '127.0.0.1'
const webPort = projectConfig.web_port || 8788

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: `http://${webHost}:${webPort}`,
        changeOrigin: true,
        xfwd: true,
        ws: true,
      },
    },
  },
})
