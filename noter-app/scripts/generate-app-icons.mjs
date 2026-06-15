/**
 * Generates the mobile app icon, Android adaptive foreground, splash mark, web
 * favicon AND the Electron desktop icon from a single vector source, so the brand
 * stays consistent and reproducible. Re-run after any design tweak:
 *
 *   node scripts/generate-app-icons.mjs
 *
 * Design v2 — "Noter, dark": a deep near-black tile with a crisp white note card
 * and a monochrome checkmark badge. Sleek black-and-white, a subtle radial glow
 * for depth, and (on the splash) thin concentric rings for extra detail. iOS wants
 * a full-bleed opaque square; the Android adaptive foreground keeps the glyph in
 * the centre ~66% safe zone over a flat dark fill; the splash mark sits on a dark
 * rounded plate so it reads on a full-screen dark background.
 */
import sharp from 'sharp';
import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../apps/mobile/assets/images');
const ELECTRON_ICON = resolve(__dirname, '../../electron-noter/build/icon.png');

// Monochrome dark palette.
const BG_DARK = '#0C0C10';   // near-black base
const BG_DARK_2 = '#23242C'; // charcoal highlight for the gradient
const CARD = '#FAFAFC';      // off-white note card
const INK = '#0C0C10';       // dark detail (lines) on the white card
const BADGE = '#101218';     // dark badge disc
const BADGE_RING = '#FFFFFF';

/** The note-card + checkmark glyph, drawn within a `size` box, scaled by `s`. */
const glyph = (size, s = 1) => {
  const cx = size / 2;
  const cy = size / 2;
  const w = size * 0.42 * s;
  const h = size * 0.5 * s;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const r = size * 0.05 * s;
  const fold = size * 0.11 * s;
  const lineX = x + w * 0.16;
  const lineW = w * 0.5;
  const lh = size * 0.018 * s;
  const lines = [0.36, 0.56, 0.76].map((f) => {
    const ly = y + h * f;
    const lw = f === 0.76 ? lineW * 0.7 : lineW;
    return `<rect x="${lineX}" y="${ly}" width="${lw}" height="${lh * 2}" rx="${lh}" fill="${INK}" opacity="0.14"/>`;
  }).join('');
  // White note card with a folded top-right corner + soft drop shadow.
  const card = `
    <path d="
      M ${x + r} ${y}
      H ${x + w - fold}
      L ${x + w} ${y + fold}
      V ${y + h - r}
      Q ${x + w} ${y + h} ${x + w - r} ${y + h}
      H ${x + r}
      Q ${x} ${y + h} ${x} ${y + h - r}
      V ${y + r}
      Q ${x} ${y} ${x + r} ${y} Z"
      fill="${CARD}" filter="url(#softShadow)"/>
    <path d="M ${x + w - fold} ${y} L ${x + w - fold} ${y + fold} L ${x + w} ${y + fold} Z"
      fill="#000000" opacity="0.16"/>`;
  // Monochrome checkmark badge: dark disc, thin white ring, white tick.
  const br = size * 0.085 * s;
  const bx = x + w * 0.66;
  const by = y + h * 0.62;
  const badge = `
    <circle cx="${bx}" cy="${by}" r="${br}" fill="${BADGE}" stroke="${BADGE_RING}" stroke-width="${br * 0.10}"/>
    <path d="M ${bx - br * 0.45} ${by} L ${bx - br * 0.08} ${by + br * 0.4} L ${bx + br * 0.5} ${by - br * 0.4}"
      fill="none" stroke="#FFFFFF" stroke-width="${br * 0.3}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return card + lines + badge;
};

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BG_DARK_2}"/>
      <stop offset="0.55" stop-color="${BG_DARK}"/>
      <stop offset="1" stop-color="#050507"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.3" r="0.75">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.10"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${0.012 * 1024}" stdDeviation="${0.02 * 1024}" flood-color="#000000" flood-opacity="0.45"/>
    </filter>
  </defs>`;

// Full-bleed opaque icon (iOS + default + Electron).
const iconSvg = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  ${defs}
  <rect width="${size}" height="${size}" fill="url(#bg)"/>
  <rect width="${size}" height="${size}" fill="url(#glow)"/>
  ${glyph(size, 1)}
</svg>`;

// Android adaptive foreground — transparent, glyph in the centre safe zone.
const adaptiveSvg = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  ${defs}
  ${glyph(size, 0.72)}
</svg>`;

// Splash mark — dark rounded plate with thin concentric rings (extra detail) + glyph.
const splashSvg = (size) => {
  const cx = size / 2;
  const rings = [0.30, 0.37, 0.44]
    .map((rf, i) => `<circle cx="${cx}" cy="${cx}" r="${size * rf}" fill="none" stroke="#FFFFFF" stroke-opacity="${0.05 - i * 0.012}" stroke-width="${size * 0.004}"/>`)
    .join('');
  return `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  ${defs}
  <rect x="${size * 0.16}" y="${size * 0.16}" width="${size * 0.68}" height="${size * 0.68}" rx="${size * 0.18}" fill="url(#bg)"/>
  <rect x="${size * 0.16}" y="${size * 0.16}" width="${size * 0.68}" height="${size * 0.68}" rx="${size * 0.18}" fill="url(#glow)"/>
  ${rings}
  ${glyph(size, 0.6)}
</svg>`;
};

const render = async (name, svg, size) => {
  const file = resolve(OUT, name);
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(file);
  console.log(`wrote ${name} (${size}px)`);
};

await mkdir(OUT, { recursive: true });
await render('icon.png', iconSvg(1024), 1024);
await render('adaptive-icon.png', adaptiveSvg(1024), 1024);
await render('splash-icon.png', splashSvg(1024), 1024);
await render('favicon.png', iconSvg(64), 64);

// Electron desktop icon — same full-bleed dark mark.
try {
  await mkdir(dirname(ELECTRON_ICON), { recursive: true });
  await sharp(Buffer.from(iconSvg(1024))).resize(1024, 1024).png().toFile(ELECTRON_ICON);
  console.log('wrote electron-noter/build/icon.png (1024px)');
} catch (e) {
  console.warn('electron icon not written:', e?.message);
}
console.log('done');
