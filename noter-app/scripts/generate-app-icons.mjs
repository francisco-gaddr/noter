/**
 * Generates the mobile app icon, Android adaptive foreground, splash mark and
 * web favicon from a single vector source, so the brand stays consistent and
 * the icons are reproducible (re-run after any design tweak).
 *
 *   node scripts/generate-app-icons.mjs
 *
 * Design: "Daylited Noter" — a warm daylight (sunrise) gradient tile carrying a
 * clean white note card with a checkmark, evoking notes + tasks + a new day.
 * iOS wants a full-bleed opaque square (the OS masks corners); Android adaptive
 * foreground keeps the glyph inside the centre ~66% safe zone over a flat brand
 * fill; the splash mark sits on a soft tinted backdrop.
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../apps/mobile/assets/images');

// Brand palette — daylight sunrise.
const AMBER = '#FF9F1C';
const CORAL = '#FF4D6D';
const INK = '#1E2233';
const BRAND_BG = '#FFF3E2'; // soft warm backdrop for splash/adaptive

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
    return `<rect x="${lineX}" y="${ly}" width="${lw}" height="${lh * 2}" rx="${lh}" fill="${INK}" opacity="0.16"/>`;
  }).join('');
  // White note card with a folded top-right corner.
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
      fill="#FFFFFF"/>
    <path d="M ${x + w - fold} ${y} L ${x + w - fold} ${y + fold} L ${x + w} ${y + fold} Z"
      fill="#000000" opacity="0.10"/>`;
  // Checkmark badge over the card's lower area.
  const br = size * 0.085 * s;
  const bx = x + w * 0.66;
  const by = y + h * 0.62;
  const badge = `
    <circle cx="${bx}" cy="${by}" r="${br}" fill="url(#sun)"/>
    <path d="M ${bx - br * 0.45} ${by} L ${bx - br * 0.08} ${by + br * 0.4} L ${bx + br * 0.5} ${by - br * 0.4}"
      fill="none" stroke="#FFFFFF" stroke-width="${br * 0.28}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return card + lines + badge;
};

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${AMBER}"/>
      <stop offset="1" stop-color="${CORAL}"/>
    </linearGradient>
    <linearGradient id="sun" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${AMBER}"/>
      <stop offset="1" stop-color="${CORAL}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.32" r="0.7">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

// Full-bleed opaque icon (iOS + default).
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

// Splash mark — glyph on a soft branded tile with a subtle rounded plate.
const splashSvg = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  ${defs}
  <rect x="${size * 0.18}" y="${size * 0.18}" width="${size * 0.64}" height="${size * 0.64}" rx="${size * 0.16}" fill="url(#bg)"/>
  <rect x="${size * 0.18}" y="${size * 0.18}" width="${size * 0.64}" height="${size * 0.64}" rx="${size * 0.16}" fill="url(#glow)"/>
  ${glyph(size, 0.62)}
</svg>`;

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
console.log('done');
