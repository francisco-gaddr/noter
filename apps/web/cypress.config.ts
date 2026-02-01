import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3003',
    supportFile: false,
    video: false,
    screenshotsFolder: 'cypress/screenshots',
  },
});

