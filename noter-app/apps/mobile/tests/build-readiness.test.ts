import fs from 'fs';
import path from 'path';

const mobileRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'));
const appJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8'));
const easJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'eas.json'), 'utf8'));
const workspaceRoot = path.resolve(mobileRoot, '..', '..');
const workspaceEasIgnore = fs.readFileSync(path.join(workspaceRoot, '.easignore'), 'utf8');

describe('mobile EAS build readiness', () => {
  it('uses npx eas-cli scripts and preflight introspection', () => {
    expect(packageJson.scripts?.['build:apk']).toContain('npx --yes eas-cli build -p android --profile apk');
    expect(packageJson.scripts?.['build:android']).toContain('npx --yes eas-cli build -p android --profile preview');
    expect(packageJson.scripts?.['build:apk:preflight']).toContain('check-types');
    expect(packageJson.scripts?.['build:apk:preflight']).toContain('npm test');
    expect(packageJson.scripts?.['build:apk:preflight']).toContain('expo config --type introspect');
  });

  it('defines required Expo and EAS Android release settings', () => {
    expect(appJson.expo?.android?.package).toBe('com.noter.app');
    expect(appJson.expo?.android?.usesCleartextTraffic).toBeUndefined();
    expect(appJson.expo?.extra?.eas?.projectId).toBeUndefined();
    expect(easJson.build?.apk?.android?.buildType).toBe('apk');
    expect(easJson.build?.preview?.android?.buildType).toBe('apk');
  });

  it('keeps required mobile runtime dependencies and EAS exclusions', () => {
    expect(packageJson.dependencies?.i18next).toBeTruthy();
    expect(packageJson.dependencies?.['react-i18next']).toBeTruthy();
    expect(workspaceEasIgnore).toContain('apps/web/');
    expect(workspaceEasIgnore).toContain('apps/backend/');
    expect(workspaceEasIgnore).toContain('apps/docs/');
  });
});
