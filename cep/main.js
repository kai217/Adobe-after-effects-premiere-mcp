/* KAI MCP Bridge — runs inside After Effects, Premiere Pro and Illustrator (CEP).
 * The MCP server drops job files (*.jsx) into a queue folder; this bridge runs them one at a time with evalScript.
 * Every second it writes a heartbeat (workDir/bridge/<host>.json) so the server can tell:
 *   connected + idle, busy with a job (and for how long), or not answering scripts (render, modal dialog, hang).
 * Two copies run per app (the visible panel and a headless auto-start copy); a lock file makes exactly one of them own the queue.
 * Design notes adapted from leancoderkavy/premiere-pro-mcp (MIT): file queue with atomic claims, headless auto-start,
 * staying idle inside the Dynamic Link render engine. */
(function () {
  'use strict';
  var cep = window.__adobe_cep__;
  function nodeRequire(m) {
    if (typeof require === 'function') return require(m);
    if (window.cep_node && window.cep_node.require) return window.cep_node.require(m);
    throw new Error('Node.js is not enabled for this panel (manifest needs --enable-nodejs). Fully restart the app.');
  }
  var fs = nodeRequire('fs'), path = nodeRequire('path'), os = nodeRequire('os');

  var env = {}; try { env = JSON.parse(cep.getHostEnvironment()); } catch (e) {}
  var appId = env.appName || '';
  var host = appId === 'PPRO' ? 'pr' : appId === 'AEFT' ? 'ae' : appId === 'ILST' ? 'il' : null;
  var appLabel = host === 'pr' ? 'Premiere Pro' : host === 'il' ? 'Illustrator' : 'After Effects';
  var me = Math.random().toString(36).slice(2, 10);
  var el = function (id) { return document.getElementById(id); };
  function show(state, cls, detail) { el('state').textContent = state; el('state').className = cls; if (detail !== undefined) el('detail').textContent = detail; }

  if (!host) { show('Unsupported app: ' + appId, 'bad', ''); return; }

  // ---------- locate the work folder (config.json next to the server; the extension folder is a link to <server>/cep) ----------
  function extensionDir() {
    var p = decodeURI(cep.getSystemPath('extension'));
    p = os.platform() === 'win32' ? p.replace('file:///', '') : p.replace('file://', '');
    try { return fs.realpathSync(p); } catch (e) { return p; }
  }
  function workDir() {
    try { var cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(extensionDir()), 'config.json'), 'utf8')); if (cfg.workDir) return cfg.workDir; } catch (e) {}
    return path.join(os.homedir(), 'KAI-AE-MCP-work');
  }
  var WORK = workDir();
  var QUEUE = host === 'ae' ? path.join(WORK, 'queue') : path.join(WORK, host, 'queue');
  var BRIDGE = path.join(WORK, 'bridge');
  var HB = path.join(BRIDGE, host + '.json');
  var LOCK = path.join(BRIDGE, host + '.lock');
  try { fs.mkdirSync(QUEUE, { recursive: true }); fs.mkdirSync(BRIDGE, { recursive: true }); } catch (e) {}

  function writeAtomic(file, text) {
    var tmp = file + '.' + me + '.tmp';
    try { fs.writeFileSync(tmp, text, 'utf8'); fs.renameSync(tmp, file); return true; }
    catch (e) { try { fs.unlinkSync(tmp); } catch (x) {} return false; }
  }
  function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } }

  // ---------- state ----------
  var renderEngine = null;     // true inside AE's windowless Dynamic Link engine: stay idle there
  var inFlight = null;         // { job, since }
  var lastReply = 0;           // last time the app answered any script
  var probeSent = 0;           // time an unanswered probe was sent (0 = none outstanding)
  var lastJob = '';
  var jobsRun = 0;

  function eval_(src, cb) { cep.evalScript(src, function (r) { lastReply = Date.now(); if (cb) cb(r); }); }

  // ---------- ownership: exactly one instance per app runs the queue ----------
  function own() {
    var lk = readJson(LOCK), now = Date.now();
    if (!lk || lk.id === me || now - lk.t > 3500) { writeAtomic(LOCK, JSON.stringify({ id: me, t: now, pid: process.pid })); return true; }
    return false;
  }

  function heartbeat() {
    if (renderEngine !== false) return;
    var owner = own();
    if (owner) writeAtomic(HB, JSON.stringify({ host: host, app: appId, version: env.appVersion, pid: process.pid, t: Date.now(),
      renderEngine: false, inFlight: inFlight, lastReply: lastReply || null, jobsRun: jobsRun, instance: me }));
    render(owner);
  }

  function render(owner) {
    var hb = owner ? null : readJson(HB), now = Date.now();
    var f = owner ? inFlight : hb && hb.inFlight, reply = owner ? lastReply : hb && hb.lastReply;
    if (!owner && (!hb || now - hb.t > 4000)) return show('Waiting for the bridge…', 'muted', QUEUE);
    if (f) show('Busy: running a job (' + Math.round((now - f.since) / 1000) + 's)', 'busy', appLabel + ' is working on ' + f.job);
    else if (reply && now - reply > 8000) show('Not responding (' + Math.round((now - reply) / 1000) + 's)', 'bad', appLabel + ' is rendering, showing a dialog, or hung.');
    else show('Connected', 'ok', appLabel + ' is ready for Claude.');
    el('last').textContent = (owner ? jobsRun : (hb && hb.jobsRun) || 0) + ' jobs run' + (lastJob ? ' · last: ' + lastJob : '');
  }

  // ---------- responsiveness probe (only while idle) ----------
  function probe() {
    if (renderEngine !== false || inFlight || probeSent) return;
    probeSent = Date.now();
    eval_('1', function () { probeSent = 0; });
  }

  // ---------- run jobs ----------
  // Jobs nobody is waiting for anymore (left over from a crash or an old session) must never run: the server gives up
  // after its timeout, so anything older than 15 minutes is moved aside as .stale instead of being executed.
  var STALE_MS = 15 * 60 * 1000;
  function nextJob() {
    var names; try { names = fs.readdirSync(QUEUE).filter(function (n) { return /\.jsx$/.test(n); }).sort(); } catch (e) { return null; }
    for (var i = 0; i < names.length; i++) {
      var f = path.join(QUEUE, names[i]), age = 0;
      try { age = Date.now() - fs.statSync(f).mtimeMs; } catch (e) { continue; }
      if (age > STALE_MS) { try { fs.renameSync(f, f + '.stale'); } catch (e) {} continue; }
      return names[i];
    }
    return null;
  }
  function tick() {
    if (renderEngine !== false || inFlight || !own()) return;
    if (probeSent && Date.now() - probeSent > 1000) return; // the app is not answering; leave jobs queued, the server reports why
    var name = nextJob(); if (!name) return;
    var src = path.join(QUEUE, name), claimed = src + '.running.' + me;
    try { fs.renameSync(src, claimed); } catch (e) { return; } // another runner took it
    var code; try { code = fs.readFileSync(claimed, 'utf8'); } catch (e) { code = null; }
    if (!code) { try { fs.unlinkSync(claimed); } catch (e) {} return; }
    var m = /^\/\/ KAI-RESULT: (.+)$/m.exec(code), resultPath = m ? m[1].trim() : null;
    code = code.replace(/^#target.*$/m, ''); // preprocessor line is for the command-line runner only
    var job = name.replace(/\.jsx$/, '');
    inFlight = { job: job, since: Date.now() };
    heartbeat();
    eval_(code, function (r) {
      inFlight = null; jobsRun++; lastJob = job + ' (' + new Date().toTimeString().slice(0, 8) + ')';
      try { fs.unlinkSync(claimed); } catch (e) {}
      // The job writes its own result. If it never got that far (syntax error before our try/catch), report the raw error.
      if (resultPath && !fs.existsSync(resultPath)) {
        setTimeout(function () {
          if (fs.existsSync(resultPath)) return;
          writeAtomic(resultPath, JSON.stringify({ id: job, ok: false, error: 'The script did not finish: ' + String(r || 'no result') }));
        }, 300);
      }
      heartbeat();
    });
  }

  function start() {
    show('Starting…', 'muted', '');
    setInterval(heartbeat, 1000);
    setInterval(tick, 150);
    setInterval(probe, 2000);
    heartbeat(); probe();
  }

  // AE launched by Premiere's Dynamic Link (aerendercore) also loads extensions; it must never take jobs meant for the real AE.
  if (host === 'ae') {
    var answered = false;
    cep.evalScript("(function(){try{return String(app.isRenderEngine===true);}catch(e){return 'false';}}())", function (r) {
      answered = true; renderEngine = String(r) === 'true';
      if (renderEngine) show('Idle (Dynamic Link render engine)', 'muted', 'This copy of After Effects is used by Premiere; the bridge stays off here.');
      else { lastReply = Date.now(); start(); }
    });
    setTimeout(function () { if (!answered) show('Waiting for After Effects…', 'muted', 'After Effects has not answered yet.'); }, 5000);
  } else { renderEngine = false; lastReply = Date.now(); start(); }
}());
