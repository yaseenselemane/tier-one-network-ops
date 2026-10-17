// Headless tests for hints, projects, crises, the daily challenge, overtime and grades.  Run: npm test
'use strict';
const assert = require('assert');
const path = require('path');
for (const f of ['net', 'cli', 'data', 'tutorial', 'game', 'hints', 'live']) require(path.join(__dirname, '..', 'js', f + '.js'));
const { Net: N, CLI, Game: G, Tutorial: T } = globalThis.TO;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

function console_(dev) {
  const env = { S: G.state, net: () => G.refresh(), changed: () => G.refresh(), mode: () => G.state().mode, hint: () => TO.Hints.text(TO.Hints.next()) };
  const s = CLI.session(dev, env);
  return lines => lines.map(l => CLI.exec(s, l)).join('\n');
}
function day1(mode = 'normal') {
  G.newGame(mode);
  const S = G.state();
  if (S.tut) T.next(S);
  for (const [a, b] of [['PP1:1', 'SW1:Fa0/1'], ['PP1:2', 'SW1:Fa0/2'], ['PP1:3', 'SW1:Fa0/3'], ['PP1:4', 'SW1:Fa0/4'], ['PP1:16', 'SW1:Fa0/10'], ['SRV1:eth0', 'SW1:Fa0/11'], ['SW1:Gi0/1', 'R1:Gi0/1']]) assert.strictEqual(G.link(a, b), '');
  console_('R1')(['en', 'conf t', 'int g0/1', 'ip add 192.168.1.1 255.255.255.0', 'no shut', 'exit', 'ip dhcp excluded-address 192.168.1.1 192.168.1.49',
    'ip dhcp pool STAFF', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1', 'dns-server 192.168.1.10', 'exit', 'int g0/1', 'ip nat inside', 'end', 'wr']);
  S.tut = null;
  return S;
}
const allOk = () => { for (const st of G.state().staff) assert.strictEqual(G.net().fail[st.pc], null, st.pc + ' should work: ' + G.net().fail[st.pc]); };

console.log('Tier One v2 tests');

test('Protect-the-server project is solvable with the commands the hint gives', () => {
  const S = day1();
  console_('SW1')(['en', 'conf t', 'vlan 99', 'name SERVERS', 'int fa0/11', 'sw mode acc', 'sw acc vlan 99', 'int gi0/1', 'sw mode trunk', 'end']);
  console_('R1')(['en', 'conf t', 'int g0/1.99', 'encapsulation dot1Q 99', 'ip address 192.168.99.1 255.255.255.0', 'ip nat inside', 'exit', 'ip dhcp pool STAFF', 'dns-server 192.168.99.10', 'exit',
    'access-list 120 permit tcp any host 192.168.99.10 eq 445', 'access-list 120 permit udp any host 192.168.99.10 eq 53', 'access-list 120 deny ip any host 192.168.99.10', 'access-list 120 permit ip any any', 'int g0/1', 'ip access-group 120 in', 'end']);
  assert.strictEqual(G.setNet('SRV1', { ip: '192.168.99.10', mask: '255.255.255.0', gw: '192.168.99.1', dns: '8.8.8.8' }), '');
  G.refresh();
  allOk();
  assert.ok(G.PROJECTS.srvacl.cond());
  assert.ok(TO.Hints.project('srvacl').slice(0, 4).every(st => st.ok === true), 'hint steps all tick once solved');
});

test('Guest Wi-Fi project is solvable and the ACL step matters', () => {
  const S = day1(); S.level = 6; S.money = 20000;
  assert.strictEqual(G.buy('ap'), ''); S.tut = null;
  assert.strictEqual(G.link('PP1:17', 'SW1:Fa0/5'), '');
  assert.strictEqual(G.setSsids([{ name: 'Brightwater', vlan: null, guest: false }, { name: 'Guest', vlan: 30, guest: true }]), '');
  console_('SW1')(['en', 'conf t', 'vlan 30', 'name GUEST', 'int fa0/5', 'sw mode trunk', 'int gi0/1', 'sw mode trunk', 'end']);
  console_('R1')(['en', 'conf t', 'int g0/1.30', 'encapsulation dot1Q 30', 'ip address 192.168.30.1 255.255.255.0', 'ip nat inside', 'exit', 'ip dhcp pool GUEST', 'network 192.168.30.0 255.255.255.0', 'default-router 192.168.30.1', 'dns-server 8.8.8.8', 'exit', 'end']);
  G.refresh();
  const guests = Object.values(G.net().hosts).filter(h => h.kind === 'guest');
  assert.ok(guests.length > 0 && guests.every(g => G.net().needs[g.id].web), 'guests reach the internet');
  assert.ok(!G.PROJECTS.wifi.cond(), 'guests can still reach the office, so not done yet');
  console_('R1')(['en', 'conf t', 'access-list 130 deny ip 192.168.30.0 0.0.0.255 192.168.0.0 0.0.255.255', 'access-list 130 permit ip any any', 'int g0/1.30', 'ip access-group 130 in', 'end']);
  assert.ok(G.PROJECTS.wifi.cond());
});

test('Backup project is solvable', () => {
  const S = day1(); S.level = 6; S.money = 20000;
  assert.strictEqual(G.buy('nas'), '');
  assert.strictEqual(G.link('NAS1:eth0', 'SW1:Fa0/12'), '');
  assert.strictEqual(G.setNet('NAS1', { ip: '192.168.1.20', mask: '255.255.255.0', gw: '192.168.1.1', dns: '' }), '');
  G.refresh();
  assert.ok(S.backupOk && G.PROJECTS.backup.cond());
});

test('every hint function works in every state of a long run', () => {
  for (const m of ['easy', 'normal', 'hard']) {
    day1(m);
    const S = G.state(); S.level = 6; S.money = 50000;
    for (const k of ['sw2', 'ups', 'ap', 'training', 'nas', 'mfa', 'edr']) G.buy(k);
    S.tut = null;
    for (let d = 0; d < 12 && !S.over; d++) {
      for (let i = 0; i < 2000 && !S.dayOver && !S.over; i++) {
        G.update(5000, false);
        if (i % 40 === 0) {
          const h = TO.Hints.next();
          assert.ok(h.title && typeof h.text === 'string');
          TO.Hints.text(h);
          S.alerts.forEach(a => TO.Hints.alert(a));
          Object.keys(G.PROJECTS).forEach(k => TO.Hints.project(k));
          S.tickets.filter(t => t.open).forEach(t => assert.strictEqual(typeof G.hint(t), 'string'));
          TO.Hints.lesson(S);
        }
      }
      if (S.over) break;
      assert.ok(S.dayOver);
      G.nextDay();
    }
  }
});

test('crisis days activate, change the rules, and pay out or punish', () => {
  const S = day1(); S.day = 5;
  S.crisis = { key: 'move', active: false, done: false, start: 545, end: 630, snap: null };
  assert.ok(S.links.some(L => L.a.startsWith('PP1:')));
  while (S.t < 550) G.update(700, false);
  assert.ok(S.crisis.active && !S.links.some(L => L.a.startsWith('PP1:') || L.b.startsWith('PP1:')), 'move pulls every patch cable');
  assert.strictEqual(S.crisis.slaMul, 0.5);
  while (S.t < 640) G.update(700, false);
  assert.ok(S.crisis.done && S.crisis.result === false, 'nobody re-patched, so it fails');
  const S2 = day1(); S2.day = 5;
  S2.crisis = { key: 'blackfriday', active: false, done: false, start: 600, end: 900, snap: null };
  while (S2.t < 905) G.update(700, false);
  assert.ok(S2.crisis.done);
});

test('Operation Blackout fires four attacks on day 10', () => {
  const S = day1(); S.day = 9; S.level = 6;
  for (let i = 0; i < 2000 && !S.dayOver; i++) G.update(5000, false);
  G.nextDay();
  assert.strictEqual(S.day, 10);
  assert.strictEqual(S.crisis.key, 'showdown');
  const types = [];
  G.hook('attackStart', a => types.push(a.type));
  for (let i = 0; i < 4000 && !S.dayOver; i++) G.update(2000, false);
  assert.ok(types.length >= 3, 'attacks launched: ' + types.join(','));
});

test('streaks, grades and achievements', () => {
  const S = day1();
  const rate = TO.DATA.MODES.normal.eventRate; TO.DATA.MODES.normal.eventRate = 0; // no random events: only the faults this test causes
  const grades = [];
  G.on((t, d) => { if (t === 'grade') grades.push(d); });
  for (let k = 1; k <= 3; k++) {
    console_('SW1')(['en', 'conf t', 'int fa0/' + k, 'shut', 'end']);
    for (let i = 0; i < 40; i++) G.update(700, false);
    console_('SW1')(['en', 'conf t', 'int fa0/' + k, 'no shut', 'end']);
  }
  assert.ok(S.stats.fixed >= 3, 'fixed ' + S.stats.fixed);
  assert.ok(grades.length >= 3 && grades.every(g => 'SABCD'.includes(g.grade)));
  assert.ok(S.streak >= 3 && S.bestStreak >= 3);
  assert.ok(S.ach.first_fix, 'first_fix achievement');
  TO.DATA.MODES.normal.eventRate = rate;
});

test('daily challenge: same seed, same office', () => {
  const run = () => {
    G.newGame('normal', { daily: '2026-01-01', seed: 12345 });
    const S = G.state();
    for (let i = 0; i < 160; i++) G.update(5000, false);
    return JSON.stringify({ t: S.tickets.map(t => t.text), c: S.chat.map(m => m.text), a: S.alerts.map(a => a.title), k: S.crisis && S.crisis.key, m: S.money });
  };
  const a = run(), b = run();
  assert.strictEqual(a, b);
  assert.ok(G.state().staff.length === 8 && G.state().day === 3);
  for (let i = 0; i < 3000 && !G.state().dayOver; i++) G.update(5000, false);
  const d = G.state().dayOver.daily;
  assert.ok(d && d.score >= 0 && 'SABCD'.includes(d.grade));
});

test('overtime: stay late for an hour, no new tickets, then go home', () => {
  const S = day1();
  for (let i = 0; i < 2000 && !S.dayOver; i++) G.update(5000, false);
  const money = S.money;
  assert.ok(G.stayLate());
  assert.strictEqual(S.money, money - 200);
  for (let i = 0; i < 3000 && !(S.dayOver && S.dayOver.late); i++) G.update(5000, false);
  assert.ok(S.dayOver && S.dayOver.late && S.t === 18 * 60);
  assert.strictEqual(G.stayLate(), false, 'only once');
  G.nextDay();
  assert.strictEqual(S.day, 2); assert.strictEqual(S.t, 540);
});

test('open work keeps its age across the overnight clock reset', () => {
  const S = day1();
  console_('SW1')(['en', 'conf t', 'int fa0/1', 'shut', 'end']);
  for (let i = 0; i < 2000 && !S.dayOver; i++) G.update(5000, false);
  const tk = S.tickets.find(t => t.open);
  assert.ok(tk);
  const age = S.t - tk.created;
  G.nextDay();
  assert.strictEqual(S.t - tk.created, age);
});

test('hints cost $50 once on hard, nothing otherwise, and the console hint command works', () => {
  day1('hard'); let S = G.state(); const m = S.money;
  assert.strictEqual(G.useHint('x'), 50); assert.strictEqual(G.useHint('x'), 0); assert.strictEqual(S.money, m - 50);
  day1('normal'); S = G.state(); const m2 = S.money;
  assert.strictEqual(G.useHint('y'), 0); assert.strictEqual(S.money, m2); assert.strictEqual(S.counters.hints, 1);
  const out = console_('R1')(['hint']);
  assert.ok(out.length > 10, 'hint command prints something');
});

console.log(`\n${passed} v2 tests passed`);
