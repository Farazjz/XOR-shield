/* ui-test.js — jsdom smoke test of index.html: load page, inject worker.js,
   click Protect, confirm the result card renders; capture every error. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const vc = new VirtualConsole();
let problems = [];
vc.on('jsdomError', (e) => {
  const d = e.detail && e.detail.stack ? e.detail.stack : '';
  problems.push('jsdomError: ' + e.message + (d ? ' | ' + d.split('\n').slice(0, 4).join(' | ') : ''));
});
for (const lvl of ['error', 'warn', 'log']) {
  vc.on(lvl, (...args) => {
    if (lvl === 'log') console.log('console.log>', String(args[0]).slice(0, 200));
    else problems.push('console.' + lvl + ': ' + args.map(a => String(a && a.stack || a).split('\n').slice(0, 3).join(' | ')).join(' ~ ') );
  });
}

const dom = new JSDOM(HTML, {
  runScripts: 'dangerously',
  virtualConsole: vc,
  url: 'file:///E:/code/16-XOR/index.html'
});
const win = dom.window;
const doc = win.document;

/* inject APIs jsdom lacks */
if (!win.TextEncoder) win.TextEncoder = TextEncoder;
if (!win.TextDecoder) win.TextDecoder = TextDecoder;
if (!win.crypto || !win.crypto.getRandomValues) {
  try { Object.defineProperty(win, 'crypto', { value: require('node:crypto').webcrypto, configurable: true }); }
  catch (e) { /* fallback: engine uses Math.random */ }
}
/* capture uncaught errors before they become jsdomError */
win.addEventListener('error', (ev) => {
  const err = ev.error || {};
  problems.push('window.error: ' + ev.message + (err.stack ? ' ||| ' + err.stack.split('\n').slice(1, 6).join(' | ').slice(0, 500) : ''));
});

(async function run() {
  const eng = win.__Engine;
  console.log('engine attached:', !!eng, eng && eng.VER);
  const tabs = [].map.call(doc.querySelectorAll('.tabs button'), b => b.id || b.textContent);
  console.log('tabs:', doc.querySelectorAll('.tabs button').length, '| sections:',
    ['protect', 'verify', 'inspect', 'help'].map(n => n + '=' + !!(doc.getElementById('tab-' + n))).join(' '));

  /* simulate loading a source via the textarea path (synthetic worker-like
     content; the real worker.js may not exist when this test runs) */
  let content = '';
  {
    const parts = [];
    parts.push('/*! synthetic smoke source */\n');
    parts.push('function tag(s){ return s[0]; }\n');
    for (let i = 0; i < 1500; i++) {
      parts.push(
        'function h' + i + '(a,b){ var o={ route:"/api/v' + i + '", label:"label-' + i + '-text" }; '
        + 'return o["route"] + a + "unique-string-value-%KEY%".replace("%KEY%", i) + b; }\n'
        + 'var T' + i + ' = `plain template ' + i + ' with length`;\n'
        + 'var S' + i + ' = `sub template ${h' + i + '("arg' + i + '")}`;\n'
        + 'var W' + i + ' = tag `tagged stays ' + i + '`;\n'
      );
    }
    parts.push('function f(){"use strict"; return "use-strict-body-value";} export { f as default };');
    content = parts.join('');
  }
  /* 1) click Protect with NO source loaded: must show the inline note, no crash */
  const btn = doc.getElementById('btnProtect');
  btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  const noteShown = !doc.getElementById('noSrcNote').classList.contains('hidden');
  console.log('empty-source note shown:', noteShown);
  if (!noteShown) problems.push('noSrcNote not shown on empty-source protect click');
  doc.getElementById('noSrcNote').classList.add('hidden');

  /* 2) load a source via the textarea path */
  const srcBox = doc.getElementById('srcBox');
  srcBox.value = content;
  if (srcBox.value.length !== content.length) problems.push('srcBox length mismatch (jsdom textarea clamp?) ' + srcBox.value.length);

  btn.dispatchEvent(new win.Event('click', { bubbles: true }));

  await new Promise(r => setTimeout(r, 3500));

  const card = doc.getElementById('cardResult');
  const stats = doc.getElementById('statsGrid');
  const badge = doc.getElementById('passBadge');
  const prog = doc.getElementById('progProtect');
  console.log('--- result state ---');
  console.log('cardResult hidden:', card.classList.contains('hidden'));
  console.log('stat cards:', stats.children.length, '| first:', stats.textContent.slice(0, 120));
  console.log('passBadge:', badge.textContent.trim().slice(0, 90));
  console.log('progress still on:', prog.classList.contains('on'));
  const outPrev = doc.getElementById('outPrev').textContent;
  console.log('outPrev chars:', outPrev.length);
  const vauto = doc.getElementById('cardVerifyAuto');
  console.log('verifyAuto hidden:', vauto.classList.contains('hidden'), '| body:',
    vauto.textContent.replace(/\s+/g, ' ').slice(0, 160));

  /* 3) "verify last run" button must work without crashing */
  doc.getElementById('btnVerifyLast').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1500));
  const vbody = doc.getElementById('verifyBody');
  console.log('verify tab body:', vbody.textContent.replace(/\s+/g, ' ').trim().slice(0, 140));

  /* 4) inspect with no file loaded: toast only, no crash */
  doc.getElementById('btnInspect').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));

  if (problems.length) {
    console.log('--- problems ---');
    for (const p of problems.slice(0, 12)) console.log(' *', p.slice(0, 400));
  } else console.log('no console/window errors');

  const ok = !card.classList.contains('hidden') && stats.children.length > 3 &&
    badge.textContent.indexOf('PROTECTED') !== -1 && noteShown &&
    vbody.textContent.indexOf('PASS') !== -1;
  console.log(ok ? 'UI SMOKE: PASS' : 'UI SMOKE: FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.log('test crashed:', e.stack && e.stack.split('\n').slice(0, 4).join(' | ')); process.exit(2); });
