// Genera le icone PNG da site/icon.svg e site/icon-maskable.svg (Playwright). Uso: node scripts/icons.mjs
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
for (const [src, out, size] of [["icon.svg", "icon-32.png", 32], ["icon-maskable.svg", "icon-180.png", 180], ["icon.svg", "icon-192.png", 192], ["icon.svg", "icon-512.png", 512], ["icon-maskable.svg", "icon-maskable-512.png", 512]]) {
  const svg = await readFile(`site/${src}`, "utf8");
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await page.screenshot({ path: `site/${out}`, omitBackground: true });
}
await browser.close();
console.log("Icone generate in site/");
