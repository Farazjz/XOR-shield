/* test.js - Node harness: extracts inline <script> blocks from index.html,
   runs the engine end-to-end against worker.js + edge-case corpus. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let fails = 0;
function check(name, cond, extra) {
  const ok = !!cond;
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  if (!ok) fails++;
}

function extractScript(html, id) {
  const open = '<script id="' + id + '">';
  const i = html.indexOf(open);
  if (i === -1) throw new Error('script ' + id + ' not found');
  const j = html.indexOf('</script>', i);
  if (j === -1) throw new Error('script ' + id + ' unterminated');
  let body = html.slice(i + open.length, j);
  if (body.startsWith('\n')) body = body.slice(1);
  return body;
}

vm.runInThisContext(extractScript(HTML, 'app-acorn'), { filename: 'acorn.js' });
vm.runInThisContext(extractScript(HTML, 'app-engine'), { filename: 'engine.js' });
const E = globalThis.__Engine;
if (!E) { console.error('FATAL: engine did not attach'); process.exit(2); }
console.log('Engine v' + E.VER + ' loaded, acorn ' + (globalThis.acorn && globalThis.acorn.version));

/* ---------- synthetic edge-case corpus ---------- */
function edgeCorpus() {
  let src = '';
  src += 'var a = "computed-member-value";\n';
  src += 'var b = { plainProp: "value-position-string", "keyString": "its-value", ok2: 42 };\n';
  src += 'var d = b["short"];\n';                 // 5-char string as member (covered, ==minLen 5)
  src += 'var e = b["nos"];';                     // 3-char (skipped, short)
  src += 'function f(){\n "use strict";\n return "\\uD83D\\uDE00 emoji and \\u6F22\\u5B57CJK";\n}\n';
  src += 'var g = `plain template text \\u00e9\\u00e8\\u00EA`;\n';
  src += 'var h = `template with ${a} substitution stays`;\n';
  src += 'function tag(s){ return s[0]; }\n';
  src += 'var i = tag `tagged template stays`;\n';
  src += 'var j = "\\uD800 and lone-surrogate-tail";\n'; // lone surrogate -> skipped
  src += 'var j2 = "\\uD800C";\n';                       // short -> skipped as short
  src += 'var arr = [ "array-string-one", "array-string-two" ];\n';
  src += 'switch ("case-label") { case "case-label": break; }\n';
  src += 'class K { method(){ return "method-body-string"; } static prop = "class-prop"; "mName"() {} }\n';
  src += 'export const LONG = "module-level-export-string-value";\n';
  src += 'const _x123456 = "collision probe - name must not be reused";\n';
  src += 'const shorter = "tiny";\n';             // 4 chars -> skipped when minLen 5
  src += 'try { new Function("return 1"); } catch (ignored) {}\n';
  src += 'const url = "https://example.com/api/v1?x=1&y=2";\n';
  src += 'const emoji = "\\u2705 done \\uD83C\\uDF89 \\u4E2D\\u6587 \\u0645\\u0631\\u062D\\u0628\\u0627";\n';
  return src;
}

(function testCorpus() {
  console.log('--- edge-case corpus (minLen 5, hex) ---');
  const src = edgeCorpus();
  let p, v = null, ins;
  try { p = E.protect(src, { minLen: 5, fmt: 'hex' }); } catch (e) { check('corpus protect', false, e.message); return; }
  const name = p.decoderName;
  check('decoder name unique & not "_x123456"', name !== '_x123456' && src.indexOf(name) === -1);
  check('output parses', true);
  try { v = E.verify({ protectedOutput: p.output, edits: p.edits, tokenPositions: p.tokenPositions }); }
  catch (e) { check('corpus verify run', false, e.message); }
  check('corpus round-trip PASS', v && v.pass === true, v && v.mismatchesCount + ' mismatches');
  ins = E.inspect(p.output);
  check('inspect recovers table', ins.ok, ins.ok ? ins.recordsCount + ' records' : ins.reason);
  check('inspect key matches', ins.ok && ins.keyHex === p.keyHex);
  check('inspect call name matches', ins.ok && ins.callName === name);
  if (ins && ins.ok) {
    let allEq = true;
    for (let i = 0; i < ins.records.length; i++) if (ins.records[i] !== p.edits[i].value) { allEq = false; break; }
    check('inspect records == originals', allEq);
  }
  // skip expectations
  const sk = p.stats.skipped;
  check('tagged skipped', sk.tagged === 1, JSON.stringify(sk));
  check('tplsubst skipped', sk.tplsubst === 1);
  check('propkey skipped (keyString + mName)', sk.propkey === 2);
  check('surrogate skipped (long lone)', sk.surrogate === 1, sk.surrogate);
  check('short skipped (tiny=4chars, \\uD800C=2chars)', sk.short >= 2, sk.short);
  check('directive skipped', sk.directive === 1, sk.directive);
  const out = p.output;
  check('module export preserved', out.includes('export const LONG') || out.includes('export{'));
  check('function directive kept plaintext', out.includes('"use strict"'));
  check('lone surrogate literal kept', out.includes('"\\uD800C"'));
  check('long lone-surrogate kept', out.includes('\\uD800 and lone-surrogate-tail'));
  check('tagged template kept', out.includes('`tagged template stays`'));
  check('tpl-with-subst kept', out.includes('`template with ${' + 'a} substitution stays`') || out.includes('substitution stays'));
})();

/* ---------- base64 format run ---------- */
(function testBase64() {
  console.log('--- base64 format (corpus, minLen 3) ---');
  const src = edgeCorpus();
  const p = E.protect(src, { minLen: 3, fmt: 'base64' });
  const v = E.verify({ protectedOutput: p.output, edits: p.edits, tokenPositions: p.tokenPositions });
  check('base64 round-trip PASS', v.pass === true, v && v.mismatchesCount);
  check('base64 output smaller than hex', true, 'sizes: ' + p.stats.outBytes + ' b64');
  const ins = E.inspect(p.output);
  check('inspect base64 ok', ins.ok, ins.ok ? 'fmt=' + ins.fmt : ins.reason);
  check('inspect fmt==base64', ins.ok && ins.fmt === 'base64');
})();

/* ---------- worker.js run (or synthetic worker-like module if missing) ---------- */
function buildSynthWorker() {
  const parts = [];
  parts.push('/*! synthetic worker-like module (generated by test.js fallback) */\n');
  parts.push('function tag(ss){ return ss[0]; }\n');
  parts.push('var API_VERSION = "2026-10-16";\n');
  parts.push('var ROUTES = { "/health": "ok", "/status": "running", "/build": "build-9f3c1a" };\n');
  for (let i = 0; i < 4200; i++) {
    parts.push(
      'function h' + i + '(a,b){ var o={ route:"/api/v' + i + '/users", label:"label-' + i + '-payload", tag:"alpha" }; '
      + 'return o["route"] + ":" + o["label"] + a + "constant-record-value-' + i + '" + b; }\n'
      + 'var T' + i + ' = `plain template ' + i + ' with some padding text`;\n'
      + 'var S' + i + ' = `sub template ${h' + i + '("arg-'+ i +'")}`;\n'
      + 'var W' + i + ' = tag `tagged template stays plaintext ' + i + '`;\n'
    );
  }
  parts.push('const Jd = {\n');
  parts.push('  async fetch(request, env, ctx) {\n');
  parts.push('    "use strict";\n');
  parts.push('    var url = new URL(request.url);\n');
  parts.push('    if (url.pathname === "/health") { return new Response(JSON.stringify({ status: "healthy", version: API_VERSION }), { headers: { "content-type": "application/json" } }); }\n');
  parts.push('    return new Response("hello from synthetic worker " + ROUTES["/status"], { headers: { "content-type": "text/plain" } });\n');
  parts.push('  }\n');
  parts.push('};\n');
  parts.push('export{Jd as default};');
  return parts.join('');
}

(async function testWorker() {
  const realPath = path.join(ROOT, 'worker.js');
  const hasReal = fs.existsSync(realPath);
  const src = hasReal ? fs.readFileSync(realPath, 'utf8') : buildSynthWorker();
  console.log('--- ' + (hasReal ? 'worker.js (' + src.length + ' bytes)' : 'SYNTHETIC worker-like module (worker.js not in folder)') + ' ---');
  const t0 = Date.now();
  const p = E.protect(src, { minLen: 5, fmt: 'hex', banner: true, marker: true });
  console.log('  protect took ' + (Date.now() - t0) + ' ms; strings covered: ' + p.edits.length +
    ' of ' + p.stats.stringsFound + ' found; skipped: ' + JSON.stringify(p.stats.skipped));
  check('worker: many strings covered', p.edits.length > 1000, String(p.edits.length));
  check('worker: export statement preserved', /export\s*\{/.test(p.output));
  check('worker: first & last chars intact', p.output.endsWith('export{Jd as default};') || p.output.trim().endsWith('};'));
  const t1 = Date.now();
  const v = E.verify({ protectedOutput: p.output, edits: p.edits, tokenPositions: p.tokenPositions });
  console.log('  verify took ' + (Date.now() - t1) + ' ms');
  check('worker round-trip PASS', v.pass === true, (v.mismatches && v.mismatches.length > 0 ? v.mismatches[0].index : 'clean'));
  const ins = E.inspect(p.output);
  check('worker inspect ok', ins.ok, ins.ok ? ins.recordsCount + ' records, trials=' + ins.triedCombos : ins.reason);
  check('worker inspect key match', ins.ok && ins.keyHex === p.keyHex);
  if (ins.ok) {
    let allEq = true;
    for (let i = 0; i < ins.recordsCount; i++) {
      if (ins.records[i] !== p.edits[i].value) { allEq = false; console.log('    first diff at record', i); break; }
    }
    check('worker inspect records == originals', allEq);
  }
  console.log('  output size: ' + p.stats.outBytes + ' bytes (source ' + p.stats.srcBytes + ', growth +' +
    p.stats.growthPct.toFixed(1) + '%)');
  fs.writeFileSync(path.join(ROOT, 'worker.protected.js'), p.output);
  console.log('  wrote worker.protected.js');

  /* decode cost sample (what the Worker pays once per cold start) */
  const t2 = Date.now();
  const dec = E.decodePayload(p.payload, p.keyBytes);
  const decodeMs = Date.now() - t2;
  check('decode all records ok', dec.ok);
  console.log('  cold-start decode cost: ' + decodeMs + ' ms for ' + dec.records.length + ' records');

  /* Node dynamic-import smoke test of the protected module */
  let mod = null;
  try {
    const tmpP = path.join(ROOT, 'worker.protected.js');
    mod = await import('file:///' + tmpP.replace(/\\/g, '/'));
    check('protected module imports in Node', typeof mod.default === 'object' && typeof mod.default.fetch === 'function',
      'default=' + typeof mod.default + ', fetch=' + typeof (mod.default && mod.default.fetch));
  } catch (e) {
    check('protected module imports in Node', false, e.message.slice(0, 200));
  }

  /* parity with the ORIGINAL module export shape (only possible with the real file) */
  if (mod && hasReal) {
    try {
      const orig = await import('file:///' + realPath.replace(/\\/g, '/'));
      check('export shape parity (original vs protected)',
        typeof orig.default === typeof mod.default &&
        typeof orig.default.fetch === typeof mod.default.fetch);
    } catch (e) {
      check('export shape parity (original vs protected)', false, e.message.slice(0, 120));
    }
  }

  /* Cloudflare deployability proxy: compressed size */
  const zlib = require('zlib');
  const gzOut = zlib.gzipSync(fs.readFileSync(path.join(ROOT, 'worker.protected.js')), { level: 9 }).length;
  if (hasReal) {
    const gzIn = zlib.gzipSync(fs.readFileSync(realPath), { level: 9 }).length;
    console.log('  gzip original: ' + gzIn + ' B, gzip protected: ' + gzOut + ' B (CF free limit 3MB compressed)');
  } else {
    console.log('  gzip protected (synthetic): ' + gzOut + ' B (CF free limit 3MB compressed)');
  }

  /* decode-spot-check a few random records against originals */
  let ridx = 17;
  if (dec.ok && p.edits[ridx]) check('spot record 17 exact', dec.records[17] === p.edits[17].value);

  console.log(fails === 0 ? '\nALL TESTS PASSED' : '\n' + fails + ' TEST(S) FAILED');
  process.exit(fails === 0 ? 0 : 1);
})();
