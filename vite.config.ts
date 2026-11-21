/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // vitest yalnızca uygulama çekirdeğini dener; sunucu ve diğer uygulamalar bun test ile
  // (npm run test:server; berber/, kuafor/, spor/, hali-yikama/ klasörlerinde bun test)
  test: { include: ['src/**/*.test.ts'] },
})
