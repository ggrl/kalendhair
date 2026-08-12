import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    // `npm run dev` serves the front end; the API is the Node server on 3000. Proxying
    // keeps the browser talking to one origin, so the app needs no notion of where the API
    // lives and no CORS header has to exist.
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  preview: { host: '127.0.0.1', port: 4173 },
})
