import { defineConfig, devices } from '@playwright/test'

const port = 5174
const localUrl = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL,
    baseURL: localUrl,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: localUrl,
    reuseExistingServer: true,
  },
})
