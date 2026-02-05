const fs = require('fs');
const path = require('path');

const appJsonPath = path.join(process.cwd(), 'apps', 'mobile', 'app.json');

try {
  if (!fs.existsSync(appJsonPath)) {
    console.warn('apps/mobile/app.json not found, skipping version bump.');
    process.exit(0);
  }

  const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const expo = app.expo || {};
  expo.ios = expo.ios || {};
  expo.android = expo.android || {};

  const nextIos = String((parseInt(expo.ios.buildNumber || '0', 10) || 0) + 1);
  expo.ios.buildNumber = nextIos;
  expo.android.versionCode = (Number(expo.android.versionCode) || 0) + 1;

  app.expo = expo;
  fs.writeFileSync(appJsonPath, JSON.stringify(app, null, 2) + '\n');

  const version = expo.version || 'unknown';
  const build = nextIos + '/' + String(expo.android.versionCode);

  const updateReadme = (p) => {
    if (!fs.existsSync(p)) return;
    let t = fs.readFileSync(p, 'utf8');
    const block = `## Build Info\n\n- Version: ${version}\n- Build: ${build}\n`;
    if (t.includes('## Build Info')) {
      t = t.replace(/## Build Info[\s\S]*?(?=\n## |\n# |$)/, block.trimEnd() + '\n');
    } else {
      t = block + '\n' + t;
    }
    fs.writeFileSync(p, t);
  };

  updateReadme(path.join(process.cwd(), 'apps', 'mobile', 'README.md'));
  updateReadme(path.join(process.cwd(), 'apps', 'web', 'README.md'));

  console.log('Build info updated:', { version, build });
} catch (error) {
  console.error('Error in bump-build:', error);
  process.exit(1);
}
