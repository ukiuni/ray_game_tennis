import { defineConfig, devices } from '@playwright/test';

const landscape = (d) => ({ ...d, viewport: { width: d.viewport.height, height: d.viewport.width } });

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'android-chrome', use: { ...landscape(devices['Pixel 7']) } },
    { name: 'iphone-safari', use: { ...landscape(devices['iPhone 14']) } },
    { name: 'ipad-safari', use: { ...devices['iPad (gen 7) landscape'] } },
    { name: 'iphone-portrait', use: { ...devices['iPhone 14'] } },
  ],
});
