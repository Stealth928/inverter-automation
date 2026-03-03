/**
 * generate-icons.js
 * Renders icon.svg → icon-*.png files using Playwright (headless Chromium).
 * Run: node scripts/generate-icons.js
 */
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ICONS_DIR = path.join(__dirname, '..', 'frontend', 'icons');
const SVG_PATH = path.join(ICONS_DIR, 'icon.svg');
const svgContent = fs.readFileSync(SVG_PATH, 'utf8');

const SIZES = [16, 32, 48, 192, 512];
const MASKABLE_SIZES = [192, 512]; // also generate maskable variants with padding + dark bg

(async () => {
  const browser = await chromium.launch();

  for (const size of SIZES) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: size, height: size });

    // Render SVG with transparent background
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${size}px; height: ${size}px; background: transparent; overflow: hidden; }
  svg { width: ${size}px; height: ${size}px; display: block; }
</style>
</head>
<body>${svgContent}</body>
</html>`;

    await page.setContent(html);
    const outPath = path.join(ICONS_DIR, `icon-${size}.png`);
    await page.screenshot({ path: outPath, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`✓ icon-${size}.png`);
    await page.close();
  }

  // Maskable variants: dark bg (#0a0e1a) + ~10% safe-zone padding
  for (const size of MASKABLE_SIZES) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: size, height: size });

    const pad = Math.round(size * 0.10);
    const inner = size - pad * 2;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${size}px; height: ${size}px; background: #0a0e1a; overflow: hidden; }
  .wrap { position: absolute; top: ${pad}px; left: ${pad}px; width: ${inner}px; height: ${inner}px; }
  svg { width: ${inner}px; height: ${inner}px; display: block; }
</style>
</head>
<body><div class="wrap">${svgContent}</div></body>
</html>`;

    await page.setContent(html);
    const outPath = path.join(ICONS_DIR, `icon-maskable-${size}.png`);
    await page.screenshot({ path: outPath, omitBackground: false, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`✓ icon-maskable-${size}.png`);
    await page.close();
  }

  // apple-touch-icon (180x180, transparent bg, no padding needed)
  {
    const touchSize = 180;
    const page = await browser.newPage();
    await page.setViewportSize({ width: touchSize, height: touchSize });
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; }
  html, body { width: ${touchSize}px; height: ${touchSize}px; background: #0a0e1a; overflow: hidden; }
  svg { width: ${touchSize}px; height: ${touchSize}px; display: block; }
</style>
</head>
<body>${svgContent}</body>
</html>`;
    await page.setContent(html);
    const outPath = path.join(ICONS_DIR, 'apple-touch-icon.png');
    await page.screenshot({ path: outPath, omitBackground: false, clip: { x: 0, y: 0, width: touchSize, height: touchSize } });
    console.log('✓ apple-touch-icon.png');
    await page.close();
  }

  await browser.close();
  console.log('\nAll icons generated in frontend/icons/');
})();
