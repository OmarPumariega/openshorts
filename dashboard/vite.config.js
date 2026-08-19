import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Backend target for the dev proxy. Defaults to the docker-compose service
// name; set VITE_PROXY_TARGET=http://localhost:8000 to run the dev server on
// the host against a backend reachable at localhost (no CORS, same-origin).
const backend = process.env.VITE_PROXY_TARGET || 'http://backend:8000'
const renderer = process.env.VITE_RENDER_TARGET || 'http://renderer:3100'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Private single-user deployment: no marketing site, no SEO build step
    // (upstream's vite-plugin-seo + seo/ content — competitor comparison
    // pages, sitemap.xml, llms.txt — was removed entirely as it doesn't
    // apply here). Add your own domain(s) here if you access the dev
    // server through anything other than localhost/the Docker network.
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/videos': { target: backend, changeOrigin: true },
      '/thumbnails': { target: backend, changeOrigin: true },
      '/render': { target: renderer, changeOrigin: true },
    }
  }
})
