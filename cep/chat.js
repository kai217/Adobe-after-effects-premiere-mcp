/* KAI MCP Bridge panel: chat with Claude right inside After Effects / Premiere Pro / Illustrator.
 * Each message runs Claude Code headless (`claude -p`) on this computer with ONLY this MCP server's tools (no shell, no file edits),
 * resuming the same session so the conversation continues. Uses the user's own Claude Code sign-in (Pro/Max) — no API key here.
 * Steps show live from the activity feed; Claude's replies stream into the chat. History: <workDir>/chat/history.jsonl */
(function () {
  'use strict';
  var cep = window.__adobe_cep__;
  if (!cep) return;
  function nodeRequire(m) {
    if (typeof require === 'function') return require(m);
    if (window.cep_node && window.cep_node.require) return window.cep_node.require(m);
    throw new Error('Node.js is not enabled');
  }
  var fs, path, os, cp;
  try { fs = nodeRequire('fs'); path = nodeRequire('path'); os = nodeRequire('os'); cp = nodeRequire('child_process'); } catch (e) { var h = document.getElementById('chatLog'); if (h) h.innerHTML = '<div class="msg err">Chat is off: Node.js is not enabled in this panel (' + e.message + ')</div>'; return; }
  var Buffer = window.Buffer || nodeRequire('buffer').Buffer;
  var process = window.process || nodeRequire('process');
  // The headless copy (1x1, no UI) skips this. Check its extension id: a docked panel can still be 0x0 when it
  // first loads with the workspace, and the old size check then switched the panel off for good (dead Send / empty Activity).
  var extId = ''; try { extId = cep.getExtensionId() || ''; } catch (e) {}
  if (extId ? /\.headless$/.test(extId) : (window.innerWidth < 50 && window.innerHeight < 50)) return;

  var env = {}; try { env = JSON.parse(cep.getHostEnvironment()); } catch (e) {}
  var APP = env.appName === 'PPRO' ? 'Premiere Pro' : env.appName === 'ILST' ? 'Illustrator' : 'After Effects';
  function extensionDir() {
    var p = decodeURI(cep.getSystemPath('extension'));
    p = os.platform() === 'win32' ? p.replace('file:///', '') : p.replace('file://', '');
    try { return fs.realpathSync(p); } catch (e) { return p; }
  }
  var ROOT = path.dirname(extensionDir());          // the MCP server folder (cep/ is linked from it)
  var CFG = {}; try { CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch (e) {}
  var WORK = CFG.workDir || path.join(os.homedir(), 'KAI-AE-MCP-work');
  var DIR = path.join(WORK, 'chat');
  try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}
  var HIST = path.join(DIR, 'history.jsonl'), SESS = path.join(DIR, 'session.json');
  var FEED = path.join(WORK, 'activity', 'feed.jsonl');
  var el = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }

  // ---------- find Claude Code ----------
  function findClaude() {
    if (CFG.claudePath && fs.existsSync(CFG.claudePath)) return CFG.claudePath;
    var home = os.homedir(), c = [];
    if (os.platform() === 'win32') {
      c.push(path.join(home, '.local', 'bin', 'claude.exe'));
      if (process.env.APPDATA) c.push(path.join(process.env.APPDATA, 'npm', 'claude.cmd'));
      if (process.env.LOCALAPPDATA) c.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'claude', 'claude.exe'));
    } else {
      c.push(path.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude', path.join(home, '.npm-global', 'bin', 'claude'));
    }
    for (var i = 0; i < c.length; i++) if (fs.existsSync(c[i])) return c[i];
    try {
      var w = cp.execSync(os.platform() === 'win32' ? 'where claude' : 'command -v claude', { encoding: 'utf8', timeout: 4000 }).split(/\r?\n/)[0].trim();
      if (w && fs.existsSync(w)) return w;
    } catch (e) {}
    return null;
  }
  function findNode() {
    if (CFG.nodePath && fs.existsSync(CFG.nodePath)) return CFG.nodePath;
    var c = os.platform() === 'win32' ? ['C:\\Program Files\\nodejs\\node.exe'] : ['/usr/local/bin/node', '/opt/homebrew/bin/node'];
    for (var i = 0; i < c.length; i++) if (fs.existsSync(c[i])) return c[i];
    return 'node';
  }

  // ---------- files Claude Code reads ----------
  function writeSetup() {
    var mcp = { mcpServers: { 'kai-ae-mcp': { command: findNode(), args: [path.join(ROOT, 'server.js')] } } };
    fs.writeFileSync(path.join(DIR, 'mcp.json'), JSON.stringify(mcp, null, 1));
    var sys = [
      'You are Claude, working inside the user\'s Adobe apps through the kai-ae-mcp tools (After Effects, Premiere Pro, Illustrator).',
      'The user is typing to you from the KAI MCP Bridge panel inside ' + APP + '. They see your replies in a small panel, so keep each reply to a few short sentences, no code unless asked.',
      'For any job with more than two steps, call kai_plan first with every step, then update it as you go. Use kai_say for a one-line update between steps. Use kai_ask (Proceed / Deny in the panel) before anything hard to undo: overwriting or deleting files or comps, long renders.',
      'Call ae_status / pr_status / il_status and the matching *_guide once before editing. Work in duplicates of pre-comps, never change shared originals or slice the master comp. Check your work with preview frames before saying it is done.',
      'When you build anything in After Effects (a new comp, a title, graphics, animation), use ae_build_live: one layer or one visible change per step, with a short plain label, so the user watches each layer appear in the timeline. Use ae_run_script only for reading or for one small fix.',
      'You can only use the kai-ae-mcp tools here (no shell or file editing). If something needs more than that, say so in one sentence.'
    ].join('\n');
    fs.writeFileSync(path.join(DIR, 'system.txt'), sys);
  }

  // ---------- history ----------
  function addHist(role, text, extra) {
    var m = { t: Date.now(), role: role, text: text }; if (extra) for (var k in extra) m[k] = extra[k];
    try { fs.appendFileSync(HIST, JSON.stringify(m) + '\n'); } catch (e) {}
    msgs.push(m); draw();
  }
  var msgs = [];
  try { msgs = fs.readFileSync(HIST, 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); }).slice(-40); } catch (e) {}

  // ---------- drawing (newest at the bottom; older messages drop off the top, no inner scroll bar) ----------
  var live = '', working = '';
  function lastStep() {
    try {
      var st = fs.statSync(FEED), start = Math.max(0, st.size - 8192), buf = Buffer.alloc(st.size - start), fd = fs.openSync(FEED, 'r');
      fs.readSync(fd, buf, 0, buf.length, start); fs.closeSync(fd);
      var lines = buf.toString('utf8').split('\n').filter(Boolean);
      for (var i = lines.length - 1; i >= 0; i--) { try { var e = JSON.parse(lines[i]); if (e.t >= runStart && (e.kind === 'tool' || e.kind === 'say' || e.kind === 'plan')) return e.text; } catch (x) {} }
    } catch (e) {}
    return '';
  }
  function draw() {
    var h = '';
    if (!msgs.length && !child) h = '<div class="hint">Ask for anything in ' + esc(APP) + ', Premiere or Illustrator. Example: "Make the hex cluster in S03 20% bigger."</div>';
    msgs.slice(-40).forEach(function (m) {
      if (m.role === 'user') h += '<div class="msg you">' + esc(m.text) + '</div>';
      else if (m.role === 'error') h += '<div class="msg err">' + esc(m.text) + '</div>';
      else h += '<div class="msg cl">' + esc(m.text).replace(/\n/g, '<br>') + (m.meta ? '<div class="m">' + esc(m.meta) + '</div>' : '') + '</div>';
    });
    if (child) {
      if (live) h += '<div class="msg cl">' + esc(live).replace(/\n/g, '<br>') + '</div>';
      h += '<div class="working"><svg class="ic spin" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="none" stroke="#f5d16b" stroke-width="1.6" stroke-dasharray="18 10"/></svg>' + esc(working || 'Thinking…') + '</div>';
    }
    var box = el('chatLog'); box.innerHTML = h;
    // keep the newest visible: drop old messages off the top until it fits
    while (box.scrollHeight > box.clientHeight && box.children.length > 1) box.removeChild(box.firstChild);
    el('chatSend').textContent = child ? 'Stop' : 'Send';
    el('chatSend').className = child ? '' : 'primary';
  }

  // ---------- run Claude Code ----------
  var child = null, runStart = 0, buf = '';
  function send(text) {
    text = String(text || '').trim(); if (!text) return;
    var exe = findClaude();
    if (!exe) {
      addHist('error', 'Claude Code is not installed on this computer yet. Install it once (see the KAI-AE-MCP README, "Chat inside the apps"), sign in by running `claude` in a terminal, then try again.');
      return;
    }
    writeSetup();
    addHist('user', text);
    var sess = readJson(SESS), args = ['-p', '--output-format', 'stream-json', '--verbose',
      '--mcp-config', path.join(DIR, 'mcp.json'), '--strict-mcp-config', '--tools', '',
      '--allowedTools', 'mcp__kai-ae-mcp', '--append-system-prompt-file', path.join(DIR, 'system.txt')];
    if (sess && sess.id) args.push('--resume', sess.id);
    if (CFG.chatModel) args.push('--model', CFG.chatModel);
    var isCmd = /\.cmd$/i.test(exe);
    var spawnArgs = isCmd ? args.map(function (a) { return a === '' ? '""' : /\s/.test(a) ? '"' + a + '"' : a; }) : args;
    live = ''; working = 'Starting Claude…'; runStart = Date.now(); buf = '';
    try {
      child = cp.spawn(exe, spawnArgs, { cwd: DIR, shell: isCmd, windowsHide: true, env: process.env });
    } catch (e) { child = null; addHist('error', 'Could not start Claude Code: ' + e.message); return; }
    var replied = false, errText = '';
    child.stdout.on('data', function (d) {
      buf += d.toString('utf8');
      var lines = buf.split('\n'); buf = lines.pop();
      lines.forEach(function (l) {
        var m; try { m = JSON.parse(l); } catch (e) { return; }
        if (m.type === 'system' && m.subtype === 'init' && m.session_id) { try { fs.writeFileSync(SESS, JSON.stringify({ id: m.session_id, t: Date.now() })); } catch (e) {} }
        if (m.type === 'assistant' && m.message && m.message.content) {
          m.message.content.forEach(function (c) {
            if (c.type === 'text' && c.text) live = (live ? live + '\n\n' : '') + c.text;
            if (c.type === 'tool_use') working = 'Using ' + String(c.name || '').replace(/^mcp__kai-ae-mcp__/, '');
          });
          draw();
        }
        if (m.type === 'result') {
          var final = live || m.result || '';
          if (m.is_error) {
            replied = true;
            var et = String(m.result || (m.errors && m.errors.join(' ')) || m.subtype || 'Claude Code reported an error');
            if (/authenticat|log ?in|api key|credit/i.test(et)) et = 'Claude Code is not signed in (or the sign-in expired). Open a terminal, run `claude`, sign in with your Claude account, then send again.';
            addHist('error', et.slice(0, 400));
          } else if (final) { replied = true; addHist('claude', final, { meta: Math.round((m.duration_ms || 0) / 1000) + 's' + (m.num_turns ? ' · ' + m.num_turns + ' steps' : '') }); }
          live = '';
        }
      });
    });
    child.stderr.on('data', function (d) { errText += d.toString('utf8'); });
    child.on('error', function (e) { errText += e.message; });
    child.on('close', function (code) {
      child = null; working = '';
      if (live && !replied) { addHist('claude', live); live = ''; }
      if (!replied && (code || errText)) {
        var t = errText.trim().split('\n').slice(-3).join(' ').slice(0, 400);
        if (/login|log in|authenticat|\/login/i.test(t)) t = 'Claude Code is not signed in. Open a terminal, run `claude`, sign in with your Claude account, then try again.';
        if (sess && /session|resume|No conversation/i.test(t)) { try { fs.unlinkSync(SESS); } catch (e) {} t += ' (Started a new chat; send again.)'; }
        addHist('error', t || ('Claude Code stopped (exit ' + code + ')'));
      }
      draw();
    });
    try { child.stdin.write(text); child.stdin.end(); } catch (e) {}
    draw();
  }
  function stop() {
    if (!child) return;
    try { if (os.platform() === 'win32') cp.exec('taskkill /pid ' + child.pid + ' /T /F'); else child.kill('SIGTERM'); } catch (e) {}
    addHist('error', 'Stopped.');
  }
  function newChat() {
    if (child) return;
    try { fs.unlinkSync(SESS); } catch (e) {}
    try { fs.renameSync(HIST, path.join(DIR, 'history-' + Date.now() + '.jsonl')); } catch (e) {}
    msgs = []; draw();
  }

  // ---------- wire up ----------
  var input = el('chatInput');
  el('chatSend').onclick = function () { if (child) stop(); else { var v = input.value; input.value = ''; send(v); } };
  el('chatNew').onclick = newChat;
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!child) { var v = input.value; input.value = ''; send(v); } }
  });
  setInterval(function () { if (child) { var s = lastStep(); if (s) working = s; draw(); } }, 700);

  // ---------- prompt drop-in ----------
  // A prompt saved as <workDir>/chat/inbox-<APP>.txt (APP = ILST, AEFT or PPRO) or inbox.txt is typed into this
  // panel's chat box and sent, exactly as if typed here. Lets a run start with nobody at the computer (and no
  // remote control of the screen). Only one panel picks up each file.
  var APPCODE = env.appName || '', typing = false;
  function takeInbox() {
    var names = ['inbox-' + APPCODE + '.txt', 'inbox.txt'];
    for (var i = 0; i < names.length; i++) {
      var f = path.join(DIR, names[i]), mine = f + '.' + process.pid + '.taking';
      try { fs.renameSync(f, mine); } catch (e) { continue; }       // another panel got it first, or no file
      try { var t = fs.readFileSync(mine, 'utf8'); fs.unlinkSync(mine); return t; } catch (e) { return null; }
    }
    return null;
  }
  setInterval(function () {
    if (child || typing) return;
    var t = takeInbox(); if (!t || !(t = t.trim())) return;
    try { if (!document.body.classList.contains('live')) document.querySelector('.tab[data-p="chatPane"]').click(); } catch (e) {} // Live view already shows the chat
    typing = true; input.value = ''; var i = 0, step = Math.max(1, Math.round(t.length / 120));
    var timer = setInterval(function () {                           // type it out so a screen recording shows the prompt
      i = Math.min(t.length, i + step); input.value = t.slice(0, i); input.scrollTop = input.scrollHeight;
      if (i >= t.length) { clearInterval(timer); setTimeout(function () { typing = false; input.value = ''; send(t); }, 600); }
    }, 25);
  }, 1000);
  window.addEventListener('resize', draw);
  draw();
}());
