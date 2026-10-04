import { playwright } from '@vitest/browser-playwright'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { startPrivacyNetworkCapture, stopPrivacyNetworkCapture } from './tests/support/privacy-network-capture.ts'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/{domain,application}/**/*.test.ts', 'tests/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'browser',
          include: ['src/{infrastructure,ui}/**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            commands: {
              startPrivacyNetworkCapture,
              stopPrivacyNetworkCapture,
            },
          },
        },
      },
    ],
  },
})
