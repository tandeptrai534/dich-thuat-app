import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // This makes the Netlify environment variable 'API_KEY'
    // available in the client-side code as 'process.env.API_KEY'
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY)
  }
})
