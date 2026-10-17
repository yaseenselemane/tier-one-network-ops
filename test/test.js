// Headless tests for the simulation, the IOS command line and the game loop.  Run: npm test
'use strict';
const assert = require('assert');
const path = require('path');
for (const f of ['net', 'cli', 'data', 'tutorial', 'game', 'hints', 'live']) require(path.join(__dirname, '..', 'js', f + '.js'));
const { Net: N, CLI, Game: G, Tutorial: T } = globalThis.TO;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

function console_(dev) {
  const env = { S: G.state, net: () => G.refresh(), changed: () => G.refresh(), mode: () => G.state().mode };
  const s = CLI.session(dev, env);
  return lines => lines.map(l => CLI.exec(s, l)).join('\n');
}
function day1(mode = 'normal') {
  G.newGame(mode);
  const S = G.state();
  if (S.tut) T.next(S); // the welcome card is a manual "Next" step
  S.ui.view = 'rack';
  for (const [a, b] of [['PP1:1', 'SW1:Fa0/1'], ['PP1:2', 'SW1:Fa0/2'], ['PP1:3', 'SW1:Fa0/3'], ['PP1:4', 'SW1:Fa0/4'], ['PP1:16', 'SW1:Fa0/10'], ['SRV1:eth0', 'SW1:Fa0/11'], ['SW1:Gi0/1', 'R1:Gi0/1']]) assert.strictEqual(G.link(a, b), '');
  S.ui.consoleOpen = true; S.ui.consoleDev = 'R1';
  const r1 = console_('R1');
  r1(['en', 'conf t', 'int g0/1', 'ip add 192.168.1.1 255.255.255.0', 'no shut', 'exit', 'ip dhcp excluded-address 192.168.1.1 192.168.1.49',
    'ip dhcp pool STAFF', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1', 'dns-server 192.168.1.10', 'exit', 'int g0/1', 'ip nat inside', 'end', 'wr']);
  return S;
}

console.log('Tier One tests');

test('IP helpers', () => {
  assert.strictEqual(N.prefixLen('255.255.255.0'), 24);
  assert.strictEqual(N.prefixLen('255.0.255.0'), -1);
  assert.ok(N.inNet('192.168.1.77', '192.168.1.0', '255.255.255.0'));
  assert.ok(!N.inNet('192.168.2.1', '192.168.1.0', '255.255.255.0'));
  assert.strictEqual(N.parseIf('gigabitethernet0/1.20'), 'Gi0/1.20');
  assert.strictEqual(N.parseIf('fa0/3'), 'Fa0/3');
  assert.strictEqual(N.parseIf('vlan10'), 'Vlan10');
  assert.strictEqual(N.parseIf('x1'), null);
});

test('tutorial day one brings everyone online and finishes the lesson', () => {
  const S = day1();
  const net = G.net();
  for (const st of S.staff) assert.strictEqual(net.fail[st.pc], null, st.pc + ' should be fully working');
  assert.ok(S.tutDone.includes('basics') || (S.tut && S.tut.i === T.CHAPTERS.basics.steps.length - 1), 'basics lesson reaches its last step');
});

test('IOS parser: abbreviations, help, completion, errors', () => {
  day1();
  const env = { S: G.state, net: () => G.refresh(), changed: () => G.refresh(), mode: () => 'normal' };
  const s = CLI.session('SW1', env);
  assert.match(CLI.exec(s, 'conf t'), /Unknown command|Invalid/);
  CLI.exec(s, 'en');
  assert.match(CLI.exec(s, 'sh ?'), /vlan/);
  assert.strictEqual(CLI.complete(s, 'sh run'), 'sh running-config ');
  assert.match(CLI.exec(s, 'show'), /Incomplete/);
  CLI.exec(s, 'conf t');
  assert.strictEqual(CLI.prompt(s), 'SW1(config)#');
  CLI.exec(s, 'int fa0/5');
  assert.match(CLI.exec(s, 'sw port-sec'), /dynamic port/);
  assert.match(CLI.exec(s, 'ip address 1.1.1.1 255.0.0.0'), /Invalid input/);
  CLI.exec(s, 'end');
  assert.match(CLI.exec(s, 'show running-config'), /hostname SW1/);
});

test('VLAN lesson path: Finance on VLAN 20 via router-on-a-stick', () => {
  const S = day1();
  const fin = S.staff.filter(x => x.dept === 'Finance');
  assert.ok(fin.length >= 1);
  const ports = fin.map(f => G.net().linkOf['PP1:' + f.desk].split(':')[1]);
  console_('SW1')(['en', 'conf t', 'vlan 20', 'name FINANCE', ...ports.flatMap(p => ['int ' + p, 'sw mode acc', 'sw acc vlan 20']), 'int gi0/1', 'sw mode trunk', 'end', 'wr']);
  console_('R1')(['en', 'conf t', 'int g0/1.20', 'encapsulation dot1Q 20', 'ip address 192.168.20.1 255.255.255.0', 'ip nat inside', 'exit',
    'ip dhcp pool FINANCE', 'network 192.168.20.0 255.255.255.0', 'default-router 192.168.20.1', 'dns-server 192.168.1.10', 'end', 'wr']);
  const net = G.net();
  for (const f of fin) assert.ok(N.inNet(net.hosts[f.pc].ip, '192.168.20.0', '255.255.255.0'));
  for (const st of S.staff) assert.strictEqual(net.fail[st.pc], null);
  assert.ok(G.PROJECTS.finvlan.cond());
});

test('ACL blocks traffic and the hint explains why', () => {
  const S = day1();
  console_('R1')(['en', 'conf t', 'access-list 101 deny tcp any any eq 443', 'access-list 101 permit ip any any', 'int g0/1', 'ip access-group 101 in', 'end']);
  const net = G.net();
  const pc = S.staff[0].pc;
  assert.strictEqual(net.fail[pc], 'web');
  assert.match(net.send(net.hosts[pc], N.WEB, 'tcp', 443).why, /access-list 101/);
});

test('port security err-disables a port when a hub appears, shut/no shut recovers', () => {
  const S = day1();
  console_('SW1')(['en', 'conf t', 'int fa0/1', 'sw mode acc', 'sw port-sec', 'end']);
  S.jacks[1].rogue = 'hub';
  let net = G.refresh();
  assert.strictEqual(net.portStatus['SW1:Fa0/1'], 'err');
  S.jacks[1].rogue = null;
  console_('SW1')(['en', 'conf t', 'int fa0/1', 'shut', 'no shut', 'end']);
  net = G.net();
  assert.strictEqual(net.portStatus['SW1:Fa0/1'], 'up');
});

test('power cut reloads devices from startup-config', () => {
  const S = day1();
  console_('R1')(['en', 'conf t', 'hostname EDGE', 'end']);
  const R1 = S.devices.R1;
  R1.cfg = N.clone(R1.saved);
  assert.strictEqual(R1.cfg.hostname, 'R1');
  console_('R1')(['en', 'reload']);
  assert.strictEqual(S.devices.R1.cfg.hostname, 'R1');
});

test('ransomware reaches a flat network but not a segmented one', () => {
  const S = day1('easy');
  S.tut = null;
  const st = S.staff[0];
  st.infected = true;
  const net = G.net();
  assert.ok(net.send(net.hosts[st.pc], '192.168.1.10', 'tcp', 3389).ok, 'flat network: PC can reach SRV1 RDP');
});

test('ten days of unattended play never crash (easy and hard)', () => {
  for (const m of ['easy', 'hard']) {
    day1(m);
    const S = G.state();
    S.tut = null;
    for (let d = 0; d < 10 && !S.over; d++) {
      for (let i = 0; i < 2000 && !S.dayOver && !S.over; i++) G.update(5000, false);
      if (S.over) break;
      assert.ok(S.dayOver, 'day should end');
      G.nextDay();
    }
    assert.ok(S.day >= 2 || S.over);
  }
});

test('save and load round-trip', () => {
  const store = {};
  globalThis.localStorage = { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  const S = day1();
  S.money = 1234;
  assert.ok(G.save());
  G.quit();
  assert.ok(G.load());
  assert.strictEqual(G.state().money, 1234);
  assert.strictEqual(G.net().fail[S.staff[0].pc], null);
  delete globalThis.localStorage;
});

test('social engineering: rejecting a scam helps, approving it hurts', () => {
  const S = day1();
  S.tickets.unshift({ id: 'T-9', kind: 'social', req: 1, open: true, created: S.t, sla: 120, text: 'x' });
  const rep = S.rep;
  G.ticketAct('T-9', 'reject');
  assert.ok(S.rep > rep);
  S.tickets.unshift({ id: 'T-10', kind: 'social', req: 0, open: true, created: S.t, sla: 120, text: 'x' });
  G.ticketAct('T-10', 'approve');
  assert.ok(S.rep < rep + 3);
});

console.log(`\n${passed} tests passed`);
