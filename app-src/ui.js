/* XOR Shield UI - browser only */
(function () {
  var E = globalThis.__Engine;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- shared helpers ---------- */
  var state = { lastProtect: null, lastSrcText: null };
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2200);
  }
  function fmtBytes(n) {
    if (!isFinite(n)) return '?';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function fmtMs(n) {
    return n >= 1000 ? (n / 1000).toFixed(2) + ' s' : n + ' ms';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function copyText(txt, okMsg) {
    var done = function () { toast(okMsg || 'Copied to clipboard'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt); done(); });
    } else { fallbackCopy(txt); done(); }
  }
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { }
    document.body.removeChild(ta);
  }
  function setProgress(id, labelId, label, on) {
    var box = $(id);
    if (box) box.classList.toggle('on', !!on);
    var el = labelId ? $(labelId) : null;
    if (el && label !== undefined && label !== null) el.textContent = label;
  }

  /* permanent, visible error ribbon for ANY uncaught UI error */
  window.addEventListener('error', function (ev) {
    var msg = (ev && (ev.message || (ev.error && ev.error.message))) || 'unknown error';
    try {
      var r = $('uiErrorRibbon');
      if (!r) return;
      r.innerHTML = '&#9888;&#65039; UI error: <code>' + esc(String(msg).slice(0, 220)) + '</code>' +
        ' &middot; <button class="ribclose" onclick="this.parentNode.classList.add(\'hidden\')">dismiss</button>';
      r.classList.remove('hidden');
    } catch (e) { /* keep silent */ }
  });

  /* ---------- tabs ---------- */
  var tabs = document.querySelectorAll('.tabs button');
  for (var t = 0; t < tabs.length; t++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
        btn.classList.add('active');
        var names = ['protect', 'verify', 'inspect', 'help'];
        for (var x = 0; x < names.length; x++) {
          var el = $('tab-' + names[x]);
          if (el) el.classList.toggle('active', names[x] === btn.getAttribute('data-tab'));
        }
      });
    })(tabs[t]);
  }

  /* ---------- drag&drop wiring ---------- */
  function wireDrop(dropId, fileInputId, nameElId, onFile) {
    var dz = $(dropId), input = $(fileInputId), nameEl = $(nameElId);
    dz.addEventListener('click', function () { input.click(); });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('over'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      dz.classList.remove('over');
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) loadFile(input.files[0]);
    });
    function loadFile(f) {
      f.text().then(function (txt) {
        nameEl.textContent = f.name + '  (' + fmtBytes(f.size) + ')';
        nameEl.classList.remove('hidden');
        onFile(txt, f.name);
      }, function (err) {
        toast('Could not read file: ' + (err && err.message || err));
      });
    }
  }

  /* ---------- results rendering ---------- */
  function statCard(k, v, cls) {
    return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' + esc(String(v)) + '</div></div>';
  }
  function renderCheckList(result, mount) {
    var html = '<div class="checks">';
    for (var i = 0; i < result.checks.length; i++) {
      var c = result.checks[i];
      html += '<div class="c ' + (c.ok ? 'ok' : 'no') + '"><span class="s">' + (c.ok ? '&#10004;' : '&#10008;') +
        '</span><span>' + esc(c.label) + '</span><span class="d">' + esc(c.detail) + '</span></div>';
    }
    html += '</div>';
    if (result.mismatches && result.mismatches.length) {
      html += '<table class="scatter"><thead><tr><th>#</th><th>expected</th><th>got</th></tr></thead><tbody>';
      for (var m = 0; m < result.mismatches.length; m++) {
        var r = result.mismatches[m];
        html += '<tr><td class="num">' + esc(r.index) + '</td><td class="prev">' + esc(r.expected) +
          '</td><td class="prev">' + esc(r.got) + '</td></tr>';
      }
      html += '</tbody></table>';
    }
    mount.innerHTML = html;
  }
  function verifyBadge(result) {
    if (result.pass) {
      return '<span class="badge pass">&#9989; ROUND-TRIP PASS &middot; ' + result.records + ' records &middot; ' +
        fmtMs(result.verifyMs) + '</span>';
    }
    return '<span class="badge fail">&#10008; FAIL</span>';
  }

  /* ---------- protect flow ---------- */
  var srcText = null, srcName = '';
  wireDrop('dropSrc', 'fileSrc', 'dropSrcName', function (txt, name) {
    srcText = txt; srcName = name;
    $('srcBox').value = '';
    toast('Loaded ' + name);
  });

  $('btnProtect').addEventListener('click', function () {
    if (srcText === null || $('srcBox').value.trim() !== '') srcText = $('srcBox').value;
    if (!srcText || !srcText.trim()) {
      var note = $('noSrcNote');
      if (note) {
        note.classList.remove('hidden');
        try { note.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e2) { /* old browsers */ }
      }
      toast('Load a file or paste code first');
      return;
    }
    var note2 = $('noSrcNote');
    if (note2) note2.classList.add('hidden');
    if (!E) { toast('Engine failed to load'); return; }
    var btn = this;
    btn.disabled = true;
    setProgress('progProtect', 'progProtectLabel', 'parsing (acorn ES module)...', true);
    var opts = {
      minLen: parseInt($('optMinLen').value, 10) || 5,
      fmt: $('optFmt').value,
      banner: $('optBanner').checked,
      marker: $('optMarker').checked
    };
    setTimeout(function () {
      var p = null, vres = null, errMsg = null;
      try { p = E.protect(srcText, opts); }
      catch (e) {
        errMsg = e.message;
      }
      setProgress('progProtect', 'progProtectLabel', 'verifying round-trip...', true);
      if (p) {
        try {
          vres = E.verify({ protectedOutput: p.output, edits: p.edits, tokenPositions: p.tokenPositions });
        } catch (e2) { vres = { pass: false, checks: [{ ok: false, label: 'verify crashed', detail: e2.message }] }; }
      }
      setTimeout(function () {
        setProgress('progProtect', null, null, false);
        btn.disabled = false;
        if (errMsg) {
          $('cardResult').classList.remove('hidden');
          $('cardVerifyAuto').classList.remove('hidden');
          $('statsGrid').innerHTML = statCard('error', errMsg, 'dg');
          $('skipTable').querySelector('tbody').innerHTML = '';
          $('outPrev').textContent = '';
          $('passBadge').innerHTML = '<span class="badge fail">&#10008; PROTECT FAILED</span>';
          return;
        }
        state.lastProtect = p;
        state.lastSrcText = srcText;
        $('passBadge').innerHTML = '<span class="badge pass">&#10004; PROTECTED &amp; VERIFIED</span>';
        renderProtectResult(p);
        renderVerifyCard($('verifyAutoBody'), vres);
        $('cardVerifyAuto').classList.remove('hidden');
        toast('Protected OK — ' + p.edits.length + ' strings');
        try { $('cardResult').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e3) { /* old browsers */ }
      }, 15);
    }, 15);
  });

  function renderProtectResult(p) {
    var st = p.stats;
    $('cardResult').classList.remove('hidden');
    $('resVer').textContent = 'engine v' + p.engineVersion + ' · decoder ' + p.decoderName;
    $('statsGrid').innerHTML =
      statCard('source', fmtBytes(st.srcBytes) + ' / ' + st.srcChars.toLocaleString() + ' chars') +
      statCard('output', fmtBytes(st.outBytes) + ' / ' + st.outChars.toLocaleString() + ' chars', st.growthPct > 150 ? 'dg' : '') +
      statCard('growth', '+' + st.growthPct.toFixed(1) + '%', st.growthPct > 150 ? 'dg' : 'ok') +
      statCard('strings found', st.stringsFound) +
      statCard('strings XORed', st.stringsCovered, 'ac') +
      statCard('coverage', st.coveragePct.toFixed(1) + '%', st.coveragePct > 60 ? 'ok' : '') +
      statCard('payload table', fmtBytes(st.payloadBytes) + ' · ' + st.fmt) +
      statCard('total time', fmtMs(st.totalMs), 'ok') +
      statCard('parse', fmtMs(st.parseMs)) +
      statCard('collect', fmtMs(st.collectMs)) +
      statCard('encode+pack', fmtMs(st.encodeMs + st.packMs)) +
      statCard('key source', st.keyStrong ? 'CSPRNG' : 'weak (no crypto)', st.keyStrong ? 'ok' : 'dg');

    var skipRows = '';
    var reasons = [
      ['short', 'below min length'],
      ['propkey', 'property keys'],
      ['module', 'import/export strings'],
      ['dynimport', 'dynamic import()'],
      ['directive', '"use strict" etc'],
      ['tagged', 'tagged templates'],
      ['tplsubst', 'templates with ${}'],
      ['surrogate', 'not utf-8 safe']
    ];
    for (var i = 0; i < reasons.length; i++) {
      var k = reasons[i][0];
      if (st.skipped[k]) skipRows += '<tr><td>' + reasons[i][1] + '</td><td class="num">' + st.skipped[k] + '</td></tr>';
    }
    $('skipTable').querySelector('tbody').innerHTML = skipRows || '<tr><td colspan="2">none — full coverage</td></tr>';
    $('keyVal').textContent = p.keyHex;
    $('outPrev').textContent = p.output.length > 6000
      ? p.output.slice(0, 3000) + '\n/* ...' + (p.output.length - 5200) + ' chars elided... */\n' + p.output.slice(p.output.length - 2200)
      : p.output;
  }

  function renderVerifyCard(mount, vres) {
    if (!vres) { mount.innerHTML = '<div class="note dg">verify did not run</div>'; return; }
    var head = '<div style="margin:10px 0">' + verifyBadge(vres) + '</div>';
    head += '<div class="kv"><span class="k">decoder:</span><span class="v">' + esc(vres.decoderName || '-') +
      '</span><span class="k">table:</span><span class="v">' + esc(vres.fmt || '-') +
      '</span><span class="k">records:</span><span class="v">' + vres.records + '</span></div>';
    mount.innerHTML = head;
    var list = document.createElement('div');
    renderCheckList(vres, list);
    mount.appendChild(list);
  }

  /* ---------- download helper ---------- */
  function downloadText(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/javascript;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
  }

  $('btnDownload').addEventListener('click', function () {
    if (!state.lastProtect) { toast('Nothing to download yet'); return; }
    downloadText('worker.protected.js', state.lastProtect.output);
    toast('Downloaded worker.protected.js');
  });
  $('btnCopyOut').addEventListener('click', function () {
    if (!state.lastProtect) { toast('Nothing to copy yet'); return; }
    copyText(state.lastProtect.output, 'Output copied (' + fmtBytes(state.lastProtect.stats.outBytes) + ')');
  });
  $('btnCopyKey').addEventListener('click', function () {
    if (!state.lastProtect) { toast('No key yet'); return; }
    copyText(state.lastProtect.keyHex, 'XOR key copied (save it!)');
  });
  $('btnReverify').addEventListener('click', function () {
    if (!state.lastProtect) { toast('Nothing to verify yet'); return; }
    document.querySelector('[data-tab="verify"]').click();
    /* pre-filled from last run */
    verifyLastRun();
  });

  /* ---------- verify tab ---------- */
  var origText = null, protText = null;
  wireDrop('dropOrig', 'fileOrig', 'dropOrigName', function (txt) {
    origText = txt;
    toast('Original loaded');
  });
  wireDrop('dropProt', 'fileProt', 'dropProtName', function (txt) {
    protText = txt;
    toast('Protected file loaded');
  });

  function verifyLastRun() {
    if (!state.lastProtect && !protText) { toast('Nothing to verify — run Protect or drop files'); return; }
    var vres;
    setProgress('progVerify', 'progVerifyLabel', 'analyzing...', true);
    setTimeout(function () {
      try {
        if (protText) {
          vres = E.verify({
            protectedOutput: protText,
            edits: origText ? optionsEdits(origText) : (state.lastProtect ? state.lastProtect.edits : null)
          });
        } else {
          vres = E.verify({
            protectedOutput: state.lastProtect.output,
            edits: state.lastProtect.edits,
            tokenPositions: state.lastProtect.tokenPositions
          });
        }
      } catch (e) {
        vres = { pass: false, reason: null, checks: [{ ok: false, label: 'verify crashed', detail: e.message }], mismatches: [] };
      }
      setProgress('progVerify', null, null, false);
      var mount = $('verifyBody');
      mount.innerHTML = '';
      var card = document.createElement('div');
      renderVerifyCard(card, vres);
      mount.appendChild(card);
      toast(vres ? (vres.pass ? 'Verify: PASS' : 'Verify: FAIL') : 'verify did not run');
    }, 15);
  }

  /* when original is re-collected fresh (manual pair), reuse current options */
  function optionsEdits(srcText) {
    var ast = E.parseModule(srcText);
    var minLen = parseInt($('optMinLen').value, 10) || 5;
    return E.collectStrings(ast, srcText, { minLen: minLen }).edits;
  }

  $('btnVerify').addEventListener('click', function () {
    if (!protText) { toast('Drop the protected output first'); return; }
    if (!origText) { toast('Drop the original source too (for full byte-compare)'); return; }
    verifyLastRun();
  });
  $('btnVerifyLast').addEventListener('click', function () {
    if (state.lastProtect && !protText) { verifyLastRun(); return; }
    if (protText) { verifyLastRun(); return; }
    toast('Nothing cached — drop both files, or run Protect first');
  });

  /* ---------- inspect tab ---------- */
  wireDrop('dropInsp', 'fileInsp', 'dropInspName', function (txt) {
    inspText = txt;
    toast('Protected file loaded for inspection');
  });
  var inspText = null;

  $('btnInspect').addEventListener('click', function () {
    if (!inspText || !inspText.trim()) { toast('Drop a protected file first'); return; }
    var btn = this;
    btn.disabled = true;
    setTimeout(function () {
      var res = null, err = null;
      try { res = E.inspect(inspText); } catch (e) { err = e.message; }
      btn.disabled = false;
      var mount = $('inspectBody');
      if (err) {
        mount.innerHTML = '<div class="note dg" style="margin-top:10px">Inspect failed: ' + esc(err) + '</div>';
        return;
      }
      if (!res.ok) {
        mount.innerHTML = '<div class="note dg" style="margin-top:10px">' + esc(res.reason) + '</div>';
        return;
      }
      var html = '<div class="stats-grid" style="margin-top:12px">' +
        statCard('decoder call', res.callName || '-', 'ac') +
        statCard('table format', res.fmt) +
        statCard('key (hex)', res.keyHex.slice(0, 16) + '… (' + (res.keyHex.length / 2) + ' B)') +
        statCard('payload size', fmtBytes(res.payloadBytes.length)) +
        statCard('records decoded', res.recordsCount, 'ok') +
        statCard('probe trials', res.triedCombos) +
        '</div>';
      html += '<table class="inspect"><thead><tr><th>i</th><th>len</th><th>string (first 160 chars)</th></tr></thead><tbody>';
      var MAX = 200;
      var n = Math.min(res.records.length, MAX);
      for (var i = 0; i < n; i++) {
        var s = res.records[i];
        html += '<tr><td class="num">' + i + '</td><td class="num">' + s.length +
          '</td><td class="prev" title="full value in export">' + esc(s.slice(0, 160)) + '</td></tr>';
      }
      html += '</tbody></table>';
      if (res.records.length > MAX) {
        html += '<p class="note" style="margin-top:8px">Showing first ' + MAX + ' of ' + res.records.length +
          ' records — use Export JSON for the full table.</p>';
      }
      html += '<div class="actions"><button class="btn" id="btnInspExport">&#11015;&#65039; Export JSON</button>' +
        '<button class="btn ghost" id="btnInspKey">Copy key</button></div>';
      mount.innerHTML = html;
      $('btnInspExport').addEventListener('click', function () {
        downloadText('protected-strings.json', JSON.stringify({
          keyHex: res.keyHex,
          fmt: res.fmt,
          recordedAt: new Date().toISOString(),
          count: res.records.length,
          records: res.records
        }, null, 2), 'application/json;charset=utf-8');
        toast('Exported ' + res.records.length + ' records');
      });
      $('btnInspKey').addEventListener('click', function () { copyText(res.keyHex, 'Key copied'); });
    }, 15);
  });
})();
