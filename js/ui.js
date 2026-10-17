// All DOM: menus, top bar, views, side panel, console, tutorial card, modals, toasts, main loop.
(function (TO) {
  'use strict';
  const G = TO.Game, DATA = TO.DATA, A = TO.Audio, CLI = TO.CLI, TUT = TO.Tutorial;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const money = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

  let dirty = true, sideTab = 'tickets', lastFrame = 0, menuOpen = true, modalLive = null, tutMin = false, showCmds = false, consoleStale = false;
  const sessions = {}, transcripts = {}, hints = new Set(), projHints = new Set(), alertHints = new Set();
  let chatSeen = 0, tutHintOpen = false, tutHintKey = '', crisisHintOpen = false, lastCrisisHtml = '', lastMoodCheck = 0, bannerTimer = null, stampTimer = null;

  // ---------- console ----------
  const env = {
    S: () => G.state(),
    net: () => { if (consoleStale || !G.net()) { consoleStale = false; return G.refresh(); } return G.net(); },
    changed: () => { consoleStale = true; },
    mode: () => G.state().mode,
    hint: () => { G.useHint('console:' + G.state().day); return TO.Hints.text(TO.Hints.next()); },
  };
  function session(id) {
    if (!sessions[id]) { sessions[id] = CLI.session(id, env); transcripts[id] = [`${id} console connected. Press Enter to start. Type ? for help.`, '']; sessions[id].hist = []; sessions[id].hi = 0; }
    return sessions[id];
  }
  function resetSessions() { for (const k of Object.keys(sessions)) { delete sessions[k]; delete transcripts[k]; } }
  function openConsole(id) {
    const S = G.state();
    if (!S.devices[id] || !['router', 'switch'].includes(S.devices[id].kind)) return;
    S.ui.consoleOpen = true; S.ui.consoleDev = id;
    session(id);
    $('#console').classList.add('open');
    renderConsole();
    $('#conInput').focus();
    G.refresh();
  }
  function closeConsole() { const S = G.state(); S.ui.consoleOpen = false; $('#console').classList.remove('open'); dirty = true; }
  function conWrite(id, text) {
    const t = transcripts[id];
    for (const l of String(text).split('\n')) t.push(l);
    if (t.length > 600) t.splice(0, t.length - 600);
  }
  function renderConsole() {
    const S = G.state();
    if (!S) return;
    const id = S.ui.consoleDev;
    const devs = Object.values(S.devices).filter(d => d.kind === 'router' || d.kind === 'switch');
    $('#conTabs').innerHTML = devs.map(d => `<button class="ctab${d.id === id ? ' on' : ''}" data-dev="${d.id}">${esc(d.id)}</button>`).join('');
    if (!sessions[id]) session(id);
    const out = $('#conOut');
    out.textContent = transcripts[id].join('\n');
    out.scrollTop = out.scrollHeight;
    $('#conPrompt').textContent = CLI.prompt(sessions[id]);
  }
  function conSubmit(text) {
    const S = G.state(), id = S.ui.consoleDev, s = session(id), inp = $('#conInput');
    const line = text == null ? inp.value : text;
    conWrite(id, CLI.prompt(s) + line);
    if (line.trim()) { s.hist.push(line); s.hi = s.hist.length; }
    const out = CLI.exec(s, line);
    if (out) conWrite(id, out);
    if (/% (Invalid|Incomplete|Ambiguous|Unknown)/.test(out)) A.play('error');
    inp.value = '';
    G.refresh();
    renderConsole();
  }
  function conQuickKey(k) {
    const S = G.state(), id = S.ui.consoleDev, s = session(id), inp = $('#conInput');
    if (k === 'Tab') inp.value = CLI.complete(s, inp.value);
    else if (k === '?') { conWrite(id, CLI.prompt(s) + inp.value + '?'); conWrite(id, CLI.help(s, inp.value)); renderConsole(); }
    else if (k === 'up') { if (s.hi > 0) inp.value = s.hist[--s.hi]; }
    else if (k === 'clear') transcripts[id] = [];
    else if (k.startsWith('cmd:')) conSubmit(k.slice(4));
    if (k === 'clear') renderConsole();
  }
  function conKey(e) {
    const S = G.state(), id = S.ui.consoleDev, s = session(id), inp = e.target;
    if (e.key === 'Enter') {
      e.preventDefault();
      conSubmit();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      inp.value = CLI.complete(s, inp.value);
    } else if (e.key === '?') {
      e.preventDefault();
      conWrite(id, CLI.prompt(s) + inp.value + '?');
      conWrite(id, CLI.help(s, inp.value));
      renderConsole();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (s.hi > 0) inp.value = s.hist[--s.hi];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      s.hi = Math.min(s.hist.length, s.hi + 1); inp.value = s.hist[s.hi] || '';
    } else if (e.key === 'Escape') { inp.blur(); }
  }

  // ---------- toasts & modals ----------
  function toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind; el.textContent = text;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 3800);
    setTimeout(() => el.remove(), 4400);
  }
  function modal(html, live, wide) {
    const m = $('#modal');
    m.innerHTML = `<div class="card${wide ? ' wide' : ''}" role="dialog" aria-modal="true"><button class="x" data-close aria-label="Close">×</button>${html}</div>`;
    m.hidden = false;
    modalLive = live || null;
    if (live) { const l = $('.live', m); if (l) l.innerHTML = live(); }
    const f = $('input, button.primary', m); if (f) f.focus();
  }
  function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; modalLive = null; }

  // ---------- views ----------
  function setView(v) {
    const S = G.state();
    S.ui.view = v;
    document.querySelectorAll('#tabs [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== 'v-' + v; });
    A.hum(v === 'rack');
    if (v === 'office') { const o = $('#v-office'); if (o.scrollWidth > o.clientWidth) o.scrollLeft = (o.scrollWidth - o.clientWidth) / 2; }
    if (v !== 'office' || !matchMedia('(max-width: 1000px)').matches) { /* keep the sheet state */ }
    if (v === 'security') S.alerts.forEach(a => { a.read = true; });
    dirty = true;
    G.refresh();
  }

  function renderTop() {
    const S = G.state(), m = DATA.MODES[S.mode];
    $('#clock').textContent = G.fmt(S.t);
    $('#day').textContent = 'Day ' + S.day;
    $('#modeTag').textContent = m.label;
    $('#money').textContent = money(S.money);
    $('#money').classList.toggle('neg', S.money < 0);
    $('#repBar').style.width = S.rep + '%';
    $('#repBar').className = S.rep < 30 ? 'bad' : S.rep < 55 ? 'warn' : '';
    $('#repTxt').textContent = Math.round(S.rep) + '%';
    const lo = DATA.LEVELS[S.level], hi = DATA.LEVELS[S.level + 1] || lo + 1;
    $('#lvl').textContent = DATA.TITLES[S.level];
    $('#xpBar').style.width = Math.min(100, ((S.xp - lo) / (hi - lo)) * 100) + '%';
    $('#threatBar').style.width = Math.round(S.threat) + '%';
    $('#threatTxt').textContent = Math.round(S.threat) + '%';
    const tutPause = TUT.blocksClock(S);
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', !S.paused && !tutPause && +b.dataset.speed === S.speed));
    $('#pauseBtn').classList.toggle('on', S.paused || tutPause);
    $('#pauseBtn').title = tutPause ? 'Clock is paused during the first lesson' : 'Pause (Space)';
    const sk = $('#streak');
    sk.hidden = S.streak < 2;
    sk.textContent = `Streak ${S.streak}${S.streak >= 5 ? ' ×2' : S.streak >= 3 ? ' ×1.5' : ''}`;
    document.body.classList.toggle('night', S.overtime);
    renderCrisis();
  }
  function renderCrisis() {
    const S = G.state(), el = $('#crisis'), c = S.crisis;
    let html = '';
    if (c) {
      const d = DATA.CRISES[c.key];
      if (!c.done) {
        const when = c.active ? `ends ${G.fmt(c.end)} (${Math.max(0, c.end - S.t)} min left)` : `starts ${G.fmt(c.start)}`;
        html = `<span class="cb-tag ${c.active ? 'live' : ''}">${c.key === 'showdown' ? 'BOSS DAY' : 'CRISIS DAY'}</span><b>${esc(d.title)}</b><span class="muted">${when}</span><span class="cb-text">${esc(d.intro)}</span><button class="btn xs" data-chint>${crisisHintOpen ? 'Hide hint' : 'Hint'}</button>${crisisHintOpen ? `<div class="hint wide">${esc(d.hint)}</div>` : ''}`;
      } else html = `<span class="cb-tag ${c.result ? 'win' : 'lose'}">${c.result ? 'SUCCESS' : 'FAILED'}</span><b>${esc(d.title)}</b><span class="muted">${esc(c.result ? d.win : d.lose)}</span>`;
    }
    if (html !== lastCrisisHtml) { lastCrisisHtml = html; el.innerHTML = html; el.className = c ? 'crisis show' : 'crisis'; }
  }
  function banner(text, sub) {
    const b = $('#banner');
    b.innerHTML = `<b>${esc(text)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
    b.className = 'banner show';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { b.className = 'banner'; }, 3200);
  }
  function stamp(g) {
    const el = $('#stamp');
    el.innerHTML = `<i class="g-${g.grade}">${g.grade}</i><span>${g.mins} min${g.streak >= 2 ? ` · streak ${g.streak}${g.mult > 1 ? ' ×' + g.mult : ''}` : ''}</span>`;
    el.className = 'stamp show';
    clearTimeout(stampTimer);
    stampTimer = setTimeout(() => { el.className = 'stamp'; }, 1800);
  }

  const canRun = cmds => cmds && cmds.length && !cmds.some(c => c.includes('<'));
  const stepHtml = st => `<li class="hs ${st.ok === true ? 'done' : st.ok === false ? 'todo' : 'info'}"><span class="hm">${st.ok === true ? '✓' : st.ok === false ? '○' : '•'}</span><div>${esc(st.text)}${st.dev ? ` <button class="btn xs" data-opencon="${st.dev}">Open ${st.dev}</button>` : ''}${st.cmds && st.cmds.length ? `<div class="cmds">${st.cmds.map(c => (c[0] === '(' ? `<small class="muted">${esc(c)}</small>` : `<code data-cmd="${esc(c)}" ${st.dev ? `data-dev="${st.dev}"` : ''} title="Click to put this in the console">${esc(c)}</code>`)).join('')}</div>${canRun(st.cmds) && st.dev ? `<button class="btn xs primary" data-runall="${esc(JSON.stringify(st.cmds))}" data-dev="${st.dev}">Type these for me</button>` : ''}` : ''}</div></li>`;
  const stepsHtml = steps => (steps && steps.length ? `<ol class="hsteps">${steps.map(stepHtml).join('')}</ol>` : '');
  function runAll(dev, cmds) {
    const S = G.state();
    openConsole(dev);
    const id = S.ui.consoleDev, s = session(id);
    const go = c => { conWrite(id, CLI.prompt(s) + c); const out = CLI.exec(s, c); if (out) conWrite(id, out); };
    for (const c of cmds) {
      if (c[0] === '(') continue;
      if (c === 'enable' && s.mode !== 'user') continue;
      if (c === 'configure terminal') { if (s.mode === 'user') go('enable'); else if (s.mode !== 'priv') continue; }
      if (/^(write|show|copy|reload)/.test(c) && !['priv', 'user'].includes(s.mode)) go('end');
      go(c);
    }
    G.refresh();
    renderConsole();
  }
  function badge(id, n, cls) { const b = $(id); b.textContent = n || ''; b.hidden = !n; if (cls) b.className = 'badge ' + cls; }

  function renderSide() {
    const S = G.state(), net = G.net();
    const open = S.tickets.filter(t => t.open);
    badge('#tkBadge', open.length);
    badge('#pjBadge', S.projects.length);
    const lastChat = S.chat.length ? S.chat[S.chat.length - 1].id : 0;
    if (sideTab === 'chat') chatSeen = lastChat;
    badge('#chBadge', S.chat.filter(m => m.id > chatSeen).length);
    badge('#secBadge', S.alerts.filter(a => !a.read).length, S.alerts.some(a => !a.read && (a.sev === 'high' || a.sev === 'crit')) ? 'hot' : '');
    document.querySelectorAll('#sideTabs [data-side]').forEach(b => b.classList.toggle('on', b.dataset.side === sideTab));
    const body = $('#sideBody'), top = body.scrollTop;
    if (sideTab === 'tickets') {
      const list = open.slice().sort((a, b) => (a.created + a.sla - S.t) - (b.created + b.sla - S.t));
      body.innerHTML = list.length ? list.map(t => ticketCard(S, net, t)).join('') : '<div class="empty"><b>Inbox zero.</b><br>Tickets appear here when something breaks for someone. Quiet time is a good time to work on projects.</div>';
    } else if (sideTab === 'projects') {
      body.innerHTML = S.projects.length ? S.projects.map(p => projectCard(S, p)).join('') : '<div class="empty">No projects right now. New ones arrive each morning as the company grows.</div>';
    } else if (sideTab === 'chat') {
      body.innerHTML = S.chat.slice(-60).map(m => `<div class="msg ${m.role}"><div class="mh"><b>${esc(m.from)}</b><span class="ts">${G.fmt(m.t)}</span></div><div class="mb">${esc(m.text)}</div></div>`).join('') || '<div class="empty">The office is quiet. Messages from staff, the CEO and other visitors show up here.</div>';
      body.scrollTop = body.scrollHeight;
      return;
    } else {
      body.innerHTML = S.log.slice(0, 80).map(l => `<div class="log ${l.cls}"><span class="ts">D${l.day} ${G.fmt(l.t)}</span>${esc(l.text)}</div>`).join('');
    }
    body.scrollTop = top;
  }
  function ticketCard(S, net, t) {
    const st = t.staff && S.staff.find(s => s.id === t.staff);
    const left = t.created + t.sla - S.t;
    const pct = Math.max(0, Math.min(100, (left / t.sla) * 100));
    const urg = left < 0 ? 'late' : pct < 30 ? 'hot' : pct < 60 ? 'warm' : 'ok';
    const who = st ? `${esc(st.name)} <span class="muted">· desk ${st.desk}</span>` : esc(t.fromName || 'Unknown');
    const label = t.kind === 'net' ? DATA.NEED_LABEL[t.need] : t.kind === 'acct' ? (t.issue === 'locked' ? 'Account locked' : 'Password expired') : 'Request: ' + esc(t.title);
    let actions = '';
    if (t.kind === 'net') {
      actions += st ? `<button class="btn sm" data-locate="${st.desk}">Locate</button>` : '';
    } else if (t.kind === 'acct') actions += `<button class="btn sm primary" data-user="${t.staff}" data-uact="${t.issue === 'locked' ? 'unlock' : 'reset'}">${t.issue === 'locked' ? 'Unlock account' : 'Reset password'}</button>`;
    else actions += `<button class="btn sm" data-tact="approve" data-tid="${t.id}">Approve</button><button class="btn sm danger" data-tact="reject" data-tid="${t.id}">Reject</button>`;
    const auto = S.mode === 'easy' && t.kind === 'net';
    if (!auto) actions += `<button class="btn sm" data-hint="${t.id}">${hints.has(t.id) ? 'Hide hint' : 'Hint' + (S.mode === 'hard' && !S.hintPaid.includes('t:' + t.id) ? ' ($50)' : '')}</button>`;
    const showHint = auto || hints.has(t.id);
    return `<article class="ticket ${urg}">
      <header><span class="tid">${t.id}</span><span class="who">${who}</span><span class="sla">${left < 0 ? Math.abs(left) + 'm late' : left + 'm left'}</span></header>
      <div class="need">${label}</div>
      <p class="quote">“${esc(t.text)}”</p>
      <div class="slabar"><i style="width:${pct}%"></i></div>
      ${showHint ? `<div class="hint">${esc(G.hint(t))}</div>` : ''}
      <div class="row">${actions}</div></article>`;
  }
  function projectCard(S, p) {
    const P = G.PROJECTS[p.key];
    const lesson = P.chapter && S.mode !== 'hard' && !S.tutDone.includes(P.chapter) && !(S.tut && S.tut.ch === P.chapter);
    return `<article class="project"><h4>${esc(P.title)}</h4><p>${esc(P.desc)}</p>
      <div class="reward">Reward: ${money(P.reward[0])} · ${P.reward[1]} XP</div>
      <div class="row">${lesson ? `<button class="btn sm" data-lesson="${P.chapter}">Start lesson</button>` : ''}<button class="btn sm" data-phint="${p.key}">${projHints.has(p.key) ? 'Hide hint' : 'Hint' + (S.mode === 'hard' && !S.hintPaid.includes('p:' + p.key) ? ' ($50)' : '')}</button></div>
      ${projHints.has(p.key) ? stepsHtml(TO.Hints.project(p.key)) : ''}</article>`;
  }

  function alertHintHtml(S, a) {
    const open = alertHints.has(a.id);
    return `<div class="row"><button class="btn xs" data-ahint="${a.id}">${open ? 'Hide hint' : 'Hint' + (S.mode === 'hard' && !S.hintPaid.includes('a:' + a.id) ? ' ($50)' : '')}</button></div>${open ? stepsHtml(TO.Hints.alert(a)) : ''}`;
  }
  function renderSecurity() {
    const S = G.state(), net = G.net();
    const D = S.devices;
    const deskPorts = S.staff.filter(s => s.present).map(s => net.linkOf['PP1:' + s.desk]).filter(k => k && /^SW/.test(k));
    const psAll = deskPorts.length && deskPorts.every(k => { const [d, p] = k.split(':'); return D[d].cfg.ifs[p].ps; });
    const defs = [
      ['Port security on desk ports', psAll, 'Stops rogue devices and hubs.'],
      ['Server in its own subnet with ACL', S.done.srvacl, 'Stops malware spreading to SRV1.'],
      ['Guest Wi-Fi isolated', S.done.wifi, 'Guests cannot touch office systems.'],
      ['Nightly backups', !!S.backupLast, S.backupLast ? `Last good backup: day ${S.backupLast}` : 'Beats ransomware.'],
      ['Multi-factor login', S.owned.mfa, 'Beats password spraying.'],
      ['Security awareness training', S.owned.training, 'Fewer phishing clicks.'],
      ['Endpoint protection (EDR)', S.owned.edr, 'Instant malware detection and one-click isolation.'],
      ['UPS battery', S.owned.ups, 'Power cuts do not reboot the rack.'],
    ];
    const active = S.attacks.filter(a => !a.over);
    const STAGE = { phish: a => `Malware on ${a.pc}${a.contained ? ' (contained, reimage it)' : a.detected ? ' (detected, contain it!)' : ''}`, spray: a => a.stage === 'takeover' ? `Account takeover: reset ${S.staff.find(s => s.id === a.staff).user}` : 'Password spray in progress', pi: a => `Unknown device at desk ${a.desk}${a.detected ? '' : ' (not yet spotted)'}`, guest: () => 'Guest device probing the network' };
    $('#v-security').innerHTML = `<div class="sec-grid">
      <section class="panel"><h3>Threat level</h3><div class="meter big"><i style="width:${Math.round(S.threat)}%"></i></div>
        <p class="muted">Threat rises every day as the company grows. Each defence below lowers your risk or the damage an attack can do.</p>
        <ul class="defs">${defs.map(([n, ok, d]) => `<li class="${ok ? 'ok' : ''}"><span class="tick">${ok ? '✓' : '○'}</span><b>${n}</b><small>${esc(d)}</small></li>`).join('')}</ul></section>
      <section class="panel"><h3>Active incidents</h3>${active.length ? active.map(a => `<div class="incident">${esc(STAGE[a.type](a))}</div>`).join('') : '<p class="muted">Nothing active. Stay alert.</p>'}
        <h3>Playbook</h3><ol class="play"><li><b>Contain</b>: shut the switch port, pull the cable, reset the password.</li><li><b>Eradicate</b>: reimage the PC, remove the device.</li><li><b>Recover</b>: restore from backup, bring ports back up.</li><li><b>Prevent</b>: fix the gap they used.</li></ol></section>
      <section class="panel wide"><h3>Alerts</h3>${S.alerts.length ? S.alerts.map(a => `<div class="alert ${a.sev}"><span class="sev">${a.sev.toUpperCase()}</span><span class="ts">D${a.day} ${G.fmt(a.t)}</span><b>${esc(a.title)}</b><p>${esc(a.text)}</p>${alertHintHtml(S, a)}${(a.actions || []).includes('isolate') && !S.isolated.includes(a.pc) ? `<button class="btn sm danger" data-isolate="${a.id}">Isolate ${a.pc}</button>` : ''}</div>`).join('') : '<p class="muted">No alerts yet.</p>'}</section></div>`;
  }

  function renderPeople() {
    const S = G.state(), net = G.net();
    const ck = v => `<span class="ck ${v ? 'ok' : 'no'}">${v ? '✓' : '✗'}</span>`;
    const rows = S.staff.filter(s => s.present).sort((a, b) => a.desk - b.desk).map(s => {
      const h = net.hosts[s.pc] || {}, n = net.needs[s.pc] || {};
      const acct = s.acct.compromised ? '<b class="bad">COMPROMISED</b>' : s.acct.locked ? '<b class="warn">Locked</b>' : s.acct.expired ? '<b class="warn">Expired</b>' : 'OK';
      const btn = s.acct.locked ? `<button class="btn sm" data-user="${s.id}" data-uact="unlock">Unlock</button>` : s.acct.expired || s.acct.compromised ? `<button class="btn sm ${s.acct.compromised ? 'danger' : ''}" data-user="${s.id}" data-uact="reset">Reset password</button>` : '';
      return `<tr><td>${s.desk}</td><td><b>${esc(s.name)}</b><br><small class="muted">${esc(s.user)}${S.owned.mfa ? ' · MFA' : ''}</small></td><td><span class="dept" style="--c:${DATA.DEPT_COLOR[s.dept]}">${s.dept}</span></td>
        <td class="mono">${s.pc}<br><small>${h.ip ? esc(h.ip) + (h.src === 'apipa' ? ' (APIPA)' : '') : 'no IP'}</small></td><td>${ck(n.web && n.dns)}</td><td>${ck(n.files)}</td><td>${ck(n.print)}</td><td>${acct} ${btn}</td></tr>`;
    }).join('');
    $('#v-people').innerHTML = `<section class="panel"><h3>People and accounts</h3><div class="tablewrap"><table class="people"><thead><tr><th>Desk</th><th>Name</th><th>Dept</th><th>PC / IP</th><th>Web</th><th>S: drive</th><th>Print</th><th>Account</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }

  function renderShop() {
    const S = G.state();
    $('#v-shop').innerHTML = `<section class="panel"><h3>Shop</h3><p class="muted">Budget: <b>${money(S.money)}</b> · Level: <b>${DATA.TITLES[S.level]}</b>. Head office tops up your budget every evening based on staff happiness.</p>
      <div class="shop">${DATA.SHOP.map(i => {
        const owned = G.owns(i.key), locked = S.level < i.level;
        return `<article class="item ${owned ? 'owned' : ''} ${locked ? 'locked' : ''}"><h4>${esc(i.name)}</h4><p>${esc(i.desc)}</p>
          <div class="row"><span class="price">${money(i.price)}</span>${owned ? '<span class="tag ok">Owned</span>' : locked ? `<span class="tag">Unlocks at ${DATA.TITLES[i.level]}</span>` : `<button class="btn primary sm" data-buy="${i.key}" ${S.money < i.price ? 'disabled' : ''}>Buy</button>`}</div></article>`;
      }).join('')}</div></section>`;
  }

  function renderTutorial() {
    const S = G.state(), el = $('#tutorial');
    const st = S && TUT.current(S);
    if (!st) { el.hidden = true; return; }
    const ch = TUT.CHAPTERS[S.tut.ch];
    el.hidden = false;
    if (tutMin) { el.className = 'tutorial min'; el.innerHTML = `<button class="btn sm" data-tut="max">Lesson: ${esc(st.title)} ▸</button>`; return; }
    const cmds = TUT.cmds(S);
    const showList = S.mode === 'easy' || showCmds;
    const tk = S.tut.ch + S.tut.i;
    if (tutHintKey !== tk) { tutHintKey = tk; tutHintOpen = false; }
    const hl = TO.Hints.lesson(S);
    el.className = 'tutorial';
    el.innerHTML = `<div class="tut-head"><span>${esc(ch.title)} · ${S.tut.i + 1}/${ch.steps.length}</span><button class="icon" data-tut="min" title="Minimise">–</button></div>
      <h4>${esc(st.title)}</h4><p>${md(st.text)}</p>${tutHintOpen && hl ? `<div class="hint">${esc(hl)}</div>` : ''}
      ${cmds.length ? (showList ? `<div class="cmds">${cmds.map(c => `<code data-cmd="${esc(c)}" title="Click to type into the console">${esc(c)}</code>`).join('')}</div>${S.mode === 'easy' ? '<p class="muted small">Click a command to put it in the console, then press Enter.</p>' : ''}` : '<button class="btn sm" data-tut="cmds">Show commands</button>') : ''}
      <div class="row">${st.check ? '<span class="muted small">Completes automatically when done.</span>' : '<button class="btn primary sm" data-tut="next">Next</button>'}${hl ? `<button class="btn sm" data-tut="hint">${tutHintOpen ? 'Hide hint' : 'Hint'}</button>` : ''}<button class="btn sm ghost" data-tut="skip">Skip lesson</button></div>`;
  }

  function renderAll() {
    const S = G.state();
    renderSide();
    if (S.ui.view === 'rack') TO.Rack.render();
    if (S.ui.view === 'security') { S.alerts.forEach(a => { a.read = true; }); renderSecurity(); }
    if (S.ui.view === 'people') renderPeople();
    if (S.ui.view === 'shop') renderShop();
    renderTutorial();
    if (modalLive) { const l = $('#modal .live'); if (l) l.innerHTML = modalLive(); }
    if (S.ui.consoleOpen) $('#conPrompt').textContent = CLI.prompt(session(S.ui.consoleDev));
  }

  // ---------- device & desk dialogs ----------
  function ipForm(d) {
    const n = d.net;
    return `<form class="ipform" data-dev="${d.id}"><h4>IP settings (static)</h4>
      <label>IP address<input name="ip" value="${esc(n.ip)}" placeholder="192.168.1.10" autocomplete="off"></label>
      <label>Subnet mask<input name="mask" value="${esc(n.mask)}" placeholder="255.255.255.0" autocomplete="off"></label>
      <label>Default gateway<input name="gw" value="${esc(n.gw)}" placeholder="192.168.1.1" autocomplete="off"></label>
      ${d.kind === 'printer' ? '' : `<label>DNS server<input name="dns" value="${esc(n.dns)}" placeholder="8.8.8.8" autocomplete="off"></label>`}
      <div class="row"><button class="btn primary" type="submit">Save IP settings</button><span class="formerr"></span></div></form>`;
  }
  function openDevice(id) {
    const S = G.state(), d = S.devices[id];
    if (!d) return;
    if (d.kind === 'router' || d.kind === 'switch') return openConsole(id);
    if (d.kind === 'pp') return toast('The patch panel is passive: drag cables from its ports to a switch.');
    if (d.kind === 'isp') return toast('The ISP modem hands you 203.0.113.2/30 with gateway 203.0.113.1. It is already cabled to R1 Gi0/0.');
    if (d.kind === 'ap') return apDialog();
    const live = () => {
      const S2 = G.state(), d2 = S2.devices[id], net = G.net(), h = net.hosts[id];
      let html = `<p class="mono">${h && h.linked ? 'Link up' : '<b class="bad">No link</b>'} · ${h && h.ip ? esc(h.ip) : 'no IP'}</p>`;
      if (id === 'SRV1') {
        html += `<div class="svc"><span>File share (SMB)</span>${d2.encrypted ? '<b class="bad">ENCRYPTED</b>' : d2.svc.files ? '<b class="ok">Running</b>' : '<b class="bad">Stopped</b> <button class="btn sm" data-dact="startFiles">Start</button>'}</div>
          <div class="svc"><span>DNS server</span>${d2.svc.dns ? '<b class="ok">Running</b>' : '<b class="bad">Stopped</b> <button class="btn sm" data-dact="startDns">Start</button>'}</div>
          <div class="svc"><span>Disk</span><div class="meter"><i style="width:${d2.disk}%" class="${d2.disk >= 90 ? 'bad' : ''}"></i></div>${d2.disk}% ${d2.disk >= 90 ? '<button class="btn sm" data-dact="cleanup">Clean up</button>' : ''}</div>
          <div class="svc"><span>Backups</span>${S2.backupLast ? `Last good: day ${S2.backupLast}` : 'None'}</div>
          ${d2.encrypted ? `<div class="row"><button class="btn primary" data-dact="restore" ${S2.backupLast ? '' : 'disabled'}>Restore from backup (60 min)</button><button class="btn danger" data-dact="rebuild">Rebuild ($2,500, 3 h)</button></div>` : ''}
          <p class="muted small">SRV1 forwards DNS queries to its own DNS server setting, so it needs a working gateway to the internet.</p>`;
      }
      if (id === 'NAS1') html += `<p>${S2.backupOk ? '<b class="ok">Can reach SRV1 on TCP 445. Tonight\'s backup will run.</b>' : '<b class="bad">Cannot reach SRV1 on TCP 445. No backups will run.</b>'}</p>`;
      if (id === 'PRN1') html += `<div class="svc"><span>Paper path</span>${d2.jam ? '<b class="bad">JAMMED</b> <button class="btn sm" data-dact="clearJam">Clear jam (5 min)</button>' : '<b class="ok">OK</b>'}</div><p class="muted small">The printer is on desk jack 16. Staff print to it by IP on TCP 9100.</p>`;
      return html;
    };
    modal(`<div data-devid="${id}"><h3>${esc(id)} <small class="muted">${esc(d.model)}</small></h3><div class="live"></div>${ipForm(d)}</div>`, live);
  }
  function apDialog() {
    const S = G.state(), ap = S.devices.AP1;
    const row = (s, i) => `<div class="ssid"><label>SSID ${i + 1}<input name="name${i}" value="${esc(s ? s.name : '')}" placeholder="${i ? 'Brightwater-Guest' : 'Brightwater'}"></label>
      <label>VLAN tag<input name="vlan${i}" value="${s && s.vlan ? s.vlan : ''}" placeholder="untagged" inputmode="numeric"></label>
      <label class="chk"><input type="checkbox" name="guest${i}" ${s && s.guest ? 'checked' : ''}> Guest network</label></div>`;
    modal(`<h3>AP1 <small class="muted">${esc(ap.model)}</small></h3><div class="live"></div>
      <form class="apform">${row(ap.cfg.ssids[0], 0)}${row(ap.cfg.ssids[1], 1)}
      <p class="muted small">An untagged SSID uses the switch port's access/native VLAN. A tagged SSID needs the switch port to be a trunk carrying that VLAN. Leave SSID 2 blank to turn it off.</p>
      <div class="row"><button class="btn primary" type="submit">Save wireless settings</button><span class="formerr"></span></div></form>`,
    () => { const net = G.net(); return `<p class="mono">${net.portStatus['PP1:17'] === 'up' ? 'Uplink up via PP1 port 17' : '<b class="bad">No uplink: patch PP1 port 17 to a switch</b>'} · ${S.guests} guest devices</p>`; });
  }
  function deskDialog(n) {
    const live = () => {
      const S = G.state(), net = G.net();
      const who = S.staff.find(s => s.present && s.desk === n);
      const j = S.jacks[n];
      const sw = net.linkOf['PP1:' + n];
      const path = `Desk ${n} wall socket → PP1 port ${n} → ${sw ? `${esc(sw.replace(':', ' '))} (${net.portStatus[sw] || 'down'})` : '<b class="bad">not patched</b>'}`;
      const job = S.jobs.find(x => x.arg === n || (who && x.arg === who.id));
      const extra = j.rogue === 'hub' ? '<b class="warn">A small personal network hub with a laptop on it</b>' : j.rogue === 'pi' ? '<b class="bad">A tiny unlabelled box with a raspberry logo, taped under the desk</b>' : 'Nothing unusual';
      if (!who) return `<p>${path}</p><p class="muted">Nobody sits here yet. New hires get the next free desk.</p>`;
      const h = net.hosts[who.pc] || {}, nd = net.needs[who.pc] || {};
      const ck = (k, l) => `<span class="pill ${nd[k] ? 'ok' : 'no'}">${nd[k] ? '✓' : '✗'} ${l}</span>`;
      return `<p><b>${esc(who.name)}</b> · ${who.dept} · ${esc(who.user)} · ${who.pc}</p>
        <div class="pills">${ck('link', 'Link')}${ck('ip', 'IP')}${ck('dns', 'DNS')}${ck('web', 'Web')}${ck('files', 'S: drive')}${ck('print', 'Printer')}</div>
        <table class="kv"><tr><td>IP address</td><td class="mono">${h.ip ? esc(h.ip) + ' / ' + esc(h.mask) + (h.src === 'apipa' ? ' (APIPA: no DHCP)' : ' (' + h.src + ')') : '-'}</td></tr>
        <tr><td>Gateway</td><td class="mono">${esc(h.gw || '-')}</td></tr><tr><td>DNS</td><td class="mono">${esc(h.dns || '-')}</td></tr>
        <tr><td>Path</td><td>${path}</td></tr><tr><td>Cable at desk</td><td>${j.ok ? 'Seated' : '<b class="bad">Hanging loose</b>'}</td></tr><tr><td>Under the desk</td><td>${extra}</td></tr></table>
        ${job ? `<p class="warn">In progress: ${esc(job.label)} (done at ${G.fmt(job.at)})</p>` : ''}
        <div class="row">${!j.ok ? `<button class="btn primary" data-desk="${n}" data-dk="reseat">Reseat cable (15 min)</button>` : ''}${j.rogue ? `<button class="btn primary" data-desk="${n}" data-dk="removeRogue">Remove device (5 min)</button>` : ''}
        <button class="btn" data-desk="${n}" data-dk="reimage">Reimage PC (30 min)</button><button class="btn" data-showrack="${n}">Show in rack</button></div>`;
    };
    modal(`<h3>Desk ${n}</h3><div class="live"></div>`, live);
  }

  // ---------- day end / game over / menus ----------
  function careerHtml() {
    const c = TO.Live.career();
    const cell = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
    return `<div class="stats">${cell(c.days, 'days')}${cell(c.fixed, 'tickets fixed')}${cell(c.bestStreak, 'best streak')}${cell(c.stopped, 'attacks stopped')}${cell(c.incidents, 'incidents')}${cell(c.crises, 'crises won')}${cell(c.boss, 'NULLROUTE beaten')}${cell(c.hints, 'hints used')}${cell(c.achievements, 'achievements')}${cell(c.level, 'final rank')}</div>`;
  }
  function dailyEnd(sum) {
    const d = sum.daily, rec = TO.Live.recordDaily(d);
    const text = `Tier One daily ${d.date}: ${d.score} pts (grade ${d.grade}) · ${d.fixed} fixed · ${d.incidents} incidents`;
    modal(`<h2>Daily shift complete</h2><div class="grade g-${d.grade}">${d.grade}</div><p><b>${d.score}</b> points ${rec.isNew ? '<span class="tag ok">new best</span>' : `<span class="muted">(best today: ${rec.best})</span>`}</p>
      <div class="stats"><div><b>${d.fixed}</b><span>tickets fixed</span></div><div><b>${d.streak}</b><span>best streak</span></div><div><b>${d.stopped}</b><span>attacks stopped</span></div><div><b>${d.incidents}</b><span>incidents</span></div><div><b>${d.breaches}</b><span>missed targets</span></div></div>
      <div class="row"><button class="btn primary" data-copy="${esc(text)}">Copy result</button><button class="btn" data-menu>Main menu</button></div><p class="muted small">Everyone who plays today gets the same office and the same crisis. Come back tomorrow for a new one.</p>`);
    $('#modal [data-close]').remove();
  }
  function dayEnd(sum) {
    const S = G.state();
    if (sum.daily) return dailyEnd(sum);
    if (sum.late) {
      modal(`<h2>Night shift over</h2><p>It is 18:00. Whatever you fixed tonight stays fixed.</p><div class="row"><button class="btn primary" data-next>Start day ${sum.day + 1}</button></div>`);
      $('#modal [data-close]').remove();
      return;
    }
    const warn = [];
    if (sum.unsaved.length) warn.push(`<p class="warn">Unsaved changes on ${sum.unsaved.join(', ')}. A power cut tonight would wipe them.</p>`);
    if (sum.backup) warn.push('<p class="ok">Tonight\'s backup of SRV1 will run.</p>');
    modal(`<h2>End of day ${sum.day}</h2>
      <div class="stats"><div><b>${money(sum.revenue)}</b><span>productivity</span></div><div><b>${money(sum.budget)}</b><span>budget top-up</span></div>
      <div><b>${sum.fixed}</b><span>tickets fixed</span></div><div><b>${sum.breaches}</b><span>missed targets</span></div><div><b>${sum.incidents}</b><span>incidents</span></div><div><b>${sum.open}</b><span>still open</span></div></div>
      ${warn.join('')}<p class="muted">Budget ${money(S.money)} · reputation ${Math.round(S.rep)}% · threat ${Math.round(S.threat)}% · best streak ${S.bestStreak}</p>
      <div class="row"><button class="btn primary" data-next>Start day ${sum.day + 1}</button><button class="btn" data-late title="Until 18:00. No new tickets, no revenue, $200 overtime.">Stay late (−$200)</button></div>
      <p class="muted small">Staying late gives you a quiet hour for risky changes and unsaved fixes. Attackers sometimes strike at night.</p>`);
    $('#modal [data-close]').remove();
  }
  function gameOver(o) {
    modal(`<h2>You're fired</h2><p>${esc(o.reason)}</p><h4>Your career</h4>${careerHtml()}
      <div class="row"><button class="btn primary" data-menu>Main menu</button></div>`);
    $('#modal [data-close]').remove();
  }
  function achievements() {
    const prof = TO.Live.profile(), S = G.state();
    modal(`<h2>Achievements</h2><p class="muted">${DATA.ACHIEVEMENTS.filter(a => prof.ach[a[0]] || (S && S.ach[a[0]])).length} of ${DATA.ACHIEVEMENTS.length} unlocked</p>
      <div class="achs">${DATA.ACHIEVEMENTS.map(([k, n, d]) => { const got = prof.ach[k] || (S && S.ach && S.ach[k]); return `<div class="ach ${got ? 'got' : ''}"><b>${got ? '★ ' : '☆ '}${esc(n)}</b><small>${esc(d)}</small></div>`; }).join('')}</div>`, null, true);
  }
  function careerModal() { modal(`<h2>Your career so far</h2>${careerHtml()}`, null, true); }
  function settingsModal() {
    const c = TO.Settings.get();
    modal(`<h2>Settings</h2><form class="settings">
      <label>Sound effects<input type="range" name="sfx" min="0" max="100" value="${Math.round(c.sfx * 100)}"></label>
      <label>Music<input type="range" name="music" min="0" max="100" value="${Math.round(c.music * 100)}"></label>
      <label class="chk"><input type="checkbox" name="cb" ${c.cb ? 'checked' : ''}> Colour-blind friendly colours</label>
      <label>Text size<select name="text"><option value="normal">Normal</option><option value="large">Large</option><option value="xlarge">Extra large</option></select></label>
      <label class="chk"><input type="checkbox" name="snd" ${A.isOn() ? 'checked' : ''}> Sound on</label></form>`);
    $('#modal select[name="text"]').value = c.text;
  }
  function hintModal() {
    const S = G.state(), h = TO.Hints.next();
    const cost = G.useHint('next:' + h.title + ':' + S.day);
    modal(`<h2>What now?</h2><h3>${esc(h.title)}</h3><p>${esc(h.text)}</p>${stepsHtml(h.steps)}
      <div class="row">${h.view ? `<button class="btn" data-goview="${h.view}">Take me there</button>` : ''}</div>${cost ? `<p class="muted small">Vendor fee: $${cost}</p>` : ''}`, null, true);
  }
  function howTo() {
    modal(`<h2>How to play</h2><ul class="howto">
      <li><b>Server room</b>: drag cables between ports. Desks reach the rack through the patch panel (PP1). Click a cable or port to inspect or unplug it.</li>
      <li><b>Console</b>: click a router or switch to configure it with Cisco IOS commands. <kbd>?</kbd> shows options, <kbd>Tab</kbd> completes, <kbd>↑</kbd>/<kbd>↓</kbd> recall history, and commands can be abbreviated (<code>conf t</code>, <code>int g0/1</code>, <code>no shut</code>, <code>sh ip int br</code>).</li>
      <li><b>Office</b>: click a desk to see that person's PC, IP and cable path, and to send a tech to fix hardware.</li>
      <li><b>Tickets</b> close themselves when the person's problem is really fixed. Fix them before their timer runs out.</li>
      <li><b>Requests</b> can be scams. Reject anything that skips approval or asks for passwords.</li>
      <li><b>Security</b>: contain, clean up, recover, prevent. Defences in the Shop lower your risk.</li>
      <li><b>Stuck?</b> Every ticket, project, alert, crisis and lesson has a <b>Hint</b> button, and the <b>Hint</b> button at the top (or the <kbd>H</kbd> key, or typing <code>hint</code> in a console) says what to do next. On Hard each hint costs $50.</li>
      <li><b>Save your configs</b> with <code>write memory</code>. Power cuts happen.</li>
      <li>Keys: <kbd>Space</kbd> pause · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> speed · <kbd>\`</kbd> console · <kbd>H</kbd> hint · <kbd>Esc</kbd> close.</li></ul>`, null, true);
  }
  function credits() {
    modal(`<h2>Credits</h2><p class="credit-big">Tier One: Network Operations</p><p>Created by <b>Yaseen.S</b></p>
      <p class="muted small">Cisco and IOS are trademarks of Cisco Systems, Inc. This game uses IOS-style commands for learning and is not affiliated with or endorsed by Cisco. All people and companies in the game are fictional.</p>`);
  }
  function showMenu() {
    menuOpen = true;
    A.hum(false);
    A.music.stop();
    closeModal();
    $('#app').hidden = true;
    const m = $('#menu');
    m.hidden = false;
    m.innerHTML = `<div class="menu-bg"></div><div class="menu-inner">
      <div class="logo">TIER<span>ONE</span></div><div class="sub">Network Operations</div>
      <p class="tag">Cable it. Configure it. Keep the hackers out.</p>
      <div class="menu-btns">
        ${G.hasSave() ? '<button class="btn primary big" data-m="continue">Continue</button>' : ''}
        <button class="btn ${G.hasSave() ? '' : 'primary'} big" data-m="new">New game</button>
        <button class="btn big" data-m="daily">Daily challenge${TO.Live.profile().daily[TO.Live.dailyDate()] ? ' · best ' + TO.Live.profile().daily[TO.Live.dailyDate()] : ''}</button>
        <button class="btn big" data-m="how">How to play</button>
        <button class="btn big" data-m="ach">Achievements</button>
        <button class="btn big" data-m="settings">Settings</button>
        <button class="btn ghost" data-m="credits">Credits</button>
      </div></div><footer class="menu-credit">Created by Yaseen.S</footer>`;
  }
  function newGameScreen() {
    const m = $('#menu .menu-inner');
    m.innerHTML = `<div class="logo small">TIER<span>ONE</span></div><h2>Choose your difficulty</h2>
      <div class="modes">${Object.entries(DATA.MODES).map(([k, v]) => `<button class="mode" data-start="${k}"><b>${v.label}</b><span>${esc(v.desc)}</span><small>Starting budget ${money(v.money)}</small></button>`).join('')}</div>
      <button class="btn ghost" data-m="back">Back</button>`;
  }
  function startGame(fn) {
    menuOpen = false;
    resetSessions();
    document.body.classList.remove('side-open');
    hints.clear(); projHints.clear(); alertHints.clear();
    tutMin = false; showCmds = false; crisisHintOpen = false; lastCrisisHtml = '';
    $('#menu').hidden = true;
    $('#app').hidden = false;
    fn();
    const S = G.state();
    closeConsole();
    chatSeen = S.chat.length ? S.chat[S.chat.length - 1].id : 0;
    sideTab = 'tickets';
    A.music.start();
    setView(S.ui.view || 'office');
    if (S.dayOver) dayEnd(S.dayOver);
    dirty = true;
  }

  // ---------- wiring ----------
  function wire() {
    G.on((type, data) => {
      if (type === 'change' || type === 'log') dirty = true;
      if (type === 'toast') toast(data.text, data.kind);
      if (type === 'sound') A.play(data);
      if (type === 'dayend') dayEnd(data);
      if (type === 'gameover') gameOver(data);
      if (type === 'grade') stamp(data);
      if (type === 'restored') { banner(data.all ? 'Network restored' : `${data.desks.length} desks back online`, `${data.total} of ${G.state().staff.filter(x => x.present).length} people online`); TO.Office.wave(data.desks); }
      if (type === 'chat') { dirty = true; if (data.role !== 'staff') A.play('chat'); }
    });
    TO.Office.init($('#officeCanvas'), {
      desk: n => deskDialog(n),
      rack: () => setView('rack'),
      printer: () => openDevice('PRN1'),
      ap: () => openDevice('AP1'),
      lobby: () => toast('Visitors on guest Wi-Fi. Keep them away from SRV1.'),
    });
    TO.Rack.init($('#v-rack'), { device: openDevice, console: openConsole, toast });

    document.addEventListener('pointerdown', () => A.unlock(), { once: true });
    $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
    $('#sideTabs').addEventListener('click', e => {
      const b = e.target.closest('[data-side]');
      if (!b) return;
      const narrow = matchMedia('(max-width: 1000px)').matches, open = document.body.classList.contains('side-open');
      if (narrow && open && sideTab === b.dataset.side) document.body.classList.remove('side-open');
      else { sideTab = b.dataset.side; if (narrow) document.body.classList.add('side-open'); }
      dirty = true;
    });
    $('#top').addEventListener('click', e => {
      const sp = e.target.closest('[data-speed]');
      if (sp) { G.setSpeed(+sp.dataset.speed); A.play('step'); }
      if (e.target.closest('#pauseBtn')) G.togglePause();
      if (e.target.closest('#menuBtn')) gameMenu();
      if (e.target.closest('#hintBtn')) hintModal();
    });
    $('#conBtn').addEventListener('click', () => (G.state().ui.consoleOpen ? closeConsole() : openConsole(G.state().ui.consoleDev || 'R1')));
    $('#conClose').addEventListener('click', closeConsole);
    $('#conTabs').addEventListener('click', e => { const b = e.target.closest('[data-dev]'); if (b) openConsole(b.dataset.dev); });
    $('#conInput').addEventListener('keydown', conKey);
    // Phone keyboards and paste don't send a "?" keydown, so catch it on input as well.
    $('#conInput').addEventListener('input', e => {
      const inp = e.target;
      if (!inp.value.endsWith('?')) return;
      const S = G.state(), id = S.ui.consoleDev, s = session(id), line = inp.value.slice(0, -1);
      conWrite(id, CLI.prompt(s) + inp.value);
      conWrite(id, CLI.help(s, line));
      inp.value = line;
      renderConsole();
    });
    $('#conOut').addEventListener('click', () => $('#conInput').focus());
    $('#conKeys').addEventListener('click', e => { const b = e.target.closest('[data-ckey]'); if (b) conQuickKey(b.dataset.ckey); });

    // delegated actions across the app
    document.addEventListener('click', e => {
      const t = e.target;
      const el = sel => t.closest(sel);
      let b;
      if ((b = el('[data-locate]'))) { document.body.classList.remove('side-open'); setView('office'); TO.Office.focusDesk(+b.dataset.locate); }
      else if ((b = el('[data-hint]'))) { const id = b.dataset.hint; if (hints.has(id)) hints.delete(id); else { hints.add(id); const c = G.useHint('t:' + id); if (c) toast(`Vendor fee: -$${c}`); } dirty = true; }
      else if ((b = el('[data-phint]'))) { const k = b.dataset.phint; if (projHints.has(k)) projHints.delete(k); else { projHints.add(k); const c = G.useHint('p:' + k); if (c) toast(`Vendor fee: -$${c}`); } dirty = true; }
      else if ((b = el('[data-ahint]'))) { const k = b.dataset.ahint; if (alertHints.has(k)) alertHints.delete(k); else { alertHints.add(k); const c = G.useHint('a:' + k); if (c) toast(`Vendor fee: -$${c}`); } dirty = true; }
      else if (el('[data-chint]')) { crisisHintOpen = !crisisHintOpen; if (crisisHintOpen) G.useHint('c:' + G.state().day); lastCrisisHtml = ''; dirty = true; }
      else if ((b = el('[data-runall]'))) { runAll(b.dataset.dev, JSON.parse(b.dataset.runall)); }
      else if ((b = el('[data-opencon]'))) openConsole(b.dataset.opencon)
      else if ((b = el('[data-goview]'))) { closeModal(); setView(b.dataset.goview); }
      else if ((b = el('[data-copy]'))) { const txt = b.dataset.copy; try { navigator.clipboard.writeText(txt).then(() => toast('Result copied.', 'good'), () => toast(txt)); } catch (err) { toast(txt); } }
      else if (el('[data-late]')) { if (G.stayLate()) closeModal(); }
      else if ((b = el('[data-tact]'))) G.ticketAct(b.dataset.tid, b.dataset.tact);
      else if ((b = el('[data-uact]'))) G.userAction(b.dataset.user, b.dataset.uact);
      else if ((b = el('[data-lesson]'))) { TUT.start(G.state(), b.dataset.lesson); tutMin = false; dirty = true; }
      else if ((b = el('[data-buy]'))) { const err = G.buy(b.dataset.buy); if (err) { toast(err, 'bad'); A.play('error'); } }
      else if ((b = el('[data-isolate]'))) G.alertAct(b.dataset.isolate, 'isolate');
      else if ((b = el('[data-desk]'))) { const r = G.deskAction(+b.dataset.desk, b.dataset.dk); if (r && !r.ok && r.msg) toast(r.msg); dirty = true; }
      else if ((b = el('[data-dact]'))) {
        const a = b.dataset.dact, id = b.closest('[data-devid]').dataset.devid;
        const r = a === 'clearJam' ? G.deskAction(0, 'clearJam') : G.deviceAction(id, a);
        if (r && !r.ok && r.msg) toast(r.msg);
        dirty = true;
      }
      else if ((b = el('[data-showrack]'))) { closeModal(); setView('rack'); TO.Rack.select('PP1:' + b.dataset.showrack); }
      else if ((b = el('[data-cmd]'))) { const S = G.state(); if (b.dataset.dev) openConsole(b.dataset.dev); else if (!S.ui.consoleOpen) openConsole(S.ui.consoleDev || 'R1'); $('#conInput').value = b.dataset.cmd; $('#conInput').focus(); }
      else if ((b = el('[data-tut]'))) {
        const a = b.dataset.tut, S = G.state();
        if (a === 'next') { TUT.next(S); G.refresh(); A.play('step'); }
        if (a === 'skip') { TUT.finish(S); G.refresh(); }
        if (a === 'min') tutMin = true;
        if (a === 'max') tutMin = false;
        if (a === 'cmds') showCmds = true;
        if (a === 'hint') tutHintOpen = !tutHintOpen;
        dirty = true;
      }
      else if (el('[data-close]') || t.id === 'modal') closeModal();
      else if (el('[data-next]')) { closeModal(); G.nextDay(); }
      else if (el('[data-menu]')) { G.quit(); showMenu(); }
      else if ((b = el('[data-m]'))) {
        const a = b.dataset.m;
        if (a === 'continue') startGame(() => G.load() || G.newGame('normal'));
        if (a === 'daily') { const d = TO.Live.dailyDate(); startGame(() => G.newGame('normal', { daily: d, seed: TO.Live.dailySeed(d) })); }
        if (a === 'ach') achievements();
        if (a === 'settings') settingsModal();
        if (a === 'new') newGameScreen();
        if (a === 'back') showMenu();
        if (a === 'how') howTo();
        if (a === 'credits') credits();
      } else if ((b = el('[data-start]'))) { const k = b.dataset.start; startGame(() => G.newGame(k)); }
      else if ((b = el('[data-gm]'))) {
        const a = b.dataset.gm;
        if (a === 'resume') closeModal();
        if (a === 'save') { if (G.state().daily) toast('Daily challenges are not saved. Finish the shift in one go.'); else { const ok = G.save(); toast(ok ? 'Game saved.' : 'Could not save (browser storage is blocked).', ok ? 'good' : 'bad'); } closeModal(); }
        if (a === 'settings') settingsModal();
        if (a === 'ach') achievements();
        if (a === 'career') careerModal();
        if (a === 'how') howTo();
        if (a === 'credits') credits();
        if (a === 'quit') { G.save(); G.quit(); showMenu(); }
      }
    });
    document.addEventListener('input', e => {
      const f = e.target.closest && e.target.closest('form.settings');
      if (!f) return;
      const v = new FormData(f);
      TO.Settings.set({ sfx: +v.get('sfx') / 100, music: +v.get('music') / 100, cb: v.has('cb'), text: v.get('text') });
      A.setOn(v.has('snd'));
      dirty = true;
    });
    document.addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      if (f.classList.contains('ipform')) {
        const v = Object.fromEntries(new FormData(f));
        const err = G.setNet(f.dataset.dev, { ip: v.ip.trim(), mask: v.mask.trim(), gw: (v.gw || '').trim(), dns: (v.dns || '').trim() });
        $('.formerr', f).textContent = err;
        if (!err) { toast(`${f.dataset.dev} IP settings saved.`, 'good'); A.play('click'); }
      }
      if (f.classList.contains('apform')) {
        const v = Object.fromEntries(new FormData(f));
        const list = [0, 1].filter(i => (v['name' + i] || '').trim()).map(i => ({ name: v['name' + i].trim(), vlan: v['vlan' + i] ? +v['vlan' + i] : null, guest: !!v['guest' + i] }));
        if (!list.length) { $('.formerr', f).textContent = 'Keep at least one SSID.'; return; }
        const err = G.setSsids(list);
        $('.formerr', f).textContent = err;
        if (!err) { toast('Wireless settings saved.', 'good'); A.play('click'); }
      }
    });
    document.addEventListener('keydown', e => {
      if (menuOpen || !G.state()) return;
      const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
      if (e.key === 'Escape') { if (!$('#modal').hidden && !G.state().dayOver && !G.state().over) closeModal(); return; }
      if (typing) return;
      if (e.key === ' ') { e.preventDefault(); G.togglePause(); }
      if (['1', '2', '3'].includes(e.key)) G.setSpeed(+e.key);
      if (e.key === '`') { e.preventDefault(); $('#conBtn').click(); }
      if (e.key === 'h' || e.key === 'H') { e.preventDefault(); hintModal(); }
    });
    window.addEventListener('beforeunload', () => { if (G.state() && !G.state().over) G.save(); });
  }
  function gameMenu() {
    modal(`<h2>Paused</h2><div class="menu-btns">
      <button class="btn primary" data-gm="resume">Resume</button><button class="btn" data-gm="save">Save game</button>
      <button class="btn" data-gm="how">How to play</button><button class="btn" data-gm="settings">Settings</button>
      <button class="btn" data-gm="career">Career</button><button class="btn" data-gm="ach">Achievements</button>
      <button class="btn" data-gm="credits">Credits</button><button class="btn danger" data-gm="quit">Save and quit to menu</button></div>`);
  }

  function frame(now) {
    const dt = Math.min(250, now - (lastFrame || now));
    lastFrame = now;
    const S = G.state();
    if (S && !menuOpen) {
      const typing = document.activeElement === $('#conInput');
      const blocked = !$('#modal').hidden && (S.dayOver || S.over);
      if (!blocked) G.update(dt, typing);
      renderTop();
      if (now - lastMoodCheck > 1000) {
        lastMoodCheck = now;
        const tense = S.attacks.some(a => !a.over && a.detected) || !!(S.crisis && S.crisis.active) || S.alerts.some(a => (a.sev === 'crit' || a.sev === 'high') && a.day === S.day && S.t - a.t < 45);
        A.music.mood(tense ? 'tense' : 'calm');
      }
      if (dirty) { dirty = false; renderAll(); }
      if (S.ui.view === 'office') TO.Office.draw(now);
    }
    requestAnimationFrame(frame);
  }

  TO.UI = {
    start() {
      wire();
      showMenu();
      requestAnimationFrame(frame);
    },
  };
})(globalThis.TO = globalThis.TO || {});
