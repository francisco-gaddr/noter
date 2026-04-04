const fs = require('fs');
const path = require('path');

const targets = [
  path.join(__dirname, '..', 'dist'),
  path.join(__dirname, '..', 'dist-electron'),
  path.join(__dirname, '..', 'dist-electron-build'),
  path.join(__dirname, '..', 'dist-electron-ready'),
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const removeTarget = async (target) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }
      await sleep(200 * (attempt + 1));
    }
  }
};

const run = async () => {
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    try {
      await removeTarget(target);
    } catch (error) {
      const message = String(error?.message || error || '');
      if (message.includes('EBUSY')) {
        console.warn(`Skipping locked target during clean: ${target}`);
        continue;
      }
      throw error;
    }
  }
};

run().catch((error) => {
  console.error('Failed to clean dist output:', error?.message || error);
  process.exit(1);
});
