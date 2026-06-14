const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Build the Next web app as a STATIC export and bundle it into the Electron
// renderer. Next 16 removed `next export`; a static export now comes from
// `output: 'export'` (gated by ELECTRON_EXPORT) during `next build`.
//
// The web app has server-only routes under app/api (model search/download for the
// browser build). Those can't be statically exported and the desktop app doesn't
// use them (it talks to the native mlc bridge + the remote backend). We move them
// aside for the duration of the export, then always restore them.

const webDir = path.join(__dirname, '..', '..', 'noter-app', 'apps', 'web');
const outDir = path.join(webDir, 'out');
const rendererDir = path.join(__dirname, '..', 'renderer');
const apiDir = path.join(webDir, 'app', 'api');
const apiStash = path.join(webDir, 'app', '__api_disabled_for_export');

const run = (cmd, args, extraEnv) => {
  // Resolve npm to npm.cmd on Windows; run without shell so passing an args array
  // is safe (avoids the Node DEP0190 "args + shell:true" deprecation warning).
  const bin = cmd === 'npm' && process.platform === 'win32' ? 'npm.cmd' : cmd;
  const result = spawnSync(bin, args, {
    cwd: webDir,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...(extraEnv || {}) },
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

const restoreApi = () => {
  if (fs.existsSync(apiStash)) {
    if (fs.existsSync(apiDir)) fs.rmSync(apiDir, { recursive: true, force: true });
    fs.renameSync(apiStash, apiDir);
  }
};

// Clean any leftover stash from a previously interrupted build.
restoreApi();

if (fs.existsSync(apiDir)) {
  fs.renameSync(apiDir, apiStash);
}

try {
  // `next build` with ELECTRON_EXPORT=1 emits the static site into out/.
  run('npm', ['run', 'build'], { ELECTRON_EXPORT: '1' });
} finally {
  restoreApi();
}

if (!fs.existsSync(outDir)) {
  console.error(`[build-web] expected static export at ${outDir} but it does not exist`);
  process.exit(1);
}

// Refresh the bundled renderer from the fresh export, but preserve the tracked
// support pages main.js loads directly (the crash/error screen + test harness)
// which are NOT part of the Next export.
const PRESERVE = ['error.html', 'test.html'];
const stashed = {};
for (const name of PRESERVE) {
  const p = path.join(rendererDir, name);
  if (fs.existsSync(p)) stashed[name] = fs.readFileSync(p);
}
if (fs.existsSync(rendererDir)) {
  fs.rmSync(rendererDir, { recursive: true, force: true });
}
fs.mkdirSync(rendererDir, { recursive: true });
fs.cpSync(outDir, rendererDir, { recursive: true });
for (const [name, buf] of Object.entries(stashed)) {
  fs.writeFileSync(path.join(rendererDir, name), buf);
}

console.log(`[build-web] copied static export -> ${rendererDir} (preserved: ${Object.keys(stashed).join(', ') || 'none'})`);
