const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const appJsonPath = path.join(__dirname, '..', 'app.json');
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const projectId = appJson?.expo?.extra?.eas?.projectId;

if (typeof projectId !== 'string' || projectId.trim().length === 0) {
  console.log('Skipping EAS config check because no repository-scoped EAS project is configured. Configure EAS locally before cloud builds.');
  process.exit(0);
}

const command = 'npx';
const args = ['--yes', 'eas-cli', 'config', '--platform', 'android', '--profile', 'apk'];
const retryableOutput = /Request timed out|ETIMEDOUT|network|fetch failed/i;

for (let attempt = 1; attempt <= 3; attempt += 1) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      CI: '1',
      EXPO_NO_INTERACTIVE: '1',
    },
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status === 0) {
    process.exit(0);
  }

  const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
  const shouldRetry = retryableOutput.test(combinedOutput);
  if (!shouldRetry || attempt === 3) {
    process.exit(result.status || 1);
  }
}
