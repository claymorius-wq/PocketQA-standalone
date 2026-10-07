/* global document, window, getComputedStyle, FileReader */
// Derives the Android launcher icon from the landing page's own brand mark (full E2E icon task).
// No icon image file existed in the repo: the landing page draws the mark in code
// (<FlutedLens size={104}/> in app/(auth)/welcome.tsx). The asset is the exact render of that
// element, which is lead's choice and overridable by Hamza:
//   1. `extract`: open a LOCAL web export of this code (dark theme, reduced motion = rest pose, so
//      no shimmer and no drift), take the FlutedLens element's DOM, all page CSS rules and its
//      images inlined as data URIs, and save that as ONE self-contained HTML file;
//   2. `raster`: load ONLY that file in headless Chromium and screenshot it (no redraw):
//      icon-1024.png (the tile's 104x104 bounds on #0B0A1F) and adaptive-foreground-1024.png
//      (the tile at 66 % of a transparent 1024 canvas, Android's adaptive safe zone).
// Usage: node scripts/icon/render-flutedlens.mjs extract <url> <out.html>
//        node scripts/icon/render-flutedlens.mjs raster <asset.html> <outDir>
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const S = 104; // the landing page's lens size (FLUTE_SIZES[104] = radius 30, 12 ribs)
const BG = '#0B0A1F'; // the dark page ground (theme dark.background), the lead's choice
const SAFE = 0.66; // the tile spans 66 % of the adaptive foreground canvas
const OUT = 1024;
const [mode, src, dest] = process.argv.slice(2);

const browser = await chromium.launch();
try {
  if (mode === 'extract') {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(src, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000); // fonts, images and the (instant, reduced-motion) arrival settle
    const html = await page.evaluate(async (size) => {
      // The FlutedLens root: a size x size box holding a size-wide <svg> (its rim), outermost such.
      const roots = [...document.querySelectorAll('div')].filter((d) => {
        const r = d.getBoundingClientRect();
        return Math.round(r.width) === size && Math.round(r.height) === size && d.querySelector(`svg[width="${size}"]`) && getComputedStyle(d).borderTopLeftRadius !== '0px';
      });
      const root = roots.find((d) => !roots.some((o) => o !== d && o.contains(d)));
      if (!root) throw new Error('FlutedLens root not found');
      const clone = root.cloneNode(true);
      // Inline every image (the grain tile) so the file is self-contained.
      const toData = async (url) => {
        const blob = await (await fetch(url)).blob();
        return await new Promise((ok) => {
          const fr = new FileReader();
          fr.onload = () => ok(fr.result);
          fr.readAsDataURL(blob);
        });
      };
      for (const img of clone.querySelectorAll('img')) img.setAttribute('src', await toData(img.src));
      for (const el of [clone, ...clone.querySelectorAll('*')]) {
        const bg = el.style && el.style.backgroundImage;
        const m = bg && /url\("?([^")]+)"?\)/.exec(bg);
        if (m) el.style.backgroundImage = `url("${await toData(new URL(m[1], window.location.href).href)}")`;
      }
      const css = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
      const rect = root.getBoundingClientRect();
      return { css, body: clone.outerHTML, rect: { w: rect.width, h: rect.height } };
    }, S);
    const doc = `<!doctype html>\n<html><head><meta charset="utf-8"><title>Pocket QA brand mark: FlutedLens ${S} (dark, rest pose)</title>\n<style>${html.css}</style>\n<style>html,body{margin:0;padding:0;background:transparent}#pqa-mark{position:absolute;left:0;top:0;width:${S}px;height:${S}px}</style></head>\n<body><div id="pqa-mark">${html.body}</div></body></html>\n`;
    writeFileSync(dest, doc);
    // The reference: the element exactly as the landing page shows it (for the fidelity check).
    await page.screenshot({ path: dest.replace(/\.html$/, '.landing-ref.png'), clip: await page.evaluate((size) => {
      const d = [...document.querySelectorAll('div')].filter((e) => { const r = e.getBoundingClientRect(); return Math.round(r.width) === size && Math.round(r.height) === size && e.querySelector(`svg[width="${size}"]`) && getComputedStyle(e).borderTopLeftRadius !== '0px'; });
      const r = d.find((e) => !d.some((o) => o !== e && o.contains(e))).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, S) });
    console.log(JSON.stringify({ wrote: dest, bytes: doc.length, rect: html.rect }));
  } else if (mode === 'raster') {
    const url = pathToFileURL(resolve(src)).href;
    // Legacy icon: the tile's own bounds, the page ground behind its rounded corners.
    let ctx = await browser.newContext({ viewport: { width: S, height: S }, deviceScaleFactor: OUT / S, colorScheme: 'dark' });
    let page = await ctx.newPage();
    await page.goto(url);
    await page.addStyleTag({ content: `html,body{background:${BG} !important}` });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(dest, 'icon-1024.png'), clip: { x: 0, y: 0, width: S, height: S } });
    await ctx.close();
    // Adaptive foreground: transparent canvas, the tile centred at 66 %.
    // A whole-pixel canvas (158 css px: the tile spans 104/158 = 65.8 %) so 1024/158 gives exactly 1024 px.
    const C = Math.round(S / SAFE);
    ctx = await browser.newContext({ viewport: { width: C, height: C }, deviceScaleFactor: OUT / C, colorScheme: 'dark' });
    page = await ctx.newPage();
    await page.goto(url);
    await page.addStyleTag({ content: `#pqa-mark{left:${(C - S) / 2}px !important;top:${(C - S) / 2}px !important}` });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(dest, 'adaptive-foreground-1024.png'), clip: { x: 0, y: 0, width: C, height: C }, omitBackground: true });
    // Fidelity: the asset at 1x, to compare with the landing-page reference.
    await ctx.close();
    ctx = await browser.newContext({ viewport: { width: S, height: S }, deviceScaleFactor: 1, colorScheme: 'dark' });
    page = await ctx.newPage();
    await page.goto(url);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(dest, 'asset-1x-check.png'), clip: { x: 0, y: 0, width: S, height: S }, omitBackground: true });
    console.log(JSON.stringify({ wrote: ['icon-1024.png', 'adaptive-foreground-1024.png', 'asset-1x-check.png'], from: readFileSync(src).length }));
  } else {
    throw new Error('usage: extract <url> <out.html> | raster <asset.html> <outDir>');
  }
} finally {
  await browser.close();
}
