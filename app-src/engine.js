/* ============================================================
   XOR-String Engine v1.0.0
   Deployable XOR obfuscation for ES-module sources.
   No eval / no dynamic code generation: string literals are
   XOR-encoded into a packed hex/base64 table at build time and
   decoded eagerly-but-once at runtime by an inline helper that
   ships with the output. Identifiers, numbers, regexps and
   export statements are never touched, so the result remains a
   valid ES module deployable to Cloudflare Workers.
   Runs in browser and Node (TextEncoder/TextDecoder only).
   ============================================================ */
(function () {
  var EL = {
    VERSION: '1.0.0',
    /* keystream mix prime: key[ (31*r + j) % keyLen ] */
    KEY_MIX: 31
  };

  /* ---------- byte helpers ---------- */
  function utf8(s) {
    return new TextEncoder().encode(String(s));
  }
  function strictDecode(bytes) {
    var d = new TextDecoder('utf-8', { fatal: true });
    try { return { ok: true, text: d.decode(bytes) }; }
    catch (e) { return { ok: false }; }
  }

  /* base64 without atob dependency */
  var B64T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64enc(bytes) {
    var out = [];
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i],
        b1 = i + 1 < bytes.length ? bytes[i + 1] : 0,
        b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out.push(B64T[b0 >> 2], B64T[((b0 & 3) << 4) | (b1 >> 4)]);
      out.push(i + 1 < bytes.length ? B64T[((b1 & 15) << 2) | (b2 >> 6)] : '=');
      out.push(i + 2 < bytes.length ? B64T[b2 & 63] : '=');
    }
    return out.join('');
  }
  function b64dec(text) {
    text = String(text).replace(/[^A-Za-z0-9+/]/g, '');
    var n = (text.length / 4) * 3;
    n = Math.floor(n);
    var bytes = new Uint8Array(n), v = 0, cur = 0, bits = 0;
    for (var i = 0; i < text.length; i++) {
      var idx = B64T.indexOf(text[i]);
      if (idx < 0) continue;
      cur = (cur << 6) | idx;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        if (v < n) bytes[v] = (cur >> bits) & 0xff;
        v++;
      }
    }
    return bytes.subarray(0, Math.min(v, n));
  }

  function toHexFast(bytes) {
    var CHUNK = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) {
      var sub = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
      parts.push(String.fromCharCode.apply(null, sub));
    }
    var hexes = [];
    for (var c = 0; c < parts.length; c++) {
      var s = parts[c];
      var src = [];
      for (var j = 0; j < s.length; j++) {
        var b = s.charCodeAt(j);
        src.push((b >> 4).toString(16));
        src.push((b & 15).toString(16));
      }
      hexes.push(src.join(''));
    }
    return hexes.join('');
  }
  function hexToBytes(hex) {
    if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
    var n = hex.length >> 1;
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = parseInt(hex.substr(i << 1, 2), 16);
    return out;
  }

  /* ---------- sha256 (pure JS, synchronous) ---------- */
  var SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function sha256(bytes) {
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    var orig = bytes.length;
    var totalBits = orig * 8;
    /* JS numbers exact to 2^53 — fine below ~512MB inputs */
    var bitLenLo = totalBits % 4294967296;
    var bitLenHi = Math.floor(totalBits / 4294967296);
    var total = ((orig + 9 + 63) & ~63);
    var msg = new Uint8Array(total);
    msg.set(bytes);
    msg[orig] = 0x80;
    var dv = new DataView(msg.buffer);
    dv.setUint32(total - 8, bitLenHi);
    dv.setUint32(total - 4, bitLenLo);
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Uint32Array(64);
    for (var off = 0; off < total; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + (i << 2));
      for (var t = 16; t < 64; t++) {
        var wm15 = w[t - 15], wm2 = w[t - 2];
        var s0 = rotr(wm15, 7) ^ rotr(wm15, 18) ^ (wm15 >>> 3);
        var s1 = rotr(wm2, 17) ^ rotr(wm2, 19) ^ (wm2 >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (var k = 0; k < 64; k++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA_K[k] + w[k]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = '';
    for (var q = 0; q < 8; q++) out += (H[q] >>> 0).toString(16).padStart(8, '0');
    return out;
  }

  /* ---------- key generation (CSPRNG when available) ---------- */
  function keygen(nBytes) {
    var g = globalThis;
    if (g && g.crypto && g.crypto.getRandomValues) {
      var k = new Uint8Array(nBytes);
      g.crypto.getRandomValues(k);
      return { bytes: k, strong: true };
    }
    var k2 = new Uint8Array(nBytes);
    for (var i = 0; i < nBytes; i++) k2[i] = (Math.random() * 256) | 0;
    return { bytes: k2, strong: false };
  }

  /* ---------- parse ---------- */
  function parseModule(src) {
    if (typeof acorn === 'undefined') throw new Error('acorn is not loaded');
    try {
      return acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
    } catch (e) {
      var loc = e.loc ? ' (line ' + e.loc.line + ', column ' + e.loc.column + ')' : '';
      var err = new Error('Syntax error in input' + loc + ': ' + (e.message || e));
      err.syntax = true;
      throw err;
    }
  }

  /* ---------- AST walk + string literal collection ---------- */
  /*
    edits: eligible literals in source order.
    skipped: counters per exclusion reason:
      short      - below min-string-length option
      propkey    - property / method / class member key (not an expression slot)
      module     - import / export related strings
      dynimport  - dynamic import() specifier
      directive  - top-level "use strict" etc.
      tagged     - tagged template literals
      tplsubst   - template literals containing ${} interpolations
      surrogate  - value does not survive strict utf-8 round-trip
  */
  function collectStrings(ast, src, opts) {
    opts = opts || {};
    var minLen = Math.max(1, opts.minLen === undefined ? 5 : (opts.minLen | 0));
    var edits = [];
    var skipped = { short: 0, propkey: 0, module: 0, dynimport: 0, directive: 0, tagged: 0, tplsubst: 0, surrogate: 0 };
    var totalStrings = 0;

    function isSkippableParent(parent, pkey) {
      if (!parent) return null;
      if (parent.type === 'TaggedTemplateExpression') return 'tagged';
      if (parent.type === 'ImportDeclaration' || parent.type === 'ExportAllDeclaration' ||
        parent.type === 'ImportSpecifier' || parent.type === 'ExportSpecifier' ||
        parent.type === 'ExportDefaultSpecifier' || parent.type === 'ExportNamespaceSpecifier' ||
        parent.type === 'ImportDefaultSpecifier' || parent.type === 'ImportNamespaceSpecifier' ||
        parent.type === 'ImportAttribute') return 'module';
      if ((parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition') &&
        pkey === 'key' && !parent.computed) return 'propkey';
      if (parent.type === 'ImportExpression' && pkey === 'source') return 'dynimport';
      return null;
    }

    function visitNode(node, parent, chain) {
      var t = node.type;

      /* directive prologues: first statement of the module body or of a
         function-body block ("use strict" / "use asm" stay plaintext).
         Skipping the statement subtree also skips its literal. */
      if (t === 'ExpressionStatement' && chain && chain.directiveSlot && chain.idx === 0) {
        var x = node.expression;
        if (x && x.type === 'Literal' && typeof x.value === 'string' &&
          (x.value === 'use strict' || x.value === 'use asm')) {
          skipped.directive++;
          return 'skip';
        }
      }

      var isLiteral = t === 'Literal' && typeof node.value === 'string';
      var isTpl = t === 'TemplateLiteral';
      if (!isLiteral && !isTpl) return;
      totalStrings++;

      var parentType = parent ? parent.type : null;
      var pkey = chain ? chain.key : null;

      if (isTpl) {
        if (node.expressions.length > 0) { skipped.tplsubst++; return; }
      }
      var ps = isSkippableParent(parent, pkey);
      if (ps) { skipped[ps]++; return; }

      var value;
      if (isLiteral) value = node.value;
      else {
        value = node.quasis[0].value.cooked;
        if (value === undefined) { skipped.surrogate++; return; }
      }

      if (value.length < minLen) { skipped.short++; return; }

      var enc = utf8(value);
      var st = strictDecode(enc);
      if (!st.ok || st.text !== value) { skipped.surrogate++; return; }

      if (node.start >= node.end) return;
      edits.push({ start: node.start, end: node.end, value: value, encodedBytes: enc });
    }

    /* walk tracks chain.ownerIsProgramBody = true only for the first
       element of Program.body (used for directive detection) */
    function walk(node, parent, chain) {
      if (!node || typeof node !== 'object') return;
      if (node.type) {
        var act = visitNode(node, parent, chain);
        if (act === 'skip') return;
      }
      var keys = Object.keys(node);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k === 'loc' || k === 'range') continue;
        var v = node[k];
        if (!v || typeof v !== 'object') continue;
        if (Array.isArray(v)) {
          for (var a = 0; a < v.length; a++) {
            var el = v[a];
            if (!el || typeof el !== 'object' || !el.type) continue;
            var directiveSlot = null;
            if (k === 'body' && a === 0) {
              if (node.type === 'Program') directiveSlot = 'module';
              else if (node.type === 'BlockStatement' && parent &&
                /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(parent.type)) directiveSlot = 'function';
            }
            walk(el, node, {
              key: k,
              idx: a,
              ownerIsProgramBody: (k === 'body' && node.type === 'Program' && a === 0),
              directiveSlot: directiveSlot
            });
          }
        } else if (typeof v.type === 'string') {
          walk(v, node, { key: k, idx: -1, ownerIsProgramBody: false, directiveSlot: null });
        }
      }
    }

    walk(ast, null, { key: null, idx: -1, ownerIsProgramBody: false, directiveSlot: null });

    /* the DFS order can deviate from source order (e.g. acorn exposes
       TemplateLiteral.expressions before quasis); the splice needs strict
       ascending ranges, so sort and re-index */
    edits.sort(function (a, b) { return a.start - b.start; });
    for (var i = 0; i < edits.length; i++) edits[i].index = i;
    return { edits: edits, skipped: skipped, totalStrings: totalStrings };
  }

  /* ---------- unique runtime decoder names ---------- */
  function pickDecoderName(src) {
    for (var tries = 0; tries < 200; tries++) {
      var r = keygen(4).bytes;
      var name = '_x' + toHexFast(r).slice(0, 6);
      if (src.indexOf(name) === -1) return name;
    }
    return '_x' + Date.now().toString(16);
  }

  /* ---------- XOR payload ---------- */
  function keyIdx(keyLength, r, j) {
    return (r * EL.KEY_MIX + j) % keyLength;
  }
  function xorRecord(bytes, key, r) {
    var kl = key.length;
    var out = new Uint8Array(bytes.length);
    for (var j = 0; j < bytes.length; j++) out[j] = bytes[j] ^ key[keyIdx(kl, r, j)];
    return out;
  }
  function buildPayload(edits, key) {
    var total = 0;
    for (var i = 0; i < edits.length; i++) total += 4 + edits[i].encodedBytes.length;
    var payload = new Uint8Array(total);
    var dv = new DataView(payload.buffer);
    var o = 0;
    for (var r = 0; r < edits.length; r++) {
      var b = edits[r].encodedBytes;
      dv.setUint32(o, b.length, true);
      o += 4;
      payload.set(xorRecord(b, key, r), o);
      o += b.length;
    }
    return payload;
  }
  function decodePayload(payload, key) {
    var dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    var TD = new TextDecoder('utf-8', { fatal: true });
    var out = [], o = 0, r = 0;
    var kl = key.length;
    while (o < payload.byteLength) {
      if (o + 4 > payload.byteLength) return { ok: false, records: out, reason: 'truncated record header at record ' + r };
      var L = dv.getUint32(o, true);
      o += 4;
      if (L < 0 || o + L > payload.byteLength) return { ok: false, records: out, reason: 'bad record length at record ' + r };
      var x = new Uint8Array(L);
      for (var j = 0; j < L; j++) x[j] = payload[o + j] ^ key[(r * EL.KEY_MIX + j) % kl];
      try { out.push(TD.decode(x)); }
      catch (e) { return { ok: false, records: out, reason: 'invalid utf-8 in record ' + r }; }
      o += L;
      r++;
    }
    return { ok: true, records: out };
  }

  /* ---------- runtime decoder injected into protected output ---------- */
  function decoderProgram(opts) {
    var name = opts.name;
    var tableText = opts.tableText;
    var fmt = opts.fmt;
    var keyHex = opts.keyHex;
    var loader = fmt === 'base64'
      ? 'function _Lo(s){var b=atob(s),n=b.length,u=new Uint8Array(n);for(var q=0;q<n;q++)u[q]=b.charCodeAt(q);return u}'
      : 'function _Lo(s){var n=s.length>>1,u=new Uint8Array(n);for(var q=0;q<n;q++)u[q]=parseInt(s.substr(q<<1,2),16);return u}';
    return (
      'var ' + name + '=(function(){' + loader + ';' +
      'var T=_Lo(\'' + tableText + '\'),K=_Lo(\'' + keyHex + '\'),KL=K.length,S=[],D=new TextDecoder("utf-8"),o=0,r=0;' +
      'while(o<T.length){var L=T[o]|(T[o+1]<<8)|(T[o+2]<<16)|(T[o+3]<<24);o+=4;' +
      'var c=T.subarray(o,o+L);var x=new Uint8Array(L);for(var j=0;j<L;j++)x[j]=c[j]^K[(' + EL.KEY_MIX + '*r+j)%KL];S.push(D.decode(x));o+=L;r++;}' +
      'return function(i){return S[i]};})();'
    );
  }

  /* ---------- protect pipeline ---------- */
  function protect(src, opts) {
    opts = opts || {};
    var fmt = opts.fmt === 'base64' ? 'base64' : 'hex';
    var banner = opts.banner !== false;
    var marker = opts.marker !== false;
    var t0 = Date.now();
    var ast = parseModule(src);
    var t1 = Date.now();
    var col = collectStrings(ast, src, { minLen: opts.minLen });
    var t2 = Date.now();
    if (col.edits.length === 0) {
      throw new Error('No eligible string literals found to protect. Try lowering the min-string-length option.');
    }
    var kg = keygen(32);
    var key = kg.bytes;
    var keyHex = toHexFast(key);
    var payload = buildPayload(col.edits, key);
    var t3 = Date.now();
    var tableText = fmt === 'base64' ? b64enc(payload) : toHexFast(payload);
    var t4 = Date.now();
    var name = pickDecoderName(src);

    /* splice literals into NAME(i) tokens, ascending order */
    var tokenLens = [];
    var tokTexts = [];
    var parts = [];
    var lastEnd = 0;
    for (var i = 0; i < col.edits.length; i++) {
      var e = col.edits[i];
      parts.push(src.slice(lastEnd, e.start));
      /* guard: never let the token glue onto a preceding identifier char
         (minified sources emit ctx like `case"x"` without whitespace) */
      var pre = e.start > 0 ? src.charCodeAt(e.start - 1) : 0;
      var preWord = (pre >= 48 && pre <= 57) || (pre >= 65 && pre <= 90) ||
        (pre >= 97 && pre <= 122) || pre === 95 || pre === 36 || pre > 127;
      var tok = (preWord ? ' ' : '') + name + '(' + e.index + ')';
      tokenLens.push(tok.length);
      tokTexts.push(tok);
      parts.push(tok);
      lastEnd = e.end;
    }
    parts.push(src.slice(lastEnd));
    var transformed = parts.join('');
    var t5 = Date.now();

    var nsc = null;
    if (marker) {
      nsc = '_nsc' + toHexFast(keygen(4).bytes);
      if (src.indexOf(nsc) !== -1) {
        nsc = '_nsc' + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
      }
    }
    var srcHash = sha256(utf8(src));
    var bannerText = banner
      ? ('/*! XOR-protected ' + EL.VERSION + ' | strings: ' + col.edits.length + ' | table: ' + fmt +
        ' | key: ' + keyHex.slice(0, 8) + '... | sha256(src): ' + srcHash.slice(0, 16) +
        ' | generated: ' + new Date().toISOString() + ' */\n')
      : '';
    var decoderCode = decoderProgram({ name: name, tableText: tableText, fmt: fmt, keyHex: keyHex });
    var markerLine = '';
    if (nsc) {
      markerLine = 'var ' + nsc + '="' + toHexFast(keygen(6).bytes) + '"; void ' + nsc + ';\n';
    }
    var output = bannerText + markerLine + decoderCode + '\n' + transformed;
    var t6 = Date.now();

    var srcBytes = utf8(src).length;
    var outBytes = utf8(output).length;
    var prefixLen = output.length - transformed.length;
    var tokenPositions = [];
    var delta = prefixLen;
    for (var i2 = 0; i2 < col.edits.length; i2++) {
      var e2 = col.edits[i2];
      tokenPositions.push({
        index: e2.index,
        newPos: e2.start + delta,
        oldStart: e2.start,
        oldEnd: e2.end,
        tokLen: tokenLens[i2],
        tokText: tokTexts[i2]
      });
      delta += tokenLens[i2] - (e2.end - e2.start);
    }

    var coveredChars = 0, totalChars = 0;
    var countMap = col.edits.length;
    var stats = {
      srcChars: src.length,
      outChars: output.length,
      srcBytes: srcBytes,
      outBytes: outBytes,
      growthPct: ((outBytes / Math.max(1, srcBytes)) - 1) * 100,
      stringsFound: col.totalStrings,
      stringsCovered: countMap,
      coveragePct: col.totalStrings > 0 ? (countMap / col.totalStrings) * 100 : 0,
      skipped: col.skipped,
      parseMs: t1 - t0,
      collectMs: t2 - t1,
      encodeMs: t3 - t2,
      packMs: t4 - t3,
      spliceMs: t5 - t4,
      totalMs: t6 - t0,
      payloadBytes: payload.length,
      keyStrong: kg.strong,
      shaIn: srcHash,
      decoderName: name,
      fmt: fmt
    };

    return {
      output: output,
      edits: col.edits,
      keyBytes: key,
      keyHex: keyHex,
      payload: payload,
      tableText: tableText,
      fmt: fmt,
      decoderName: name,
      bannerText: bannerText,
      marker: nsc,
      stats: stats,
      tokenPositions: tokenPositions,
      engineVersion: EL.VERSION
    };
  }

  /* ---------- verify: independently re-analyze the final output ---------- */
  function verify(opts) {
    var src = opts.protectedOutput;
    var expected = opts.edits || null;
    var tokenPositions = opts.tokenPositions || null;
    var t0 = Date.now();
    var out = parseModule(src);
    var walks = 0;

    function makeWalk(onNode) {
      return function walkV(node, parent, chain) {
        walks++;
        if (!node || typeof node !== 'object') return;
        if (node.type) onNode(node, parent, chain);
        var keys = Object.keys(node);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (k === 'loc' || k === 'range') continue;
          var v = node[k];
          if (!v || typeof v !== 'object') continue;
          if (Array.isArray(v)) {
            for (var a = 0; a < v.length; a++) {
              var el = v[a];
              if (!el || typeof el !== 'object' || !el.type) continue;
              walkV(el, node, { key: k, idx: a });
            }
          } else if (typeof v.type === 'string') {
            walkV(v, node, { key: k, idx: -1 });
          }
        }
      };
    }

    var seenNames = {};
    makeWalk(function (node) {
      if (node.type === 'CallExpression' && node.callee && node.callee.type === 'Identifier' &&
        node.arguments.length === 1 && node.arguments[0].type === 'Literal' &&
        typeof node.arguments[0].value === 'number') {
        seenNames[node.callee.name] = (seenNames[node.callee.name] || 0) + 1;
      }
    })(out, null, null);

    var best = null, bestCount = 0;
    for (var nm in seenNames) {
      if (seenNames[nm] > bestCount) { best = nm; bestCount = seenNames[nm]; }
    }
    if (!best) {
      return { pass: false, reason: 'No decoder call sites found in output.' };
    }

    var calls = [];
    makeWalk(function (node) {
      if (node.type === 'CallExpression' && node.callee && node.callee.type === 'Identifier' && node.callee.name === best &&
        node.arguments.length === 1 && node.arguments[0].type === 'Literal' &&
        typeof node.arguments[0].value === 'number') {
        calls.push({ start: node.start, idx: node.arguments[0].value });
      }
    })(out, null, null);
    calls.sort(function (a, b) { return a.start - b.start; });

    var insp = inspect(src);
    if (!insp.ok) {
      return { pass: false, reason: 'Could not table/key inside protected output: ' + insp.reason };
    }
    var dec = decodePayload(insp.payloadBytes, insp.keyBytes);
    if (!dec.ok) {
      return { pass: false, reason: 'Table decode failed: ' + dec.reason };
    }
    var records = dec.records;

    function addCheck(ok, label, detail) {
      checks.push({ ok: ok, label: label, detail: detail || '' });
      if (!ok) pass = false;
    }
    var checks = [];
    var pass = true;
    var mismatchRows = [];
    addCheck(true, 'output parses as valid ES module', 'acorn OK');
    addCheck(records.length === calls.length, 'record count == call-site count', 'records=' + records.length + ', calls=' + calls.length);
    addCheck(bestCount === calls.length, 'single decoder name used consistently', 'name=' + best);

    if (expected) {
      addCheck(expected.length === records.length, 'record count == protected literal count',
        'expected=' + expected.length + ', records=' + records.length);
      var n = Math.min(expected.length, records.length);
      for (var i = 0; i < n; i++) {
        if (records[i] !== expected[i].value) {
          pass = false;
          mismatchRows.push({ index: i, expected: String(expected[i].value).slice(0, 80), got: String(records[i]).slice(0, 80) });
        }
        if (tokenPositions && tokenPositions[i]) {
          var tp = tokenPositions[i];
          var got = src.slice(tp.newPos, tp.newPos + tp.tokLen);
          if (got !== tp.tokText) {
            pass = false;
            mismatchRows.push({ index: 'pos:' + i, expected: tp.tokText, got: got });
          }
        }
      }
      addCheck(mismatchRows.length === 0, 'literal byte-compare against originals',
        mismatchRows.length === 0 ? ('all ' + n + ' literals identical') : (mismatchRows.length + ' mismatches'));
    } else {
      addCheck(true, 'table decodes cleanly', records.length + ' records');
    }
    var ms = Date.now() - t0;
    return {
      pass: pass,
      decoderName: best,
      totalCalls: calls.length,
      records: records.length,
      mismatches: mismatchRows.slice(0, 10),
      mismatchesCount: mismatchRows.length,
      checks: checks,
      fmt: insp.fmt,
      keyHex: insp.keyHex,
      payloadBytes: insp.payloadBytes.length,
      verifyMs: ms
    };
  }

  /* ---------- inspect: decode a protected file for auditing ---------- */
  function inspect(protectedText) {
    var ast = parseModule(protectedText);
    var bigLits = [];
    var smallHexLits = [];
    var numericCallees = {};

    function walkI(node, parent, chain) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'Literal') {
        if (typeof node.value === 'string') {
          var v = node.value;
          if (v.length >= 32) bigLits.push({ start: node.start, text: v });
          if (v.length >= 16 && v.length <= 128 && /^[0-9a-fA-F]+$/.test(v)) smallHexLits.push(v);
        }
      } else if (node.type === 'CallExpression' && node.callee && node.callee.type === 'Identifier' &&
        node.arguments.length === 1 && node.arguments[0].type === 'Literal' &&
        typeof node.arguments[0].value === 'number') {
        var nm = node.callee.name;
        numericCallees[nm] = (numericCallees[nm] || 0) + 1;
      }
      var keys = Object.keys(node);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k === 'loc' || k === 'range') continue;
        var v = node[k];
        if (!v || typeof v !== 'object') continue;
        if (Array.isArray(v)) {
          for (var a = 0; a < v.length; a++) {
            var el = v[a];
            if (!el || typeof el !== 'object' || !el.type) continue;
            walkI(el, node, { key: k, idx: a });
          }
        } else if (typeof v.type === 'string') {
          walkI(v, node, { key: k, idx: -1 });
        }
      }
    }
    walkI(ast, null, null);

    if (!bigLits.length) {
      return { ok: false, reason: 'no table-sized string literals found; is this a file produced by this tool?' };
    }
    bigLits.sort(function (a, b) { return b.text.length - a.text.length; });

    var callName = null, callNameCount = 0;
    for (var cn in numericCallees) {
      if (numericCallees[cn] > callNameCount) { callName = cn; callNameCount = numericCallees[cn]; }
    }

    /* key candidates: any 16..128 char plain hex literal (keys are 16..64
       bytes -> 32..128 hex chars). The payload itself is usually longer. */
    var keysPool = Array.from(new Set(smallHexLits)).slice(0, 128);
    var tried = 0;
    var fmts = ['hex', 'base64'];
    for (var f = 0; f < fmts.length; f++) {
      var fmt = fmts[f];
      var maxTry = Math.min(bigLits.length, 8);
      for (var i = 0; i < maxTry; i++) {
        var lit = bigLits[i];
        var payload = fmt === 'hex' ? hexToBytes(lit.text) : b64dec(lit.text);
        if (!payload || payload.length < 16) continue;
        for (var kk = 0; kk < keysPool.length; kk++) {
          var keyBytes = hexToBytes(keysPool[kk]);
          if (!keyBytes || keyBytes.length < 8 || keyBytes.length > 64) continue;
          var result = decodePayload(payload, keyBytes);
          tried++;
          if (result.ok && result.records.length > 0) {
            return {
              ok: true,
              fmt: fmt,
              payloadStart: lit.start,
              payloadTextLen: lit.text.length,
              keyHex: keysPool[kk],
              keyBytes: keyBytes,
              payloadBytes: payload,
              records: result.records,
              callName: callName,
              triedCombos: tried,
              recordsCount: result.records.length
            };
          }
        }
      }
    }
    return { ok: false, reason: 'no (payload, key) pair decoded cleanly across ' + tried + ' trials; file was probably not protected by this tool.' };
  }

  EL.parseModule = parseModule;
  EL.collectStrings = collectStrings;
  EL.protect = protect;
  EL.verify = verify;
  EL.inspect = inspect;
  EL.decodePayload = decodePayload;
  EL.buildPayload = buildPayload;
  EL.sha256 = sha256;
  EL.toHexFast = toHexFast;
  EL.hexToBytes = hexToBytes;
  EL.b64enc = b64enc;
  EL.b64dec = b64dec;
  EL.utf8 = utf8;
  EL.strictDecode = strictDecode;
  EL.keygen = keygen;
  EL.decoderProgram = decoderProgram;
  EL.VER = EL.VERSION;

  globalThis.__Engine = EL;
})();
