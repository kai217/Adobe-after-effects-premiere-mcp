/* KAI MCP Bridge panel: live activity feed (what Claude is doing), plan checklist, and Proceed / Deny questions.
 * Reads <workDir>/activity written by the MCP server (lib/activity.js). Only the visible panel draws; the headless copy skips this. */
(function () {
  'use strict';
  var cep = window.__adobe_cep__;
  if (!cep) return;
  function showErr(m) { var e = document.getElementById('empty'); if (e) { e.style.color = '#ff8a80'; e.textContent = 'Activity feed error: ' + m; } }
  function nodeRequire(m) {
    if (typeof require === 'function') return require(m);
    if (window.cep_node && window.cep_node.require) return window.cep_node.require(m);
    throw new Error('Node.js is not enabled');
  }
  var fs, path, os;
  try { fs = nodeRequire('fs'); path = nodeRequire('path'); os = nodeRequire('os'); } catch (e) { showErr('Node.js is off in this panel: ' + e.message); return; }
  var Buffer = window.Buffer || nodeRequire('buffer').Buffer;
  // The headless copy (1x1, no UI) skips this. Check its extension id: a docked panel can still be 0x0 when it
  // first loads with the workspace, and the old size check then switched the panel off for good (dead Send / empty Activity).
  var extId = ''; try { extId = cep.getExtensionId() || ''; } catch (e) {}
  if (extId ? /\.headless$/.test(extId) : (window.innerWidth < 50 && window.innerHeight < 50)) return;

  function extensionDir() {
    var p = decodeURI(cep.getSystemPath('extension'));
    p = os.platform() === 'win32' ? p.replace('file:///', '') : p.replace('file://', '');
    try { return fs.realpathSync(p); } catch (e) { return p; }
  }
  function workDir() {
    try { var cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(extensionDir()), 'config.json'), 'utf8')); if (cfg.workDir) return cfg.workDir; } catch (e) {}
    return path.join(os.homedir(), 'KAI-AE-MCP-work');
  }
  var DIR = path.join(workDir(), 'activity');
  try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}
  var FEED = path.join(DIR, 'feed.jsonl'), PLAN = path.join(DIR, 'plan.json'), ASK = path.join(DIR, 'ask.json');
  var el = function (id) { return document.getElementById(id); };

  // Flat UI icons (inline SVG, no emoji).
  var IC = {
    run: '<svg class="ic spin" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="none" stroke="#f5d16b" stroke-width="1.6" stroke-dasharray="18 10"/></svg>',
    done: '<svg class="ic" viewBox="0 0 12 12"><path d="M2.2 6.3l2.4 2.4 5.2-5.4" fill="none" stroke="#7ee2a0" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    err: '<svg class="ic" viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke="#ff8a80" stroke-width="1.7" stroke-linecap="round"/></svg>',
    say: '<svg class="ic" viewBox="0 0 12 12"><path d="M2 2.5h8v5H5.5L3 9.8V7.5H2z" fill="#6f9cff"/></svg>',
    warn: '<svg class="ic" viewBox="0 0 12 12"><path d="M6 1.5l4.8 8.5H1.2z" fill="#f5d16b"/><rect x="5.4" y="4.5" width="1.2" height="3" fill="#232323"/><rect x="5.4" y="8.1" width="1.2" height="1.1" fill="#232323"/></svg>',
    ask: '<svg class="ic" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#3b6fe0"/><path d="M4.6 4.6a1.5 1.5 0 1 1 2 1.4c-.5.2-.6.5-.6 1" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/><circle cx="6" cy="8.6" r=".6" fill="#fff"/></svg>',
    read: '<svg class="ic" viewBox="0 0 12 12"><path d="M1 6s1.8-3.2 5-3.2S11 6 11 6 9.2 9.2 6 9.2 1 6 1 6z" fill="none" stroke="#8a8a8a" stroke-width="1.2"/><circle cx="6" cy="6" r="1.4" fill="#8a8a8a"/></svg>',
    todo: '<svg class="ic" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="none" stroke="#666" stroke-width="1.3"/></svg>',
    cur: '<svg class="ic" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="#3b6fe0"/></svg>'
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }
  function tail(f, bytes) {
    try {
      var st = fs.statSync(f), start = Math.max(0, st.size - bytes), len = st.size - start, buf = Buffer.alloc(len), fd = fs.openSync(f, 'r');
      fs.readSync(fd, buf, 0, len, start); fs.closeSync(fd);
      var lines = buf.toString('utf8').split('\n'); if (start > 0) lines.shift();
      return lines.filter(Boolean);
    } catch (e) { return []; }
  }
  function ago(t) { var s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + 's' : s < 3600 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h'; }
  function dur(ms) { return ms == null ? '' : ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's'; }

  // ---------- feed ----------
  var lastFeedKey = '';
  function drawFeed() {
    var lines = tail(FEED, 96 * 1024), byId = {}, list = [];
    for (var i = 0; i < lines.length; i++) {
      var e; try { e = JSON.parse(lines[i]); } catch (x) { continue; }
      if (e.kind === 'tool' && e.id) { if (byId[e.id]) { byId[e.id].ev = e; continue; } byId[e.id] = { ev: e }; list.push(byId[e.id]); }
      else list.push({ ev: e });
    }
    list = list.slice(-300).reverse(); // newest on top; the feed scrolls for older steps
    var key = lines.length + ':' + (lines[lines.length - 1] || '') + ':' + Math.floor(Date.now() / 5000);
    if (key === lastFeedKey) return; lastFeedKey = key;
    if (!list.length) return;
    // live build counter in the tab bar (text of the newest ae_build_live step starts with "12/30")
    var cnt = el('count'); if (cnt) { var top = list[0].ev, m = top.kind === 'tool' && top.tool === 'ae_build_live' ? /^(\d+)\/(\d+)/.exec(top.text || '') : null; cnt.textContent = m ? m[1] + ' / ' + m[2] + ' steps' : ''; }
    var h = '';
    for (var j = 0; j < list.length; j++) {
      var ev = list[j].ev, ic, cls = 'ev', extra = '', tag = ev.app ? '<span class="tag ' + ev.app + '">' + ev.app.toUpperCase() + '</span>' : '';
      if (ev.kind === 'tool') {
        ic = ev.status === 'running' ? IC.run : ev.status === 'error' ? IC.err : ev.edit ? IC.done : IC.read;
        if (ev.status === 'error' && ev.error) extra = '<div class="err">' + esc(ev.error) + '</div>';
      } else if (ev.kind === 'say') { ic = ev.level === 'warn' ? IC.warn : ev.level === 'done' ? IC.done : IC.say; cls += ev.level === 'warn' ? ' say warn' : ' say'; }
      else if (ev.kind === 'ask' || ev.kind === 'answer') { ic = IC.ask; cls += ' say'; }
      else { ic = IC.cur; cls += ' say'; }
      var meta = ev.kind === 'tool' && ev.status !== 'running' ? dur(ev.ms) : ago(ev.t);
      h += '<div class="' + cls + '">' + ic + '<div class="tx">' + esc(ev.kind === 'answer' ? 'You chose: ' + ev.text : ev.text) + tag + extra + '</div><div class="meta">' + meta + '</div></div>';
    }
    el('feed').innerHTML = h;
  }

  // ---------- plan ----------
  var lastPlan = '';
  function drawPlan() {
    var p = readJson(PLAN);
    // A finished plan from an earlier job is put away after 10 minutes, so a new run (or a recording) starts with a clean panel.
    try { if (p && p.steps && (p.done || []).length >= p.steps.length && Date.now() - fs.statSync(PLAN).mtimeMs > 600000) p = null; } catch (e) {}
    var key = JSON.stringify(p);
    if (key === lastPlan) return; lastPlan = key;
    if (!p || !p.steps || !p.steps.length) { el('planBox').style.display = 'none'; return; }
    el('planBox').style.display = 'block';
    el('planTitle').textContent = p.title || 'Plan';
    var done = {}; (p.done || []).forEach(function (i) { done[i] = 1; });
    var h = '';
    p.steps.forEach(function (s, i) {
      var st = done[i] ? 'done' : (i === p.current ? 'cur' : '');
      h += '<div class="step ' + st + '">' + (done[i] ? IC.done : i === p.current ? IC.cur : IC.todo) + '<div>' + esc(s) + '</div></div>';
    });
    el('plan').innerHTML = h;
  }

  // ---------- questions ----------
  var shownAsk = null;
  function drawAsk() {
    var a = readJson(ASK);
    if (a && a.t && a.timeoutSec && Date.now() - a.t > a.timeoutSec * 1000 + 5000) a = null; // expired
    var id = a && a.id;
    if (id === shownAsk) return; shownAsk = id;
    if (!a) { el('ask').style.display = 'none'; return; }
    el('askQ').textContent = a.question;
    var box = el('askBtns'); box.innerHTML = '';
    (a.options || ['Proceed', 'Deny']).forEach(function (o, i) {
      var b = document.createElement('button'); b.textContent = o; if (i === 0) b.className = 'primary';
      b.onclick = function () {
        try { fs.writeFileSync(path.join(DIR, 'answer-' + a.id + '.json'), JSON.stringify({ choice: o, t: Date.now() })); } catch (e) {}
        el('ask').style.display = 'none';
      };
      box.appendChild(b);
    });
    el('ask').style.display = 'block';
    try { window.focus(); } catch (e) {}
  }

  var lastErr = '';
  function tick() { try { drawAsk(); drawPlan(); drawFeed(); } catch (e) { var m = String(e && e.message || e); if (m !== lastErr) { lastErr = m; showErr(m); } } }
  setInterval(tick, 500);
  tick();
}());
