// Game state, clock, tickets, events director, attackers, projects, economy, saving.
(function (TO) {
  'use strict';
  const N = TO.Net, DATA = TO.DATA;
  const G = (TO.Game = {});
  const SAVE_KEY = 'tierone-save-v1';
  let S = null, net = null, acc = 0;
  const listeners = [], hooks = {};

  // Seeded runs (daily challenge) keep their random stream in the save; normal runs use Math.random.
  function rnd() {
    if (!S || S.rngState == null) return Math.random();
    let t = (S.rngState = (S.rngState + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rand = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = a => a[Math.floor(rnd() * a.length)];
  const traitOf = s => (DATA.PERSONA[s.user] || {}).trait;
  // Personality-weighted pick: staff whose persona matches `trait` are three times as likely.
  const pickBy = (list, trait) => pick(list.flatMap(s => (traitOf(s) === trait ? [s, s, s] : [s])));
  const runHook = (name, ...a) => (hooks[name] || []).forEach(f => f(...a));
  const cm = k => (S.crisis && S.crisis.active && S.crisis[k]) || 1;
  const fmt = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const emit = (type, data) => listeners.forEach(f => f(type, data));
  const mode = () => DATA.MODES[S.mode];
  const staffById = id => S.staff.find(s => s.id === id);
  const present = () => S.staff.filter(s => s.present);
  const pcId = desk => 'PC-' + String(desk).padStart(2, '0');

  G.on = fn => listeners.push(fn);
  G.hook = (name, fn) => (hooks[name] = hooks[name] || []).push(fn);
  G.state = () => S;
  G.net = () => net;
  G.fmt = fmt;

  function log(text, cls = '') {
    S.log.unshift({ day: S.day, t: S.t, text, cls });
    S.log.length = Math.min(S.log.length, 120);
    emit('log', { text, cls });
  }
  const toast = (text, kind = '') => emit('toast', { text, kind });
  const sound = name => emit('sound', name);
  function xp(n) {
    S.xp += n;
    while (S.level < DATA.LEVELS.length - 1 && S.xp >= DATA.LEVELS[S.level + 1]) {
      S.level++;
      log(`Promoted to ${DATA.TITLES[S.level]}! New gear may be in the Shop.`, 'good');
      toast(`Promoted: ${DATA.TITLES[S.level]}`, 'good'); sound('levelup');
    }
  }
  const rep = n => { S.rep = Math.max(0, Math.min(100, S.rep + n)); };
  const money = n => { S.money += n; };

  // ---------- setup ----------
  function initialDevices() {
    const R1 = N.newRouter('R1');
    Object.assign(R1.cfg.ifs['Gi0/0'], { ip: '203.0.113.2', mask: '255.255.255.252', shut: false, natOut: true, desc: 'ISP uplink' });
    R1.cfg.routes.push({ net: '0.0.0.0', mask: '0.0.0.0', nh: '203.0.113.1' });
    R1.cfg.acls[1] = [{ action: 'permit', std: true, src: { ip: '192.168.0.0', wc: '0.0.255.255' } }];
    R1.cfg.nat = { list: 1, iface: 'Gi0/0' };
    R1.saved = N.clone(R1.cfg);
    return {
      ISP: { id: 'ISP', kind: 'isp', model: 'ISP fibre modem', ports: ['LAN'] },
      R1,
      PP1: { id: 'PP1', kind: 'pp', model: '20-port patch panel', ports: [...Array(20)].map((_, i) => String(i + 1)) },
      SW1: N.newSwitch('SW1', 12),
      SRV1: { id: 'SRV1', kind: 'server', model: 'File & DNS server', ports: ['eth0'], net: { ip: '192.168.1.10', mask: '255.255.255.0', gw: '192.168.1.1', dns: '8.8.8.8' }, svc: { files: true, dns: true }, disk: 58, encrypted: false },
      PRN1: { id: 'PRN1', kind: 'printer', model: 'Office laser printer', ports: ['eth0'], net: { ip: '192.168.1.15', mask: '255.255.255.0', gw: '192.168.1.1', dns: '' }, jam: false },
    };
  }
  function hire(desk) {
    const [name, user, dept] = DATA.STAFF[S.nextStaff++ % DATA.STAFF.length];
    const st = { id: 's' + S.nextStaff, name, user, dept, desk, pc: pcId(desk), present: true, hired: S.day, acct: { locked: false, expired: false, compromised: false }, noticeAt: null, infected: false, everWorked: false };
    S.staff.push(st);
    return st;
  }
  // A working day-one network, used by the daily challenge.
  function prebuild() {
    const D = S.devices, L = (a, b) => S.links.push({ a, b, color: S.colorSeq++ % 6 });
    present().forEach((s, i) => L('PP1:' + s.desk, 'SW1:Fa0/' + (i + 1)));
    L('PP1:16', 'SW1:Fa0/10'); L('SRV1:eth0', 'SW1:Fa0/11'); L('SW1:Gi0/1', 'R1:Gi0/1');
    Object.assign(D.R1.cfg.ifs['Gi0/1'], { ip: '192.168.1.1', mask: '255.255.255.0', shut: false, natIn: true });
    D.R1.cfg.excluded.push(['192.168.1.1', '192.168.1.49']);
    D.R1.cfg.pools.STAFF = { network: '192.168.1.0', mask: '255.255.255.0', router: '192.168.1.1', dns: '192.168.1.10' };
    D.R1.saved = N.clone(D.R1.cfg);
  }
  const freeDesks = () => [...Array(15)].map((_, i) => i + 1).filter(d => !S.staff.some(s => s.present && s.desk === d));

  G.newGame = function (modeKey, opts = {}) {
    const m = DATA.MODES[modeKey];
    S = {
      v: 1, mode: modeKey, day: 1, t: 540, speed: 1, paused: false, money: m.money, rep: 60, xp: 0, level: 0, threat: 5, seq: 1000, nextStaff: 0,
      staff: [], devices: initialDevices(), links: [{ a: 'ISP:LAN', b: 'R1:Gi0/0', color: 0 }],
      jacks: Object.fromEntries([...Array(20)].map((_, i) => [i + 1, { ok: true, rogue: null }])), errdis: [], faulty: [], isolated: [], guests: 0,
      tickets: [], projects: [], done: {}, attacks: [], alerts: [], log: [], owned: {}, jobs: [], ispUntil: 0, backupLast: null,
      dayStats: { revenue: 0, fixed: 0, tickets: 0, breaches: 0, incidents: 0 }, stats: { fixed: 0, incidents: 0, attacksStopped: 0, days: 0 },
      tut: null, tutDone: [], tutQueue: [], ui: { view: 'office', consoleDev: 'R1', consoleOpen: false }, over: null, dayOver: null, colorSeq: 1,
      chat: [], crisis: null, ach: {}, streak: 0, bestStreak: 0, hintPaid: [], overtime: false, okPrev: [],
      rngState: opts.seed == null ? null : opts.seed >>> 0, daily: opts.daily || null, nullroute: { beaten: 0, defeated: 0 }, counters: {},
    };
    if (opts.daily) {
      for (let d = 1; d <= 8; d++) hire(d);
      prebuild();
      Object.assign(S, { day: 3, threat: 45, money: 2500, rep: 70 });
      log(`Daily shift ${opts.daily}: the network is already up. Survive 09:00 to 17:00 and score as high as you can.`, 'warn');
    } else {
      for (let d = 1; d <= 4; d++) hire(d);
      log(`Day 1 at ${DATA.COMPANY}. Four staff, one router, one switch, and a box of patch cables. Good luck.`);
      if (modeKey !== 'hard') TO.Tutorial.start(S, 'basics');
      else log('Hard mode: nothing is cabled yet. Patch the desks, configure R1 and get everyone online.', 'warn');
    }
    runHook('newGame');
    G.refresh();
    S.okPrev = present().filter(s => !net.fail[s.pc]).map(s => s.desk);
    if (opts.daily) runHook('dayStart');
    return S;
  };

  // ---------- persistence ----------
  const store = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } };
  G.save = function () {
    const ls = store();
    if (!S || !ls || S.daily) return false;
    try { ls.setItem(SAVE_KEY, JSON.stringify(S)); return true; } catch (e) { return false; }
  };
  G.hasSave = function () { const ls = store(); try { return !!(ls && ls.getItem(SAVE_KEY)); } catch (e) { return false; } };
  G.load = function () {
    const ls = store();
    try {
      const data = ls && JSON.parse(ls.getItem(SAVE_KEY));
      if (!data || data.v !== 1) return false;
      S = data; S.paused = true; acc = 0;
      for (const [k, v] of Object.entries({ chat: [], crisis: null, ach: {}, streak: 0, bestStreak: 0, hintPaid: [], overtime: false, okPrev: [], rngState: null, daily: null, nullroute: { beaten: 0, defeated: 0 }, counters: {} })) if (S[k] === undefined) S[k] = v;
      G.refresh();
      return true;
    } catch (e) { return false; }
  };
  G.deleteSave = () => { const ls = store(); try { ls && ls.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } };
  G.quit = () => { S = null; net = null; };

  // ---------- clock ----------
  G.update = function (dtMs, typing) {
    if (!S || S.over || S.dayOver || S.paused) return;
    if (TO.Tutorial.blocksClock(S)) return;
    if (S.mode === 'easy' && typing) return;
    acc += dtMs * S.speed;
    const per = mode().msPerMin;
    let steps = 0;
    while (acc >= per && steps++ < 30) {
      acc -= per;
      minute();
      if (S.dayOver || S.over) { acc = 0; break; }
    }
  };
  G.setSpeed = s => { S.speed = s; S.paused = false; };
  G.togglePause = () => { S.paused = !S.paused; };

  function minute() {
    S.t++;
    runHook('minute');
    if (S.overtime && S.t === 17 * 60 + 20 && S.day >= mode().attackDay) { log('Night shift: the office is quiet, and so is the wire. Watch the Security tab.', 'warn'); startAttack(); }
    if (S.ispUntil && S.t >= S.ispUntil) { S.devices.ISP.down = false; S.ispUntil = 0; log('ISP outage is over. Internet is back.', 'good'); }
    for (const j of S.jobs.filter(x => S.t >= x.at)) finishJob(j);
    S.jobs = S.jobs.filter(x => S.t < x.at);
    if (S.t % 5 === 0) G.refresh();
    if (S.t % 10 === 0 && !S.overtime) director();
    if (S.t % 60 === 0 && !S.overtime) hourly();
    if (S.t >= (S.overtime ? 18 : 17) * 60) endDay();
  }

  // ---------- core refresh ----------
  G.refresh = function () {
    if (!S) return null;
    const ap = S.devices.AP1;
    S.guests = ap && ap.cfg.ssids.some(s => s.guest) ? 3 : 0;
    net = N.compute(S);
    for (const k of net.violations) {
      const [sw, port] = k.split(':');
      alert('med', 'Port security violation', `%PORT_SECURITY-2-PSECURE_VIOLATION on ${sw} ${port}: an extra device appeared. The port is now err-disabled.`);
    }
    if (S.devices.NAS1 && net.hosts.NAS1 && net.hosts.SRV1) S.backupOk = net.send(net.hosts.NAS1, net.hosts.SRV1.ip, 'tcp', 445).ok;
    else S.backupOk = false;
    tickets();
    attacks();
    projects();
    const okNow = present().filter(s => !net.fail[s.pc]).map(s => s.desk);
    const newly = okNow.filter(d => !(S.okPrev || []).includes(d));
    if (newly.length >= 2) { emit('restored', { desks: newly, total: okNow.length, all: okNow.length === present().length }); sound('restored'); runHook('restored', newly.length); }
    S.okPrev = okNow;
    runHook('refresh');
    const before = S.tut && S.tut.ch + S.tut.i;
    TO.Tutorial.check(S, net);
    if (S.tut && before !== S.tut.ch + S.tut.i) sound('step');
    // Finished lessons pay out once, however they were finished (auto-check, Next or Skip).
    S.tutPaid = S.tutPaid || 0;
    if (S.tutPaid < S.tutDone.length) { S.tutPaid = S.tutDone.length; xp(40); sound('levelup'); }
    if (mode().lose && !S.over && (S.rep <= 0 || S.money < (S.mode === 'hard' ? -500 : -2000))) {
      S.over = { reason: S.rep <= 0 ? 'Staff satisfaction hit zero. The CEO has replaced you with an outsourcing firm.' : 'The IT budget is deeply in the red. Finance has pulled the plug.' };
      G.deleteSave();
      emit('gameover', S.over); sound('alarm');
    }
    emit('change');
    return net;
  };

  // ---------- tickets ----------
  function addTicket(o) {
    const t = Object.assign({ id: 'T-' + ++S.seq, created: S.t, day: S.day, open: true, breached: false }, o);
    t.sla = Math.round((DATA.SLA[o.need || o.kind] || 60) * mode().slaMul * cm('slaMul'));
    const who = o.staff && staffById(o.staff);
    if (who && traitOf(who) === 'urgent' && o.kind !== 'social') t.text = 'URGENT: ' + t.text;
    S.tickets.unshift(t);
    S.dayStats.tickets++;
    sound('ticket');
    runHook('ticketCreated', t);
    return t;
  }
  function closeTicket(t, good, msg) {
    t.open = false; t.closedAt = S.t;
    if (good) {
      const ratio = (S.t - t.created) / t.sla, onTime = ratio <= 1;
      const grade = ratio <= 0.2 ? 'S' : ratio <= 0.45 ? 'A' : ratio <= 0.75 ? 'B' : onTime ? 'C' : 'D';
      if (onTime) { S.streak++; S.bestStreak = Math.max(S.bestStreak, S.streak); } else S.streak = 0;
      const mult = S.streak >= 5 ? 2 : S.streak >= 3 ? 1.5 : 1;
      money(Math.round((onTime ? 40 : 15) * mult)); rep(onTime ? 2 : 0); xp(Math.round((onTime ? 12 : 6) * mult));
      S.dayStats.fixed++; S.stats.fixed++;
      t.grade = grade;
      if (grade === 'S') S.counters.sRanks = (S.counters.sRanks || 0) + 1;
      sound('fixed');
      emit('grade', { grade, streak: S.streak, mult, mins: S.t - t.created });
      runHook('ticketClosed', t, grade);
    }
    if (msg) log(msg, good ? 'good' : 'bad');
    S.tickets = S.tickets.filter(x => x.open || S.tickets.indexOf(x) < 40);
  }
  const THANKS = ['Thanks, that worked!', 'Legend, cheers.', 'All good now.', 'Finally! Thank you.', "You're a lifesaver."];
  function tickets() {
    for (const st of present()) {
      const f = net.fail[st.pc];
      const t = S.tickets.find(x => x.open && x.kind === 'net' && x.staff === st.id);
      if (f) {
        if (t) { t.need = f; continue; }
        if (st.noticeAt == null) st.noticeAt = S.t + rand(3, 12);
        else if (S.t >= st.noticeAt && !S.overtime) {
          addTicket({ kind: 'net', staff: st.id, need: f, text: pick(DATA.TICKET[!st.everWorked && f === 'link' ? 'newhire' : f]) });
          st.noticeAt = null;
        }
      } else {
        st.noticeAt = null; st.everWorked = true;
        if (t) closeTicket(t, true, `${st.name}: "${pick(THANKS)}" (${t.id} fixed)`);
      }
    }
    for (const t of S.tickets) if (t.open && !t.breached && S.t - t.created > t.sla) {
      t.breached = true; rep(-3 * cm('breachMul')); S.dayStats.breaches++; S.streak = 0;
      log(`${t.id} missed its ${t.sla}-minute target. ${staffName(t)} is getting annoyed.`, 'bad');
    }
  }
  const staffName = t => (t.staff ? staffById(t.staff).name : t.fromName || 'Caller');

  G.ticketAct = function (id, act) {
    const t = S.tickets.find(x => x.id === id && x.open);
    if (!t || t.kind !== 'social') return;
    const r = DATA.REQUESTS[t.req];
    if (act === 'approve') {
      if (r.good) { closeTicket(t, true, `Approved "${r.title}". Sensible call.`); xp(10); }
      else {
        closeTicket(t, false, `SECURITY INCIDENT: approving "${r.title}" was a social-engineering trap.`);
        rep(-15); money(-1000); S.dayStats.incidents++; S.stats.incidents++;
        alert('crit', 'Social engineering succeeded', `You approved "${r.title}". Attackers used it. Cost: $1,000 and a lot of trust.`);
        sound('alarm');
      }
    } else if (r.good) { closeTicket(t, false, `Rejected a legitimate request ("${r.title}"). ${staffName(t)} escalated to their manager.`); rep(-4); }
    else { closeTicket(t, false, `Rejected "${r.title}". That was a scam. Well spotted.`); S.counters.scams = (S.counters.scams || 0) + 1; rep(3); xp(20); S.stats.attacksStopped++; sound('fixed'); }
    G.refresh();
  };

  G.hint = function (t) {
    if (!t || !net) return '';
    if (t.kind === 'acct') return t.issue === 'locked' ? 'Press "Unlock account" on this ticket, or open the People tab and click Unlock next to their name.' : 'Press "Reset password" on this ticket, or use the People tab.';
    if (t.kind === 'social') return 'Look for red flags: asking for a password, sending anything to a personal address, skipping approval, or heavy urgency. Legitimate requests name an approver, a purchase order or a company system. Approve legitimate ones and reject scams.';
    if (t.kind !== 'net') return '';
    const st = staffById(t.staff), h = net.hosts[st.pc], D = S.devices;
    const other = net.linkOf['PP1:' + st.desk];
    const srv = net.hosts.SRV1;
    switch (t.need) {
      case 'link': {
        if (!S.jacks[st.desk].ok) return `Desk ${st.desk}'s cable has come loose. Office → click the desk → Reseat cable.`;
        if (!other) return `Patch panel port ${st.desk} is not patched to a switch. Drag a cable in the Server room.`;
        const ps = net.portStatus[other];
        if (ps === 'disabled') return `${other} is administratively down. Configure it with "no shutdown".`;
        if (ps === 'err') return `${other} is err-disabled by port security${S.jacks[st.desk].rogue ? ' because of an extra device at the desk. Remove it, then' : '. Use'} "shutdown" then "no shutdown".`;
        if (ps === 'faulty') return `${other} has a hardware fault. Move the patch cable to a free port and configure it the same way.`;
        if (h && h.blocked) return 'Port security is dropping this PC (restrict/protect mode with too low a maximum).';
        if (S.isolated.includes(st.pc)) return 'This PC is isolated by EDR. Reimage it to release it.';
        return `Patch panel ${st.desk} goes to ${other}, but that end is not a switch port that is up.`;
      }
      case 'ip': {
        const full = Object.values(net.pools).find(p => p.full);
        if (full) return `DHCP pool ${full.name} on ${full.dev} has run out of addresses.`;
        const port = other && other.startsWith('SW') ? other : 'its switch port';
        return `No DHCP lease. ${port}'s VLAN must reach a router interface that has a DHCP pool for its subnet (network + default-router).`;
      }
      case 'dns': return `IP works but names don't resolve. This PC was given DNS server ${h.dns || '(none)'}${srv && h.dns === srv.ip ? '. SRV1 forwards to the internet, so SRV1 needs a working gateway too' : ''}.`;
      case 'web': return 'Web: ' + net.send(h, N.WEB, 'tcp', 443).why + '.';
      case 'files': {
        if (D.SRV1.encrypted) return 'SRV1 has been encrypted by ransomware. Restore it from backup (Server room → SRV1).';
        if (!D.SRV1.svc.files) return 'The file service on SRV1 has stopped. Server room → click SRV1 → Start.';
        if (D.SRV1.disk >= 100) return 'SRV1 disk is full. Server room → click SRV1 → Clean up disk.';
        if (!D.SRV1.svc.dns) return 'DNS service on SRV1 has stopped, so \\\\srv1 cannot be found.';
        if (srv && h.dns !== srv.ip) return `The S: drive is found by name through internal DNS on SRV1 (${srv.ip}), but this PC uses DNS ${h.dns || '(none)'}.`;
        return 'S: drive: ' + (srv ? net.send(h, srv.ip, 'tcp', 445).why : 'SRV1 is not connected') + '.';
      }
      case 'print': {
        if (D.PRN1.jam) return 'The printer has a paper jam. Office → click the printer → Clear jam.';
        const p = net.hosts.PRN1;
        return 'Printer: ' + (p && p.ip ? net.send(h, p.ip, 'tcp', 9100).why : 'the printer is not on the network') + '.';
      }
    }
    return '';
  };

  // ---------- jobs (hands-on fixes that take game time) ----------
  function job(at, kind, arg, label) {
    if (S.jobs.some(j => j.kind === kind && j.arg === arg)) return { ok: false, msg: 'Already in progress.' };
    S.jobs.push({ at: S.t + at, kind, arg, label, start: S.t });
    log(`${label} (${at} min).`);
    sound('click');
    return { ok: true };
  }
  function finishJob(j) {
    const D = S.devices;
    if (j.kind === 'reseat') S.jacks[j.arg].ok = true;
    if (j.kind === 'removeRogue') S.jacks[j.arg].rogue = null;
    if (j.kind === 'reimage') { const st = staffById(j.arg); st.infected = false; S.isolated = S.isolated.filter(x => x !== st.pc); }
    if (j.kind === 'clearJam') D.PRN1.jam = false;
    if (j.kind === 'startFiles') D.SRV1.svc.files = true;
    if (j.kind === 'startDns') D.SRV1.svc.dns = true;
    if (j.kind === 'cleanup') D.SRV1.disk = 61;
    if (j.kind === 'restore' || j.kind === 'rebuild') { D.SRV1.encrypted = false; D.SRV1.svc.files = true; }
    if (j.kind === 'restore') S.counters.restored = (S.counters.restored || 0) + 1;
    log(`Done: ${j.label}.`, 'good');
    sound('fixed');
    G.refresh();
  }
  G.deskAction = function (desk, act) {
    const st = present().find(s => s.desk === desk);
    if (act === 'reseat') return S.jacks[desk].ok ? { ok: false, msg: 'That cable is fine.' } : job(15, 'reseat', desk, `Reseating desk ${desk}'s cable`);
    if (act === 'removeRogue') return S.jacks[desk].rogue ? job(5, 'removeRogue', desk, `Removing the unknown device at desk ${desk}`) : { ok: false, msg: 'Nothing extra plugged in here.' };
    if (act === 'reimage') return st && st.infected ? job(30, 'reimage', st.id, `Reimaging ${st.pc}`) : { ok: false, msg: 'This PC is clean.' };
    if (act === 'clearJam') return S.devices.PRN1.jam ? job(5, 'clearJam', 'PRN1', 'Clearing the printer jam') : { ok: false, msg: 'The printer is fine.' };
    return { ok: false };
  };
  G.deviceAction = function (id, act) {
    const D = S.devices;
    if (id === 'SRV1') {
      if (act === 'startFiles' && !D.SRV1.svc.files) return job(2, 'startFiles', 'SRV1', 'Starting the SRV1 file service');
      if (act === 'startDns' && !D.SRV1.svc.dns) return job(2, 'startDns', 'SRV1', 'Starting the SRV1 DNS service');
      if (act === 'cleanup' && D.SRV1.disk >= 90) return job(10, 'cleanup', 'SRV1', 'Archiving old files on SRV1');
      if (act === 'restore' && D.SRV1.encrypted) return S.backupLast ? job(60, 'restore', 'SRV1', `Restoring SRV1 from the day ${S.backupLast} backup`) : { ok: false, msg: 'There is no backup to restore from.' };
      if (act === 'rebuild' && D.SRV1.encrypted) { money(-2500); rep(-5); return job(180, 'rebuild', 'SRV1', 'Rebuilding SRV1 from scratch ($2,500, files lost)'); }
    }
    return { ok: false, msg: 'Nothing to do.' };
  };

  G.setNet = function (id, v) {
    const d = S.devices[id];
    if (!d || !d.net) return 'Unknown device.';
    if (!N.isIp(v.ip)) return 'IP address is not valid (e.g. 192.168.1.10).';
    const p = N.prefixLen(v.mask);
    if (p < 1 || p > 30) return 'Subnet mask is not valid (e.g. 255.255.255.0).';
    if (v.gw && !N.isIp(v.gw)) return 'Gateway is not a valid IP.';
    if (v.dns && !N.isIp(v.dns)) return 'DNS server is not a valid IP.';
    if (v.gw && !N.inNet(v.gw, v.ip, v.mask)) return `Gateway ${v.gw} is not in the same subnet as ${v.ip}/${p}.`;
    d.net = { ip: v.ip, mask: v.mask, gw: v.gw || '', dns: v.dns || '' };
    log(`${id} IP settings changed to ${v.ip}/${p}, gateway ${v.gw || 'none'}.`);
    G.refresh();
    return '';
  };
  G.setSsids = function (list) {
    const ap = S.devices.AP1;
    if (!ap) return 'No access point installed.';
    for (const s of list) {
      if (!/^[\w -]{1,24}$/.test(s.name)) return 'SSID names: 1-24 letters, numbers, spaces or dashes.';
      if (s.vlan !== null && !(s.vlan >= 1 && s.vlan <= 4094)) return 'VLAN must be 1-4094 or empty for untagged.';
    }
    const tags = list.map(s => s.vlan || 'untagged');
    if (new Set(tags).size !== tags.length) return 'Each SSID needs a different VLAN.';
    ap.cfg.ssids = list.slice(0, 2);
    log('AP1 wireless settings saved.');
    G.refresh();
    return '';
  };

  // ---------- cabling ----------
  const portExists = p => { const i = p.indexOf(':'); const d = S.devices[p.slice(0, i)]; return d && d.ports.includes(p.slice(i + 1)); };
  G.portLinked = p => S.links.find(L => L.a === p || L.b === p);
  G.link = function (a, b) {
    if (a === b || !portExists(a) || !portExists(b)) return 'Pick two different ports.';
    if (G.portLinked(a) || G.portLinked(b)) return 'One of those ports already has a cable. Unplug it first.';
    if (a.split(':')[0] === b.split(':')[0]) return 'Connecting a device to itself would make a loop.';
    if (a.startsWith('PP1:') && b.startsWith('PP1:')) return 'Patch panel to patch panel does nothing. Connect it to a switch.';
    S.links.push({ a, b, color: S.colorSeq++ % 6 });
    sound('click');
    G.refresh();
    return '';
  };
  G.unlink = function (p) {
    const L = G.portLinked(p);
    if (!L) return;
    S.links = S.links.filter(x => x !== L);
    sound('unplug');
    G.refresh();
  };

  // ---------- shop ----------
  G.buy = function (key) {
    const item = DATA.SHOP.find(i => i.key === key);
    if (!item) return 'Unknown item.';
    if (G.owns(key)) return 'Already owned.';
    if (S.level < item.level) return `Requires level ${item.level + 1} (${DATA.TITLES[item.level]}).`;
    if (S.money < item.price) return 'Not enough budget.';
    money(-item.price);
    const D = S.devices;
    if (key === 'sw2') D.SW2 = N.newSwitch('SW2', 24);
    else if (key === 'ap') { D.AP1 = { id: 'AP1', kind: 'ap', model: 'Wi-Fi 6 access point', ports: ['eth0'], cfg: { ssids: [{ name: 'Brightwater', vlan: null, guest: false }] } }; TO.Tutorial.start(S, 'wifi'); offer('wifi'); }
    else if (key === 'nas') { D.NAS1 = { id: 'NAS1', kind: 'nas', model: 'Backup NAS', ports: ['eth0'], net: { ip: '', mask: '255.255.255.0', gw: '', dns: '' } }; offer('backup'); }
    else S.owned[key] = true;
    log(`Bought: ${item.name}.`, 'good');
    sound('buy');
    G.refresh();
    return '';
  };
  G.owns = key => ({ sw2: 'SW2', ap: 'AP1', nas: 'NAS1' }[key] ? !!S.devices[{ sw2: 'SW2', ap: 'AP1', nas: 'NAS1' }[key]] : !!S.owned[key]);

  // ---------- accounts ----------
  G.userAction = function (id, act) {
    const st = staffById(id);
    if (!st) return;
    if (act === 'unlock' && st.acct.locked) { st.acct.locked = false; log(`Unlocked ${st.user}.`); }
    else if (act === 'reset' && (st.acct.expired || st.acct.compromised)) { st.acct.expired = false; st.acct.compromised = false; log(`Reset ${st.user}'s password and signed out all sessions.`); }
    else return;
    sound('click');
    for (const t of S.tickets.filter(x => x.open && x.kind === 'acct' && x.staff === id)) if (!st.acct.locked && !st.acct.expired) closeTicket(t, true, `${st.name}: "I'm back in, thanks!"`);
    G.refresh();
  };

  // ---------- alerts ----------
  function alert(sev, title, text, extra) {
    const a = Object.assign({ id: 'A' + ++S.seq, day: S.day, t: S.t, sev, title, text, read: false }, extra);
    S.alerts.unshift(a);
    S.alerts.length = Math.min(S.alerts.length, 60);
    if (sev === 'high' || sev === 'crit') sound('alarm'); else sound('alert');
    log(`[${sev.toUpperCase()}] ${title}`, sev === 'crit' || sev === 'high' ? 'bad' : 'warn');
    if (sev === 'high' || sev === 'crit') toast(title, 'bad');
    return a;
  }
  G.alertAct = function (id, act) {
    const a = S.alerts.find(x => x.id === id);
    if (!a) return;
    a.read = true;
    if (act === 'isolate' && a.pc && S.owned.edr && !S.isolated.includes(a.pc)) { S.isolated.push(a.pc); log(`EDR isolated ${a.pc} from the network.`, 'good'); sound('click'); }
    G.refresh();
  };

  // ---------- attackers ----------
  function startAttack(forceType) {
    const guestNet = S.guests > 0;
    const bag = ['phish', 'phish', 'phish', 'spray', 'spray', 'pi'].concat(guestNet ? ['guest', 'guest'] : []);
    // On Normal and Hard the attackers go after whatever you have not defended yet.
    if (S.mode !== 'easy') { if (!S.owned.mfa) bag.push('spray', 'spray'); if (!S.done.portsec) bag.push('pi', 'pi'); if (!S.done.srvacl) bag.push('phish', 'phish'); }
    const type = forceType || pick(bag);
    if (S.attacks.some(a => !a.over && a.type === type)) return;
    const a = { id: 'X' + ++S.seq, type, t0: S.t, over: false, detected: false };
    if (type === 'phish') {
      const victims = present().filter(s => net.needs[s.pc] && net.needs[s.pc].web && !s.infected);
      if (!victims.length) return;
      const pool = victims.filter(s => traitOf(s) !== 'paranoid');
      if (!pool.length) return;
      const st = pickBy(pool, 'clicker');
      if (S.owned.training && rnd() < 0.5) { alert('low', 'Phishing email reported', `${st.name} reported a phishing email instead of clicking it. Training paid off.`); xp(10); S.stats.attacksStopped++; return true; }
      st.infected = true;
      Object.assign(a, { staff: st.id, pc: st.pc, detectAt: S.t + (S.owned.edr ? 0 : rand(30, 55)), lateralAt: S.t + rand(85, 120), exfilAt: S.t + 240 });
    } else if (type === 'spray') {
      a.stage = 'spray';
      if (S.owned.mfa) { alert('low', 'Password spray blocked', '311 failed sign-ins against webmail from 45.13.22.0/24. MFA stopped every one.'); xp(15); S.stats.attacksStopped++; return true; }
      alert('med', 'Password spray in progress', '214 failed sign-ins against staff webmail accounts from 45.13.22.0/24. Weak passwords may fall soon. MFA would stop this.');
      a.detected = true;
      a.takeAt = S.t + 30;
    } else if (type === 'pi') {
      const desks = present().filter(s => !S.jacks[s.desk].rogue && S.jacks[s.desk].ok);
      if (!desks.length) return;
      const st = pick(desks);
      S.jacks[st.desk].rogue = 'pi';
      Object.assign(a, { desk: st.desk, noticeAt: S.t + 45, deadline: S.t + 150 });
    } else if (type === 'guest') a.stage = 'scan';
    S.attacks.push(a);
    runHook('attackStart', a);
    if (!S.tutDone.includes('security')) TO.Tutorial.start(S, 'security');
    return a;
  }
  G.debugAttack = t => { startAttack(t); G.refresh(); };

  function guestReach() {
    const srv = net.hosts.SRV1;
    for (const g of Object.values(net.hosts).filter(h => h.kind === 'guest')) {
      if (srv && srv.ip && (net.send(g, srv.ip, 'tcp', 445).ok || net.send(g, srv.ip, 'tcp', 3389).ok)) return true;
      for (const st of present()) { const h = net.hosts[st.pc]; if (h && h.ip && h.src === 'dhcp' && net.send(g, h.ip, 'icmp').ok) return true; }
    }
    return false;
  }

  function attacks() {
    for (const a of S.attacks.filter(x => !x.over)) {
      if (a.type === 'phish') {
        const st = staffById(a.staff), h = net.hosts[a.pc];
        if (!st.infected) {
          a.over = true; xp(a.detected ? 40 : 15); S.stats.attacksStopped++;
          alert('info', 'Malware cleaned', `${a.pc} was reimaged. The attacker lost their foothold.`);
          continue;
        }
        const contained = !h || !h.linked || !net.needs[a.pc].web;
        if (!a.detected && S.t >= a.detectAt) {
          a.detected = true;
          alert('high', S.owned.edr ? `EDR: malware on ${a.pc}` : `${a.pc} is beaconing to a known malware server`,
            S.owned.edr ? `${st.name} opened a malicious invoice attachment. EDR caught it. Isolate the PC, then reimage it from the Office.`
              : `Firewall logs show ${a.pc} (${st.name}) contacting 185.220.101.7:443 every 60 seconds. Contain it: shut its switch port or unplug its patch cable, then reimage it from the Office.`,
            { pc: a.pc, actions: S.owned.edr ? ['isolate'] : [] });
        }
        if (contained && !a.contained && a.detected) { a.contained = true; alert('info', `${a.pc} contained`, `The infected PC can no longer reach the internet. Reimage it from the Office to finish.`); xp(15); }
        if (!contained && !a.lateralDone && S.t >= a.lateralAt) {
          a.lateralDone = true;
          const srv = net.hosts.SRV1;
          if (srv && srv.ip && net.send(h, srv.ip, 'tcp', 3389).ok && !S.devices.SRV1.encrypted) {
            S.devices.SRV1.encrypted = true; rep(-10); S.dayStats.incidents++; S.stats.incidents++;
            alert('crit', 'RANSOMWARE on SRV1', `The attacker on ${a.pc} reached SRV1 over remote desktop (TCP 3389) and encrypted the file share. ${S.backupLast ? 'Restore from your backup in the Server room.' : 'There is no backup. You will have to rebuild it.'}`);
            G.refresh();
          } else alert('med', 'Lateral movement blocked', `The attacker on ${a.pc} tried to reach SRV1 on TCP 3389 and was blocked by your network design.`);
        }
        if (!contained && !a.exfilDone && S.t >= a.exfilAt) { a.exfilDone = true; money(-800); rep(-4); alert('high', 'Data leaking out', `${a.pc} has been sending company data out for hours. Estimated cost $800.`); }
      } else if (a.type === 'spray') {
        if (a.stage === 'spray' && S.t >= a.takeAt) {
          const st = pick(present());
          st.acct.compromised = true;
          Object.assign(a, { stage: 'takeover', staff: st.id, deadline: S.t + 60 });
          alert('high', `Account takeover: ${st.user}`, `${st.user} signed in from two countries 20 minutes apart. Reset the password in the People tab within the hour.`);
        } else if (a.stage === 'takeover') {
          const st = staffById(a.staff);
          if (!st.acct.compromised) { a.over = true; xp(35); S.stats.attacksStopped++; alert('info', 'Account secured', `${st.user}'s password was reset in time.`); }
          else if (S.t > a.deadline) { a.over = true; money(-2500); rep(-8); S.dayStats.incidents++; S.stats.incidents++; alert('crit', 'Invoice fraud', `Attackers used ${st.user}'s mailbox to redirect a customer payment. Cost: $2,500.`); }
        }
      } else if (a.type === 'pi') {
        const j = S.jacks[a.desk];
        if (j.rogue !== 'pi') { a.over = true; xp(a.detected ? 35 : 10); S.stats.attacksStopped++; alert('info', 'Rogue device removed', `The device at desk ${a.desk} has been removed.`); continue; }
        const r = net.rogue.find(x => x.desk === a.desk && x.kind === 'pi');
        const blocked = !r || r.blocked;
        if (!a.detected && (blocked || S.t >= a.noticeAt)) {
          a.detected = true;
          alert(blocked ? 'med' : 'high', blocked ? 'Unknown device blocked' : 'Unknown device on the network',
            `MAC b827.eb4c.11a2 (a Raspberry Pi) is plugged in at desk ${a.desk}${r && r.port ? ' behind ' + r.port : ''}. ${blocked ? 'Port security stopped it.' : 'It is on your network right now.'} Remove it from the desk in the Office.`);
        }
        if (!blocked && S.t > a.deadline) { a.over = true; j.rogue = null; money(-1500); rep(-6); S.dayStats.incidents++; S.stats.incidents++; alert('crit', 'Data stolen by rogue device', `The device at desk ${a.desk} copied files and was quietly removed. Port security would have stopped it. Cost: $1,500.`); }
      } else if (a.type === 'guest') {
        const reach = S.guests > 0 && guestReach();
        if (a.stage === 'scan') {
          if (!reach) { a.over = true; xp(25); S.stats.attacksStopped++; alert('low', 'Guest scan blocked', 'A guest device scanned for internal hosts. Guest isolation held.'); continue; }
          Object.assign(a, { stage: 'open', deadline: S.t + 60, detected: true });
          alert('high', 'Guest device probing the office network', 'A device on guest Wi-Fi can reach the file server or staff PCs. Isolate the guest VLAN with an ACL (or shut the AP port) within the hour.');
        } else if (!reach) { a.over = true; xp(40); S.stats.attacksStopped++; alert('info', 'Guest network isolated', 'The probing guest device can no longer reach anything internal.'); }
        else if (S.t > a.deadline) { a.over = true; money(-2000); rep(-12); S.dayStats.incidents++; S.stats.incidents++; alert('crit', 'Breach via guest Wi-Fi', 'Customer files were copied from SRV1 by a device on guest Wi-Fi. Cost: $2,000.'); }
      }
    }
    S.attacks = S.attacks.filter(a => !a.over || S.t - a.t0 < 600);
  }

  // ---------- director (random events) ----------
  const EVENTS = [
    { w: 3, run() { const c = present().filter(s => net.needs[s.pc] && net.needs[s.pc].link && S.jacks[s.desk].ok); if (!c.length) return; S.jacks[pick(c).desk].ok = false; } },
    { w: 2, run() { const c = present().filter(s => net.needs[s.pc] && net.needs[s.pc].link && !S.jacks[s.desk].rogue); if (!c.length) return; const st = pickBy(c, 'hub'); S.jacks[st.desk].rogue = 'hub'; log(`${st.name} mentions they plugged in "a little hub" for their laptop.`, 'warn'); } },
    { w: 2, run() { if (!S.devices.PRN1.jam) S.devices.PRN1.jam = true; } },
    { w: 1, day: 2, run() { if (S.devices.SRV1.svc.files) { S.devices.SRV1.svc.files = false; alert('med', 'SRV1: file service stopped', 'The SMB file service on SRV1 crashed. Start it from the Server room.'); } } },
    { w: 1, day: 3, run() { if (S.devices.SRV1.disk < 100) { S.devices.SRV1.disk = 100; alert('med', 'SRV1 disk full', 'SRV1\'s data disk is at 100%. Nobody can save files.'); } } },
    { w: 1, day: 3, run() { const ports = Object.entries(net.portStatus).filter(([k, v]) => v === 'up' && /^SW\d:Fa/.test(k) && !S.faulty.includes(k)); if (!ports.length) return; const k = pick(ports)[0]; S.faulty.push(k); alert('med', `Hardware fault on ${k.replace(':', ' ')}`, `%PM-4-PORT_FAILURE: ${k.replace(':', ' ')} failed its self-test and is dead. Move the cable to a spare port and configure it to match.`); } },
    { w: 2, run() { const c = present().filter(s => !s.acct.locked && !s.acct.expired); if (!c.length) return; const st = pickBy(c, 'locker'); st.acct.locked = true; addTicket({ kind: 'acct', staff: st.id, need: 'acct', issue: 'locked', text: 'I mistyped my password a few times and now my account is locked out.' }); } },
    { w: 1, day: 2, run() { const c = present().filter(s => !s.acct.locked && !s.acct.expired); if (!c.length) return; const st = pick(c); st.acct.expired = true; addTicket({ kind: 'acct', staff: st.id, need: 'acct', issue: 'expired', text: 'It says my password expired and the change screen gives an error.' }); } },
    { w: 2, run() { const i = rand(0, DATA.REQUESTS.length - 1), r = DATA.REQUESTS[i]; const st = pick(present()); addTicket({ kind: 'social', req: i, staff: r.from === 'staff' ? st.id : null, fromName: r.from === 'caller' ? 'Phone call' : r.from === 'email' ? 'Email' : null, need: 'social', text: r.text, title: r.title }); } },
    { w: 0.6, day: 3, run() { if (S.devices.ISP.down) return; S.devices.ISP.down = true; S.ispUntil = S.t + rand(20, 40); alert('med', 'ISP outage', 'Your ISP reports a fibre cut in the area. Internet is down for everyone until they fix it. Nothing to fix on your side. Tell your users.'); } },
  ];
  function director() {
    if (TO.Tutorial.blocksClock(S)) return;
    const m = mode();
    const busy = S.tickets.filter(t => t.open).length + S.attacks.filter(a => !a.over).length * 2;
    let p = 0.12 * m.eventRate * (1 + (S.day - 1) * 0.1) * cm('evMul');
    if (S.day === 1) p *= 0.5;
    if (busy >= 5) p *= 0.25;
    if (rnd() < p) {
      const ev = EVENTS.filter(e => !e.day || S.day >= e.day);
      let r = rnd() * ev.reduce((a, e) => a + e.w, 0);
      for (const e of ev) { r -= e.w; if (r <= 0) { e.run(); break; } }
      G.refresh();
    }
    if (S.day >= m.attackDay && busy < 8 && rnd() < Math.min(0.25, S.threat / 500)) { startAttack(); G.refresh(); }
  }

  function hourly() {
    let p = 0;
    for (const st of present()) {
      const n = net.needs[st.pc] || {};
      let v = ((n.web && n.dns ? 1 : 0) + (n.files ? 1 : 0) + (n.print ? 1 : 0)) / 3;
      if (st.acct.locked || st.acct.expired) v = 0;
      if (st.infected) v *= 0.5;
      p += v;
    }
    const rev = Math.round(p * 25 * cm('revMul'));
    money(rev); S.dayStats.revenue += rev;
  }

  // ---------- projects ----------
  const switches = () => Object.values(S.devices).filter(d => d.kind === 'switch');
  const cisco = () => Object.values(S.devices).filter(d => d.kind === 'switch' || d.kind === 'router');
  const deskPort = desk => { const o = net.linkOf['PP1:' + desk]; return o && /^SW\d:/.test(o) ? o : null; };
  const portCfg = k => { const [d, p] = k.split(':'); return S.devices[d].cfg.ifs[p]; };
  const allOk = () => present().every(s => !net.fail[s.pc]);
  const subnetOf = h => h && h.ip && h.src !== 'apipa' ? N.n2ip((N.ip2n(h.ip) & N.ip2n(h.mask)) >>> 0) + '/' + h.mask : null;
  const PROJECTS = {
    portsec: { title: 'Lock down desk ports', minDay: 2, reward: [400, 60, 3], desc: 'Stop staff plugging in hubs and strangers plugging in gadgets. On every switch port that goes to a staffed desk: "switchport mode access" then "switchport port-security" (max 1 MAC, violation shutdown).',
      cond: () => present().every(s => { const k = deskPort(s.desk); return k && portCfg(k).ps; }) },
    save: { title: 'Save every config', minDay: 2, repeat: true, reward: [100, 20, 1], desc: 'A power cut wipes anything that is not saved. Run "write memory" on every router and switch.',
      cond: () => cisco().every(d => N.isSaved(d)) },
    finvlan: { title: 'Finance gets its own VLAN', minDay: 3, reward: [700, 120, 5], chapter: 'vlans', desc: 'The auditors want Finance separated. Put every Finance PC in VLAN 20 with its own subnet (e.g. 192.168.20.0/24) routed by R1. Everyone must still reach the web, the S: drive and the printer.',
      cond: () => { const fin = present().filter(s => s.dept === 'Finance'), rest = present().filter(s => s.dept !== 'Finance'); if (!fin.length || !allOk()) return false;
        const fs = new Set(fin.map(s => subnetOf(net.hosts[s.pc]))); if (fs.size !== 1) return false;
        return fin.every(s => { const k = deskPort(s.desk); return k && portCfg(k).vlan === 20 && portCfg(k).mode !== 'trunk'; }) && rest.every(s => !fs.has(subnetOf(net.hosts[s.pc]))); } },
    unused: { title: 'Shut unused switch ports', minDay: 4, repeat: true, reward: [150, 30, 1], desc: 'An open, unused port is an invitation. Use "shutdown" on every switch port that has no cable. (Tip: "interface range fa0/9-12".)',
      cond: () => switches().every(d => d.ports.every(p => G.portLinked(d.id + ':' + p) || d.cfg.ifs[p].shut)) },
    wifi: { title: 'Guest Wi-Fi', minDay: 4, reward: [800, 150, 6], chapter: 'wifi', desc: 'Visitors want Wi-Fi. Buy an access point, give it a guest SSID on its own VLAN, and make sure guests reach the internet but cannot reach SRV1 or any staff PC.',
      cond: () => { const gs = Object.values(net.hosts).filter(h => h.kind === 'guest'); return gs.length > 0 && gs.every(g => net.needs[g.id].web && net.needs[g.id].dns) && !guestReach(); } },
    desc: { title: 'Label your ports', minDay: 5, repeat: true, reward: [120, 25, 1], desc: 'Future-you will thank you. Give every connected switch port a "description" (e.g. "Desk 3 - Pilar").',
      cond: () => switches().every(d => d.ports.every(p => !G.portLinked(d.id + ':' + p) || d.cfg.ifs[p].desc)) },
    backup: { title: 'Nightly backups', minDay: 5, reward: [500, 80, 3], desc: 'Ransomware is coming for everyone. Buy the backup NAS, rack it, give it an IP and make sure it can reach SRV1 on TCP 445. Backups run every night.',
      cond: () => S.backupOk },
    srvacl: { title: 'Protect the server', minDay: 6, reward: [900, 160, 6], desc: 'Ransomware spreads over remote admin ports. Move SRV1 into its own server subnet (e.g. VLAN 99, 192.168.99.0/24) and use an ACL on R1 so staff PCs can reach SRV1 only on TCP 445 and UDP 53. Everything must still work.',
      cond: () => { const srv = net.hosts.SRV1; if (!srv || !allOk()) return false; const ss = subnetOf(srv);
        return present().every(s => { const h = net.hosts[s.pc]; return subnetOf(h) !== ss && !net.send(h, srv.ip, 'tcp', 3389).ok; }); } },
  };
  G.PROJECTS = PROJECTS;
  function offer(key) {
    const P = PROJECTS[key];
    if (!P || S.projects.some(p => p.key === key) || (!P.repeat && S.done[key])) return;
    S.projects.push({ key, day: S.day });
    log(`New project: ${P.title}.`, 'warn');
    if (P.chapter) TO.Tutorial.start(S, P.chapter);
  }
  function offerProjects() {
    const order = ['portsec', 'save', 'finvlan', 'wifi', 'backup', 'srvacl', 'unused', 'desc'];
    for (const k of order) {
      const P = PROJECTS[k];
      if (S.projects.length >= 3) break;
      if (S.day < P.minDay || S.projects.some(p => p.key === k)) continue;
      if (!P.repeat && S.done[k]) continue;
      if (P.repeat && (S.done[k] && S.day - S.done[k] < 2 || P.cond())) continue;
      offer(k);
    }
  }
  function projects() {
    for (const p of S.projects.slice()) {
      const P = PROJECTS[p.key];
      if (!P.cond()) continue;
      S.projects = S.projects.filter(x => x !== p);
      S.done[p.key] = S.day;
      const [m, x, r] = P.reward;
      money(m); xp(x); rep(r);
      log(`Project complete: ${P.title}. +$${m}, +${x} XP.`, 'good');
      toast(`Project complete: ${P.title}`, 'good');
      sound('levelup');
    }
  }

  // ---------- day cycle ----------
  function endDay() {
    if (S.overtime) {
      S.t = 18 * 60; S.overtime = false;
      S.dayOver = Object.assign({ day: S.day, late: true, open: S.tickets.filter(t => t.open).length }, S.dayStats);
      G.refresh();
      G.save();
      emit('dayend', S.dayOver);
      sound('dayend');
      return;
    }
    S.t = 17 * 60;
    runHook('endDay');
    // Head office tops up the IT budget in proportion to how happy staff are.
    const budget = Math.round((150 + present().length * 30) * S.rep / 60);
    money(budget);
    const sum = Object.assign({ day: S.day, budget }, S.dayStats, { open: S.tickets.filter(t => t.open).length });
    sum.backup = !!S.backupOk;
    sum.unsaved = cisco().filter(d => !N.isSaved(d)).map(d => d.id);
    S.stats.days++;
    if (S.daily) sum.daily = G.dailyResult();
    S.dayOver = sum;
    G.refresh();
    G.save();
    emit('dayend', sum);
    sound('dayend');
  }
  G.stayLate = function () {
    if (!S.dayOver || S.dayOver.late || S.daily) return false;
    S.dayOver = null; S.overtime = true; S.t = 17 * 60; S.paused = false;
    money(-200);
    log('Staying late (until 18:00). No new tickets, no revenue, $200 overtime. A good time for risky changes.', 'warn');
    G.refresh();
    return true;
  };
  G.dailyResult = function () {
    const d = S.dayStats;
    const score = Math.max(0, Math.round(d.fixed * 50 + S.bestStreak * 30 + S.rep * 20 + Math.max(0, S.money - 2500) / 2 - d.incidents * 300 - d.breaches * 80 + S.stats.attacksStopped * 150 + S.xp * 0.5));
    const grade = score >= 3500 ? 'S' : score >= 2500 ? 'A' : score >= 1700 ? 'B' : score >= 900 ? 'C' : 'D';
    return { score, grade, date: S.daily, fixed: d.fixed, incidents: d.incidents, breaches: d.breaches, stopped: S.stats.attacksStopped, streak: S.bestStreak };
  };
  function shiftTimes(by) {
    for (const t of S.tickets) { t.created += by; if (t.closedAt != null) t.closedAt += by; }
    for (const j of S.jobs) { j.at += by; j.start += by; }
    for (const a of S.attacks) for (const k of ['t0', 'detectAt', 'lateralAt', 'exfilAt', 'takeAt', 'deadline', 'noticeAt']) if (typeof a[k] === 'number') a[k] += by;
    if (S.ispUntil) S.ispUntil += by;
    for (const st of S.staff) if (st.noticeAt != null) st.noticeAt += by;
  }
  G.nextDay = function () {
    const endT = S.t;
    // Overnight: backups run, and sometimes the power goes.
    if (S.backupOk) S.backupLast = S.day;
    let power = null;
    if (S.day >= 3 && !S.owned.ups && rnd() < 0.3) {
      power = cisco().filter(d => !N.isSaved(d)).map(d => d.id);
      for (const d of cisco()) d.cfg = d.saved ? N.clone(d.saved) : N.defaultCfg(d);
      S.errdis = [];
      if (!power.length) S.counters.powerSafe = (S.counters.powerSafe || 0) + 1;
    }
    S.day++; S.t = 540; S.dayOver = null; S.paused = false;
    shiftTimes(540 - endT); // clocks restart at 09:00 but open work keeps its age
    S.dayStats = { revenue: 0, fixed: 0, tickets: 0, breaches: 0, incidents: 0 };
    const mit = (S.owned.mfa ? 2 : 0) + (S.owned.training ? 1 : 0) + (S.owned.edr ? 2 : 0);
    S.threat = Math.max(0, Math.min(100, S.threat + mode().threatRate * (1 + present().length / 10) - mit));
    const free = freeDesks();
    const n = S.rep < 35 ? 0 : S.day <= 3 ? Math.min(2, free.length) : Math.min(rand(0, 2), free.length);
    for (let i = 0; i < n; i++) { const st = hire(free[i]); log(`New hire: ${st.name} (${st.dept}) starts today at desk ${st.desk}.`, 'warn'); }
    log(`Day ${S.day} begins. Threat level ${Math.round(S.threat)}%.`);
    if (power) alert('high', 'Overnight power cut', power.length ? `The power went out overnight and the rack rebooted. Unsaved changes on ${power.join(', ')} were lost. Use "write memory", or buy a UPS.` : 'The power went out overnight and the rack rebooted, but every config was saved. Nothing lost.');
    runHook('dayStart');
    offerProjects();
    G.refresh();
    G.save();
  };

  // Everything the extras modules (chat, crises, achievements, hints) may touch.
  G.api = {
    log, alert, toast, sound, xp, rep, money, addTicket, startAttack, staffById, present, cisco, rand, pick, rnd, pickBy, traitOf, mode,
    freeDesks, offerProjects, emit, projectsOf: () => PROJECTS,
  };
  G.useHint = function (id) {
    if (S.hintPaid.includes(id)) return 0;
    S.hintPaid.push(id); if (S.hintPaid.length > 300) S.hintPaid.shift();
    S.counters.hints = (S.counters.hints || 0) + 1;
    const cost = S.mode === 'hard' ? 50 : 0;
    if (cost) { money(-cost); log(`Hint bought from a vendor: -$${cost}.`); }
    emit('change');
    return cost;
  };

  TO.Game = G;
})(globalThis.TO = globalThis.TO || {});
