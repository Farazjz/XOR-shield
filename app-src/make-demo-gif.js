/**
 * make-demo-gif.js — regenerates `assets/demo.gif` (the README animation) by
 * driving the built `index.html` in headless Chromium and encoding frames to GIF.
 *
 * Dev-only helper. Its dependencies are intentionally NOT listed in
 * package.json (keeps `npm install` light for contributors who only run the
 * test suites). Install them wherever you run this script:
 *
 *   npm install puppeteer pngjs gifenc
 *   node app-src/make-demo-gif.js
 *
 * Input:  ../index.html (built app) + ../examples/demo-worker.js (sample code)
 * Output: ../assets/demo.gif
 */
'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { PNG } = require('pngjs');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const ROOT = path.resolve(__dirname, '..');
const APP = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const SAMPLE = fs.readFileSync(path.join(ROOT, 'examples', 'demo-worker.js'), 'utf8');
const OUT = path.join(ROOT, 'assets', 'demo.gif');

const VIEW_W = 1000;      // logical viewport
const VIEW_H = 640;
const DSF = 2;            // device pixel ratio → capture is 2000×1280
const OUT_W = 1000;       // final GIF width (native logical width → crisp text)
const COLORS = 256;       // GIF palette size (quality/size trade-off)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* find a usable browser: XOR_CHROME env → puppeteer's bundled Chrome → system Chrome/Edge */
function resolveBrowser() {
  const bundled = (() => {
    try { return puppeteer.executablePath(); } catch (e) { return null; }
  })();
  const candidates = [
    process.env.XOR_CHROME,
    bundled,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c && fs.existsSync(c)) return c;
  }
  return null;
}

/* box-filter downscale of a decoded PNG to `outW` wide, RGBA out */
function downscale(png, outW) {
  const inW = png.width, inH = png.height;
  const outH = Math.round((inH * outW) / inW);
  const out = new Uint8Array(outW * outH * 4);
  const sx = inW / outW, sy = inH / outH;
  for (let y = 0; y < outH; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.min(inH, Math.ceil((y + 1) * sy));
    for (let x = 0; x < outW; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.min(inW, Math.ceil((x + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let idx = (yy * inW + x0) * 4;
        for (let xx = x0; xx < x1; xx++) {
          r += png.data[idx]; g += png.data[idx + 1]; b += png.data[idx + 2];
          idx += 4; n++;
        }
      }
      const o = (y * outW + x) * 4;
      out[o] = (r / n) | 0;
      out[o + 1] = (g / n) | 0;
      out[o + 2] = (b / n) | 0;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

(async () => {
  const executablePath = resolveBrowser();
  if (!executablePath) {
    throw new Error('No browser found — set XOR_CHROME to a Chrome/Edge/Chromium executable path');
  }
  console.log('browser: ' + executablePath);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--font-render-hinting=none'
    ]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: DSF });
  await page.goto(APP, { waitUntil: 'load' });
  await sleep(400);

  /* ---- caption bar + scripted cursor overlay ---- */
  await page.evaluate(() => {
    const css = document.createElement('style');
    css.textContent = [
      '.toast{display:none !important}',
      '#gifCap{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);',
      '  background:rgba(10,14,22,.93);color:#e9eef8;border:1px solid #2b3648;',
      '  padding:9px 17px;border-radius:999px;font:600 15px/1.35 system-ui,Segoe UI,sans-serif;',
      '  z-index:99999;white-space:nowrap;box-shadow:0 10px 28px rgba(0,0,0,.55)}',
      '#gifCur{position:fixed;left:-60px;top:-60px;width:24px;height:24px;z-index:99998;',
      '  pointer-events:none;transform:translate(-3px,-3px);',
      '  transition:left .17s cubic-bezier(.4,0,.2,1),top .17s cubic-bezier(.4,0,.2,1)}',
      '#gifCur:after{content:"";position:absolute;inset:2px;border-radius:50%;',
      '  border:3px solid #5b8cff;background:rgba(91,140,255,.32);',
      '  box-shadow:0 0 0 3px rgba(91,140,255,.16)}'
    ].join('\n');
    document.head.appendChild(css);
    const cap = document.createElement('div'); cap.id = 'gifCap'; document.body.appendChild(cap);
    const cur = document.createElement('div'); cur.id = 'gifCur'; document.body.appendChild(cur);
    window.__cap = (t) => { cap.textContent = t; };
    window.__cur = (x, y) => { cur.style.left = x + 'px'; cur.style.top = y + 'px'; };
    document.documentElement.style.scrollBehavior = 'auto';
  });

  const frames = [];
  const shot = async (ms) => frames.push({ buf: await page.screenshot({ type: 'png' }), ms: ms || 120 });
  const caption = (t) => page.evaluate((t) => window.__cap(t), t);
  const cursorTo = async (sel) => {
    const r = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      el.scrollIntoView({ block: 'center' });
      return true;
    }, sel);
    await sleep(140);                     // let the scroll settle before measuring
    const pos = await page.evaluate((sel) => {
      const b = document.querySelector(sel).getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, sel);
    await page.evaluate(([x, y]) => window.__cur(x, y), [pos.x, pos.y]);
    await sleep(260);
    return pos;
  };
  const scrollTo = async (sel, block) => {
    await page.evaluate(([sel, block]) => {
      const el = document.querySelector(sel);
      if (el) el.scrollIntoView({ block: block || 'center' });
    }, [sel, block || 'center']);
    await sleep(320);
  };

  /* ---- storyboard ---- */

  // 0 · overview
  await caption('XOR Shield — obfuscate a Cloudflare Worker in the browser');
  await sleep(350); await shot(1500);

  // 1 · paste the sample source
  await caption('1 · paste or drop your worker.js');
  await scrollTo('#srcBox');
  const total = SAMPLE.length;
  for (const frac of [0.34, 0.62, 1]) {
    await page.evaluate((txt) => { document.getElementById('srcBox').value = txt; }, SAMPLE.slice(0, Math.round(total * frac)));
    await sleep(140); await shot(170);
  }
  await shot(600);

  // 2 · options (key is automatic)
  await caption('2 · key + table format: automatic');
  await cursorTo('#optFmt');
  await shot(1000);

  // 3 · press Protect
  await caption('3 · press “Protect code”');
  const btn = await cursorTo('#btnProtect');
  await shot(650);
  await page.mouse.click(btn.x, btn.y);
  await shot(140);                       // progress: parsing → verifying
  await sleep(160); await shot(260);
  await page.waitForFunction(
    () => !document.getElementById('cardResult').classList.contains('hidden'),
    { timeout: 30000 }
  );

  // 4 · result + automatic verify
  await caption('4 · result: stats + automatic round-trip verify');
  await shot(320);                       // lands during the smooth auto-scroll
  await scrollTo('#statsGrid', 'start');
  await shot(1500);

  // 5 · verify PASS
  await caption('5 · verify PASS: every record decodes byte-identical');
  await scrollTo('#cardVerifyAuto');
  await shot(1600);

  // 6 · download
  await caption('6 · download the protected worker.js');
  await scrollTo('#btnDownload');
  await cursorTo('#btnDownload');
  await shot(1100);

  // 7 · outro
  await caption('XOR Shield · no eval · online demo + source on GitHub');
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await sleep(380); await shot(1800);

  await browser.close();

  /* ---- decode, downscale, quantize, encode ---- */
  const decoded = frames.map((f) => downscale(PNG.sync.read(f.buf), OUT_W));
  const W = decoded[0].width, H = decoded[0].height;

  // global palette sampled across all frames
  const samples = [];
  for (const fr of decoded) {
    for (let i = 0; i < fr.data.length; i += 4 * 7) {
      samples.push(fr.data[i], fr.data[i + 1], fr.data[i + 2], 255);
    }
  }
  const palette = quantize(Uint8Array.from(samples), COLORS);

  const gif = GIFEncoder();
  decoded.forEach((fr, i) => {
    const indexed = applyPalette(fr.data, palette);
    gif.writeFrame(indexed, W, H, { palette, delay: frames[i].ms, repeat: i === 0 ? 0 : undefined });
  });
  gif.finish();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const bytes = Buffer.from(gif.bytes());
  fs.writeFileSync(OUT, bytes);

  /* optional: dump individual frames as PNGs for visual inspection
     (`node make-demo-gif.js --dump` or env XOR_DUMP=1) */
  if (process.env.XOR_DUMP || process.argv.includes('--dump')) {
    const dir = path.join(require('os').tmpdir(), 'xor-demo-frames');
    fs.mkdirSync(dir, { recursive: true });
    decoded.forEach((fr, i) => {
      const png = new PNG({ width: fr.width, height: fr.height });
      png.data = Buffer.from(fr.data);
      fs.writeFileSync(path.join(dir, 'frame-' + String(i).padStart(2, '0') + '.png'), PNG.sync.write(png));
    });
    console.log('dumped ' + decoded.length + ' frames → ' + dir);
  }

  console.log('frames: ' + decoded.length + ' · ' + W + 'x' + H + ' · palette ' + palette.length +
    ' · ' + (bytes.length / 1024 / 1024).toFixed(2) + ' MB → ' + path.relative(ROOT, OUT));
})().catch((e) => { console.error('FAILED: ' + (e && e.stack || e)); process.exit(1); });
