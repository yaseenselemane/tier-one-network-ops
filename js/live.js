// "Living world" systems built on game hooks: office chat, the CEO, crisis days, the NULLROUTE villain,
// achievements, the career profile and the daily challenge.
(function (TO) {
  'use strict';
  const G = TO.Game, DATA = TO.DATA, N = TO.Net;
  const api = () => G.api;
  const S = () => G.state();
  const pad = n => String(n).padStart(2, '0');

  // ---------- profile (kept across runs in this browser) ----------
  const PKEY = 'tierone-profile';
  const store = () => { try { return localStorage; } catch (e) { return null; } };
  let profile = { ach: {}, daily: {} };
  try { const ls = store(); const p = ls && JSON.parse(ls.getItem(PKEY)); if (p && p.ach && p.daily) profile = p; } catch (e) { /* fresh profile */ }
  const saveProfile = () => { try { const ls = store(); ls && ls.setItem(PKEY, JSON.stringify(profile)); } catch (e) { /* storage blocked */ } };

  const dailyDate = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  function dailySeed(str) { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h || 1; }
  function recordDaily(res) {
    const prev = profile.daily[res.date] || 0, isNew = res.score > prev;
    if (isNew) { profile.daily[res.date] = res.score; saveProfile(); }
    return { best: Math.max(prev, res.score), isNew };
  }

  // ---------- chat ----------
  function say(from, role, text) {
    const s = S();
    if (!s) return;
    s.chat.push({ id: (s.counters.chatId = (s.counters.chatId || 0) + 1), t: s.t, day: s.day, from, role, text });
    if (s.chat.length > 120) s.chat.shift();
    api().emit('chat', { from, role, text });
  }
  const ceo = text => say(DATA.CEO + ' (CEO)', 'ceo', text);
  const villain = text => say('NULLROUTE', 'villain', text);
  const staffSay = (st, text) => say(st.name, 'staff', text);

  G.hook('newGame', () => { ceo(api().pick(DATA.CEO_LINES.welcome)); });
  G.hook('ticketCreated', t => {
    const st = t.staff && api().staffById(t.staff);
    if (!st || !DATA.CHAT_NEED[t.need]) return;
    let txt = api().pick(DATA.CHAT_NEED[t.need]);
    const tr = api().traitOf(st);
    if (tr && tr !== 'calm' && api().rnd() < 0.5) txt += ' ' + DATA.PERSONA_CHAT[tr];
    staffSay(st, txt);
  });
  G.hook('ticketClosed', t => {
    const st = t.staff && api().staffById(t.staff);
    if (st && api().rnd() < 0.35) staffSay(st, api().pick(DATA.THANKS_CHAT));
  });
  G.hook('restored', () => {
    const p = api().present();
    if (p.length) staffSay(api().pick(p), api().pick(DATA.THANKS_CHAT));
  });

  // ---------- crisis days ----------
  const FX = ['slaMul', 'breachMul', 'evMul', 'revMul'];
  const REWARD = { investor: [1500, 80, 8, -12], blackfriday: [1200, 80, 5, -6], move: [1000, 100, 5, -8], audit: [1000, 100, 6, -10], showdown: [3000, 300, 15, -10] };
  const deskPort = (s, desk) => { const o = G.net().linkOf['PP1:' + desk]; return o && /^SW\d:/.test(o) ? o : null; };

  G.hook('dayStart', () => {
    const s = S(), a = api();
    s.crisis = null;
    let key = null;
    if (!s.daily && s.day >= 10 && s.day % 10 === 0) key = 'showdown';
    else if (s.daily) key = a.pick(['investor', 'blackfriday', 'audit']);
    else if (s.day >= 4 && s.day - (s.counters.lastCrisis || 0) >= 2 && a.rnd() < 0.4) {
      const opts = Object.entries(DATA.CRISES).filter(([k, c]) => k !== 'showdown' && s.day >= c.minDay).map(([k]) => k);
      key = a.pick(opts);
    }
    if (key) {
      const d = DATA.CRISES[key];
      s.crisis = { key, active: false, done: false, start: d.start, end: d.end, snap: null };
      s.counters.lastCrisis = s.day;
      if (key === 'showdown') { villain(d.intro); a.toast('Operation Blackout today', 'bad'); a.sound('alarm'); } else ceo(d.intro);
      a.log(`Crisis day: ${d.title}. ${d.intro}`, 'warn');
    } else if (!s.daily && a.rnd() < 0.5) ceo(a.pick(s.rep >= 65 ? DATA.CEO_LINES.good : s.rep < 40 ? DATA.CEO_LINES.bad : DATA.CEO_LINES.welcome));
    const lvl = Math.floor(s.nullroute.beaten / 3);
    if (lvl > (s.nullroute.level || 0)) { s.nullroute.level = lvl; s.threat = Math.min(100, s.threat + 3); villain(a.pick(DATA.NULLROUTE.level)); }
  });

  function activate(s, c) {
    const d = DATA.CRISES[c.key], a = api();
    c.active = true;
    for (const k of FX) if (d[k]) c[k] = d[k];
    c.snap = { breaches: s.dayStats.breaches, incidents: s.dayStats.incidents };
    (c.key === 'showdown' ? villain : ceo)(d.go);
    a.toast(d.title + ' begins', 'bad'); a.sound('alarm');
    a.log(`${d.title} has started.`, 'bad');
    if (c.key === 'move') { s.links = s.links.filter(L => !(L.a.startsWith('PP1:') || L.b.startsWith('PP1:'))); G.refresh(); }
  }
  function finish(s, c) {
    const d = DATA.CRISES[c.key], a = api(), net = G.net();
    c.active = false; c.done = true;
    let ok = false;
    if (c.key === 'investor') ok = s.dayStats.breaches === c.snap.breaches && !s.tickets.some(t => t.open && t.kind === 'net');
    else if (c.key === 'blackfriday') ok = s.dayStats.incidents === c.snap.incidents && s.dayStats.breaches - c.snap.breaches <= 2;
    else if (c.key === 'move') ok = a.present().every(x => !net.fail[x.pc]);
    else if (c.key === 'audit') ok = a.present().every(x => { const k = deskPort(s, x.desk); return k && s.devices[k.split(':')[0]].cfg.ifs[k.split(':')[1]].ps; }) && a.cisco().every(x => N.isSaved(x));
    else if (c.key === 'showdown') ok = s.dayStats.incidents === c.snap.incidents;
    const [m, x, r, bad] = REWARD[c.key];
    c.result = ok;
    if (ok) {
      a.money(m); a.xp(x); a.rep(r); s.counters.crisesWon = (s.counters.crisesWon || 0) + 1;
      if (c.key === 'showdown') s.nullroute.defeated++;
      a.toast(`${d.title}: success! +$${m}`, 'good'); a.sound('levelup');
      a.log(`${d.title} won. +$${m}, +${x} XP.`, 'good');
    } else {
      a.rep(bad);
      if (c.key === 'audit') a.money(-500);
      a.toast(`${d.title}: failed`, 'bad'); a.sound('error');
      a.log(`${d.title} failed.`, 'bad');
    }
    (c.key === 'showdown' ? (ok ? ceo : villain) : ceo)(ok ? d.win : d.lose);
    G.refresh();
  }

  G.hook('minute', () => {
    const s = S(), a = api();
    if (!s) return;
    const c = s.crisis;
    if (c && !c.done) {
      if (!c.active && s.t >= c.start && s.t < c.end) activate(s, c);
      else if (c.active && s.t >= c.end) finish(s, c);
      if (c && c.active && c.key === 'showdown') {
        // Four waves. If one cannot start yet (nobody online to phish, same attack still running), retry each minute.
        if (!c.waves) c.waves = [0, 90, 180, 270].map(o => ({ at: c.start + o, done: false }));
        c.waves.forEach((w, i) => {
          if (w.done || s.t < w.at) return;
          if (s.t > w.at + 40) { w.done = true; return; }
          if (a.startAttack(['phish', 'spray', 'pi', s.guests > 0 ? 'guest' : 'phish'][i])) w.done = true;
        });
      }
    }
    if (!s.overtime && s.t % 45 === 0 && a.rnd() < 0.35) {
      const p = a.present();
      if (p.length) staffSay(a.pick(p), a.pick(DATA.BANTER));
    }
  });

  // ---------- villain ----------
  G.hook('attackStart', at => {
    const s = S(), a = api();
    if (!(s.crisis && s.crisis.key === 'showdown' && s.crisis.active) || a.rnd() < 0.3) villain(a.pick(DATA.NULLROUTE.start));
    if (at.type === 'phish') {
      const para = a.present().filter(x => a.traitOf(x) === 'paranoid');
      if (para.length && a.rnd() < 0.5) staffSay(a.pick(para), 'Got a strange "invoice" email. Not opening it. Someone else might.');
    }
  });

  // ---------- achievements ----------
  const RULES = {
    first_fix: s => s.stats.fixed >= 1, streak5: s => s.bestStreak >= 5, s_rank: s => (s.counters.sRanks || 0) >= 1, scam3: s => (s.counters.scams || 0) >= 3,
    stopped5: s => s.stats.attacksStopped >= 5, portsec: s => !!s.done.portsec, vlan: s => !!s.done.finvlan, wifi: s => !!s.done.wifi, backups: s => !!s.done.backup,
    srvacl: s => !!s.done.srvacl, restored: s => (s.counters.restored || 0) >= 1, powersafe: s => (s.counters.powerSafe || 0) >= 1, crisis3: s => (s.counters.crisesWon || 0) >= 3,
    boss: s => s.nullroute.defeated >= 1, day10: s => s.day >= 10, day30: s => s.day >= 30, level5: s => s.level >= 5, rich: s => s.money >= 10000,
    nohint: s => s.day >= 5 && s.mode !== 'easy' && !s.counters.hints, daily: s => !!(s.daily && s.dayOver),
  };
  G.hook('refresh', () => {
    const s = S(), a = api();
    if (!s) return;
    const c = s.counters;
    if (c.vStopped === undefined) { c.vStopped = s.stats.attacksStopped; c.vInc = s.stats.incidents; }
    if (s.stats.attacksStopped > c.vStopped) { c.vStopped = s.stats.attacksStopped; s.nullroute.beaten++; villain(a.pick(DATA.NULLROUTE.stopped)); }
    if (s.stats.incidents > c.vInc) { c.vInc = s.stats.incidents; villain(a.pick(DATA.NULLROUTE.lost)); }
    for (const [key, name] of DATA.ACHIEVEMENTS.map(x => [x[0], x[1]])) {
      if (s.ach[key] || !RULES[key](s)) continue;
      s.ach[key] = s.day;
      if (!profile.ach[key]) { profile.ach[key] = dailyDate(); saveProfile(); }
      a.toast('Achievement: ' + name, 'good'); a.sound('levelup'); a.log('Achievement unlocked: ' + name, 'good');
    }
  });

  function career() {
    const s = S(), days = s.stats.days + (s.dayOver ? 0 : 0);
    const rank = s.day >= 30 ? 'S' : s.day >= 15 ? 'A' : s.day >= 7 ? 'B' : s.day >= 3 ? 'C' : 'D';
    return {
      rank, days: s.day, fixed: s.stats.fixed, bestStreak: s.bestStreak, stopped: s.stats.attacksStopped, incidents: s.stats.incidents, level: DATA.TITLES[s.level],
      hints: s.counters.hints || 0, crises: s.counters.crisesWon || 0, boss: s.nullroute.defeated, money: s.money, mode: DATA.MODES[s.mode].label, achievements: Object.keys(s.ach).length, unused: days,
    };
  }

  TO.Live = { say, career, dailyDate, dailySeed, recordDaily, profile: () => profile, hasAch: k => !!profile.ach[k] };
})(globalThis.TO = globalThis.TO || {});
