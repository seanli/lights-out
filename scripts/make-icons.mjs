// Renders pwa/icon.svg to the PNG sizes the install manifest and iOS need. Run once when the icon changes.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const svg = readFileSync('pwa/icon.svg', 'utf8');
const browser = await chromium.launch();
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:#0d1015}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: `pwa/icon-${size}.png` });
  await page.close();
}
await browser.close();
console.log('pwa/icon-180.png, icon-192.png, icon-512.png');
