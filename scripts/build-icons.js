// Rasterises assets/*.svg into the Android legacy launcher icons and splash screens (res/mipmap-*, res/drawable-*).
// The adaptive icon itself is vector XML (res/drawable-v24/ic_launcher_foreground.xml, ic_launcher_monochrome.xml)
// built from the same path data as assets/icon-foreground.svg / icon-monochrome.svg.
import sharp from 'sharp';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const res = join(root, 'android', 'app', 'src', 'main', 'res');
const svg = (name) => readFile(join(root, 'assets', name), 'utf8');

const icon = await svg('icon.svg');
const splash = icon; // same artwork: dark-green field with the pin
// Legacy icons have no bleed area: crop to the 72dp safe square and mask it
const legacy = icon.replace('viewBox="0 0 108 108"', 'viewBox="18 18 72 72"');
const mask = (size, r) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#fff"/></svg>`);

const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, size] of Object.entries(densities)) {
  const dir = join(res, `mipmap-${d}`);
  await rm(join(dir, 'ic_launcher_foreground.png'), { force: true });
  const base = await sharp(Buffer.from(legacy), { density: 300 }).resize(size, size).png().toBuffer();
  await sharp(base).composite([{ input: mask(size, size * 0.18), blend: 'dest-in' }]).png().toFile(join(dir, 'ic_launcher.png'));
  await sharp(base).composite([{ input: mask(size, size / 2), blend: 'dest-in' }]).png().toFile(join(dir, 'ic_launcher_round.png'));
}

// Splash: dark-green field with the logo centred (about 1/3 of the short side)
const splashSizes = {
  mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920],
};
async function makeSplash(w, h, file) {
  const logo = Math.round(Math.min(w, h) * 0.5); // the 108dp logo canvas includes padding
  const img = await sharp(Buffer.from(splash), { density: 300 }).resize(logo, logo).png().toBuffer();
  await sharp({ create: { width: w, height: h, channels: 3, background: '#1D4B00' } })
    .composite([{ input: img, gravity: 'centre' }]).png().toFile(file);
}
for (const [d, [w, h]] of Object.entries(splashSizes)) {
  await mkdir(join(res, `drawable-port-${d}`), { recursive: true });
  await makeSplash(w, h, join(res, `drawable-port-${d}`, 'splash.png'));
  await makeSplash(h, w, join(res, `drawable-land-${d}`, 'splash.png'));
}
await makeSplash(480, 320, join(res, 'drawable', 'splash.png'));
console.log('icons + splash written');
