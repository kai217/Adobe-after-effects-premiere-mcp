/* KAI MCP Bridge (UXP) — the modern half of the KAI MCP bridge.
 * Same contract as the CEP bridge: the MCP server drops job files (*.js) into <work>/uxp/<host>/queue, this plugin runs them one at a
 * time as async JavaScript against the host's UXP API (require('premierepro') today; After Effects when its UXP leaves beta),
 * writes the result JSON the job names, and writes a heartbeat to <work>/bridge/uxp_<host>.json every second.
 * File queue instead of a socket: any number of Claude sessions (MCP server processes) can share it, no ports, no firewall prompts. */
(function () {
  'use strict';
  const uxp = require('uxp');
  const fs = require('fs');
  let os = null; try { os = require('os'); } catch (e) {}
  const hostName = String((uxp.host && uxp.host.name) || 'unknown').toLowerCase().replace(/[^a-z]/g, '');
  const host = /premiere/.test(hostName) ? 'pr' : /after/.test(hostName) ? 'ae' : hostName;
  const me = Math.random().toString(36).slice(2, 10);
  const $ = (id) => document.getElementById(id);
  const show = (s, cls, d) => { $('state').textContent = s; $('state').className = cls; if (d !== undefined) $('detail').textContent = d; };

  // ---------- paths: UXP's fs wants file: URLs for native paths on some builds; try both forms once and remember ----------
  let urlForm = null;
  const norm = (p) => String(p).replace(/\\/g, '/');
  const P = (p) => urlForm ? 'file:' + (/^\//.test(norm(p)) ? '' : '/') + norm(p) : norm(p);
  async function probePaths(dir) {
    for (const form of [false, true]) { urlForm = form; try { await fs.readdir(P(dir)); return true; } catch (e) {} }
    urlForm = false; return false;
  }
  function defaultWork() {
    try { const saved = localStorage.getItem('kaiWork'); if (saved) return saved; } catch (e) {}
    let home = ''; try { home = os && os.homedir ? os.homedir() : ''; } catch (e) {}
    return home ? norm(home) + '/KAI-AE-MCP-work' : '';
  }
  let WORK = defaultWork(), QUEUE, RESULTS, HB, LOCK;
  function setWork(w) { WORK = norm(w).replace(/\/$/, ''); QUEUE = WORK + '/uxp/' + host + '/queue'; HB = WORK + '/bridge/uxp_' + host + '.json'; LOCK = WORK + '/bridge/uxp_' + host + '.lock'; $('work').value = WORK; }
  async function readText(p) { return await fs.readFile(P(p), { encoding: 'utf-8' }); }
  async function writeText(p, t) { await fs.writeFile(P(p), t, { encoding: 'utf-8' }); }
  async function writeAtomic(p, t) { const tmp = p + '.' + me + '.tmp'; await writeText(tmp, t); try { await fs.unlink(P(p)); } catch (e) {} await fs.rename(P(tmp), P(p)); }
  async function readJson(p) { try { return JSON.parse(await readText(p)); } catch (e) { return null; } }

  // ---------- helpers given to every job as KAI (modern JS; most Premiere UXP calls are async) ----------
  const KAI = {};
  if (host === 'pr') {
    const ppro = require('premierepro');
    KAI.ppro = ppro;
    KAI.project = async () => { const p = await ppro.Project.getActiveProject(); if (!p) throw new Error('No Premiere project is open.'); return p; };
    KAI.seq = async (name) => { const p = await KAI.project();
      if (!name) { const s = await p.getActiveSequence(); if (!s) throw new Error('No active sequence.'); return s; }
      for (const s of await p.getSequences()) if (s.name === name) return s; throw new Error('sequence not found: ' + name); };
    KAI.t = (sec) => ppro.TickTime.createWithSeconds(sec);
    KAI.sec = (tt) => tt ? Math.round(tt.seconds * 100000) / 100000 : null;
    // Run edits as ONE undoable step: build actions inside fn(compound, ...) and they apply atomically with an Undo label.
    KAI.transact = async (label, fn) => { const p = await KAI.project(); let ok = false, err = null;
      p.lockedAccess(() => { try { ok = p.executeTransaction((ca) => { fn(ca); }, label || 'KAI MCP'); } catch (e) { err = e; } });
      if (err) throw err; return ok; };
    KAI.tracks = async (seq, kind) => { const n = kind === 'audio' ? await seq.getAudioTrackCount() : await seq.getVideoTrackCount(), out = [];
      for (let i = 0; i < n; i++) out.push(kind === 'audio' ? await seq.getAudioTrack(i) : await seq.getVideoTrack(i)); return out; };
    KAI.clips = async (seq, kind, trackIndex) => { const out = [], tr = await KAI.tracks(seq, kind || 'video');
      for (let i = 0; i < tr.length; i++) { if (trackIndex !== undefined && trackIndex !== null && i !== trackIndex) continue;
        const items = await tr[i].getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
        for (let j = 0; j < items.length; j++) out.push({ track: i, index: j, item: items[j] }); } return out; };
    KAI.clipInfo = async (c) => { const it = c.item, o = { track: c.track, index: c.index };
      try { o.name = await it.getName(); } catch (e) {} try { o.start = KAI.sec(await it.getStartTime()); o.end = KAI.sec(await it.getEndTime()); o.in = KAI.sec(await it.getInPoint()); o.out = KAI.sec(await it.getOutPoint()); } catch (e) {}
      try { const ch = await it.getComponentChain(), n = await ch.getComponentCount(); o.components = [];
        for (let k = 0; k < n; k++) { const comp = await ch.getComponentAtIndex(k); o.components.push(await comp.getMatchName()); } } catch (e) {}
      return o; };
    KAI.effectNames = async () => await ppro.VideoFilterFactory.getMatchNames();
    KAI.items = async () => { const p = await KAI.project(), out = [];
      async function walk(folder, pathStr) { const kids = await folder.getItems(); for (const it of kids) { const nm = it.name, bp = pathStr ? pathStr + '/' + nm : nm;
        let isBin = false; try { isBin = !!ppro.FolderItem.cast(it); } catch (e) {} out.push({ name: nm, path: bp, bin: isBin, item: it }); if (isBin) await walk(ppro.FolderItem.cast(it), bp); } }
      await walk(await p.getRootItem(), ''); return out; };
  }
  KAI.fs = fs; KAI.uxp = uxp; KAI.readText = readText; KAI.writeText = writeText;
  KAI.serialize = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) && x.constructor && x.constructor !== Object) ? String(x) : x));

  // ---------- queue runner (same rules as the CEP bridge: one owner, stale jobs never run, result always written) ----------
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const STALE_MS = 15 * 60 * 1000;
  let inFlight = null, jobsRun = 0, lastJob = '', ready = false;
  async function own() { const lk = await readJson(LOCK), now = Date.now();
    if (!lk || lk.id === me || now - lk.t > 3500) { await writeAtomic(LOCK, JSON.stringify({ id: me, t: now })); return true; } return false; }
  async function heartbeat() {
    if (!ready) return;
    try { if (await own()) await writeAtomic(HB, JSON.stringify({ host, app: hostName, version: uxp.host.version, uxp: uxp.versions && uxp.versions.uxp, t: Date.now(), inFlight, jobsRun, instance: me, lastReply: Date.now() })); } catch (e) {}
    if (inFlight) show('Busy (' + Math.round((Date.now() - inFlight.since) / 1000) + 's)', 'busy', inFlight.job);
    else show('Connected', 'ok', (uxp.host.name || host) + ' ' + (uxp.host.version || '') + ' is ready for Claude (UXP).');
    $('last').textContent = jobsRun + ' jobs run' + (lastJob ? ' · last: ' + lastJob : '');
  }
  async function tick() {
    if (!ready || inFlight) return;
    let names; try { names = (await fs.readdir(P(QUEUE))).filter((n) => /\.js$/.test(n)).sort(); } catch (e) { return; }
    if (!names.length || !(await own())) return;
    const name = names[0], src = QUEUE + '/' + name, claimed = src + '.running.' + me;
    try { const st = await fs.lstat(P(src)); if (Date.now() - (st.mtimeMs || +st.mtime) > STALE_MS) { await fs.rename(P(src), P(src + '.stale')); return; } } catch (e) {}
    try { await fs.rename(P(src), P(claimed)); } catch (e) { return; }
    let code = ''; try { code = await readText(claimed); } catch (e) { return; }
    const m = /^\/\/ KAI-RESULT: (.+)$/m.exec(code), argsM = /^\/\/ KAI-ARGS: (.+)$/m.exec(code), resultPath = m ? m[1].trim() : null;
    const job = name.replace(/\.js$/, ''), res = { id: job, ok: true, startedAt: Date.now(), via: 'uxp' };
    inFlight = { job, since: Date.now() }; heartbeat();
    try { const ARGS = argsM ? JSON.parse(argsM[1]) : {}; const fn = new AsyncFunction('KAI', 'ARGS', 'require', code);
      res.result = KAI.serialize(await fn(KAI, ARGS, require)); }
    catch (e) { res.ok = false; res.error = String(e && e.message || e); res.stack = String(e && e.stack || '').split('\n').slice(0, 4).join(' | '); }
    res.endedAt = Date.now(); inFlight = null; jobsRun++; lastJob = job + ' (' + new Date().toTimeString().slice(0, 8) + ')';
    try { await fs.unlink(P(claimed)); } catch (e) {}
    if (resultPath) { try { await writeAtomic(resultPath, JSON.stringify(res)); } catch (e) { show('Could not write result', 'bad', String(e)); } }
    heartbeat();
  }
  async function start(w) {
    setWork(w);
    if (!WORK) { show('Set the work folder', 'bad', 'Type the KAI-AE-MCP-work folder path below and press Enter.'); return; }
    if (!(await probePaths(WORK))) { show('Work folder not reachable', 'bad', WORK + ' — fix the path below (Enter to apply).'); return; }
    for (const d of ['/uxp', '/uxp/' + host, '/uxp/' + host + '/queue', '/bridge']) { try { await fs.mkdir(P(WORK + d)); } catch (e) {} }
    try { localStorage.setItem('kaiWork', WORK); } catch (e) {}
    ready = true; heartbeat();
  }
  $('work').addEventListener('keydown', (e) => { if (e.key === 'Enter') { ready = false; start($('work').value); } });
  setInterval(heartbeat, 1000); setInterval(tick, 150);
  start(WORK);
}());
