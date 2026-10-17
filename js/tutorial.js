// Guided lessons. Each step has a goal, the exact commands (shown on Easy, one click away on Normal)
// and a check against the live simulation, so a step completes however the player solves it.
(function (TO) {
  'use strict';
  const N = TO.Net;
  const other = (S, p) => { const L = S.links.find(l => l.a === p || l.b === p); return L ? (L.a === p ? L.b : L.a) : null; };
  const toSwitch = (S, p) => { const o = other(S, p); return o && /^SW\d:/.test(o) ? o : null; };
  const short = k => (k ? k.split(':')[1] : '<port>');
  const swOf = k => (k ? k.split(':')[0] : 'SW1');
  const present = S => S.staff.filter(s => s.present);
  const saved = d => N.isSaved(d);
  const fin = S => present(S).filter(s => s.dept === 'Finance');
  const portCfg = (S, k) => S.devices[k.split(':')[0]].cfg.ifs[k.split(':')[1]];
  const apPort = S => toSwitch(S, 'PP1:17');

  const CHAPTERS = {
    basics: {
      title: 'Day one: get the office online',
      pause: true,
      steps: [
        { title: 'Welcome to Brightwater', text: "You're the new (and only) IT admin. Four people are sitting at desks with dead PCs. Your job: cable the network, configure the router with real Cisco IOS commands, and get everyone online. The clock is paused until you finish this lesson." },
        { title: 'Open the server room', text: 'Click the **Server room** tab at the top, or click the rack in the office.', check: S => S.ui.view === 'rack' },
        { title: 'Patch your first desk', text: "Every desk's wall socket ends on the **patch panel (PP1)**. Drag from PP1 port **1** (Amara's desk) to switch **SW1** port **Fa0/1**. Click a cable to unplug it.", check: S => !!toSwitch(S, 'PP1:1') },
        { title: 'Patch the rest', text: 'Patch PP1 ports **2, 3 and 4** (the other desks) and port **16** (the printer) to free SW1 ports. Then connect **SRV1** (the server) to SW1 too.', check: S => [2, 3, 4, 16].every(n => toSwitch(S, 'PP1:' + n)) && !!toSwitch(S, 'SRV1:eth0') },
        { title: 'Uplink to the router', text: 'The switch needs a path to the router. Connect **SW1 Gi0/1** to **R1 Gi0/1**. (R1 Gi0/0 already goes to the ISP.)', check: S => /^SW\d:/.test(other(S, 'R1:Gi0/1') || '') },
        { title: 'Open the console', text: 'Click **R1** in the rack (or the **Console** button at the bottom) to open its command line.', check: S => S.ui.consoleOpen && S.ui.consoleDev === 'R1' },
        { title: "Give R1's LAN port an address", text: "Router ports start **shut down** with no IP. Enter privileged mode, then configuration mode, and give **Gi0/1** the office gateway address 192.168.1.1/24. Tip: commands can be shortened (**conf t**, **int g0/1**, **no shut**) and **?** shows what you can type next.",
          cmds: ['enable', 'configure terminal', 'interface g0/1', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit'],
          check: (S, net) => net.l3.some(e => e.type === 'router' && e.dev === 'R1' && N.inNet('192.168.1.10', e.ip, e.mask)) },
        { title: 'Hand out addresses with DHCP', text: "PCs ask for an address when they connect. Make R1 a DHCP server. Exclude the first 49 addresses so they never clash with the server (.10) and printer (.15), and tell clients to use SRV1 (192.168.1.10) for DNS so they can find the file share.",
          cmds: ['ip dhcp excluded-address 192.168.1.1 192.168.1.49', 'ip dhcp pool STAFF', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1', 'dns-server 192.168.1.10', 'exit'],
          check: (S, net) => present(S).every(s => net.hosts[s.pc] && net.hosts[s.pc].src === 'dhcp') },
        { title: 'Turn on NAT', text: "PCs have private 192.168.x.x addresses that can't go on the internet. R1 already translates traffic leaving Gi0/0 (**ip nat outside**). Mark the LAN side as inside so NAT kicks in.",
          cmds: ['interface g0/1', 'ip nat inside', 'end'],
          check: (S, net) => present(S).every(s => net.needs[s.pc] && net.needs[s.pc].web) },
        { title: 'Check everything works', text: 'Websites, the S: drive and the printer should all work now. Each desk in the Office shows a green tick when its person is happy. If something is still broken, read the hint on the ticket or try **ping 192.168.1.10** from R1.', check: (S, net) => present(S).every(s => !net.fail[s.pc]) },
        { title: 'Save your work', text: 'Your changes live in the **running-config** and vanish if the power goes. Copy them to **startup-config**.', cmds: ['write memory'], check: S => saved(S.devices.R1) },
        { title: "You're live", text: 'The clock starts now. Tickets arrive on the right when things break. Use the speed buttons at the top to pause or fast-forward. Keep reputation up, keep the budget positive, earn XP to unlock new gear, and watch the **Security** tab: someone out there is watching you too.' },
      ],
    },
    vlans: {
      title: 'Lesson: VLANs and router-on-a-stick',
      steps: [
        { title: 'Why VLANs?', text: 'A VLAN splits one switch into separate networks. Finance will get VLAN 20 with its own subnet, and R1 will route between VLANs over a single trunk cable ("router-on-a-stick").' },
        { title: 'Create VLAN 20', text: 'Open the **SW1** console and create the VLAN.', cmds: ['enable', 'configure terminal', 'vlan 20', 'name FINANCE', 'exit'], check: S => Object.values(S.devices).some(d => d.kind === 'switch' && d.cfg.vlans[20]) },
        { title: 'Move Finance ports', text: "Put each Finance desk's switch port into VLAN 20. Their PCs will lose their address until the router side is ready. That's expected.",
          cmds: S => fin(S).flatMap(s => { const k = toSwitch(S, 'PP1:' + s.desk); return [`interface ${short(k)}`, 'switchport mode access', 'switchport access vlan 20']; }).concat(['exit']),
          check: S => fin(S).length > 0 && fin(S).every(s => { const k = toSwitch(S, 'PP1:' + s.desk); return k && portCfg(S, k).vlan === 20; }) },
        { title: 'Make the uplink a trunk', text: 'The cable to R1 now has to carry both VLANs, tagged with 802.1Q.', cmds: S => [`interface ${short(other(S, 'R1:Gi0/1'))}`, 'switchport mode trunk', 'end'],
          check: S => { const k = other(S, 'R1:Gi0/1'); return !!k && /^SW/.test(k) && portCfg(S, k).mode === 'trunk'; } },
        { title: 'Add a subinterface on R1', text: 'On **R1**, create Gi0/1.20 for VLAN 20 traffic and give it the Finance gateway address. Untagged traffic (VLAN 1) keeps using Gi0/1.',
          cmds: ['configure terminal', 'interface g0/1.20', 'encapsulation dot1Q 20', 'ip address 192.168.20.1 255.255.255.0', 'ip nat inside', 'exit'],
          check: S => Object.entries(S.devices.R1.cfg.ifs).some(([n, c]) => n.includes('.') && c.encap === 20 && c.ip && c.natIn) },
        { title: 'A DHCP pool for Finance', text: 'R1 picks the pool whose network matches the interface the request arrived on.',
          cmds: ['ip dhcp excluded-address 192.168.20.1 192.168.20.9', 'ip dhcp pool FINANCE', 'network 192.168.20.0 255.255.255.0', 'default-router 192.168.20.1', 'dns-server 192.168.1.10', 'end'],
          check: (S, net) => fin(S).every(s => net.hosts[s.pc] && net.hosts[s.pc].src === 'dhcp' && !N.inNet(net.hosts[s.pc].ip, '192.168.1.0', '255.255.255.0')) && present(S).every(s => !net.fail[s.pc]) },
        { title: 'Save both devices', text: 'Run **write memory** on the switch and on R1.', cmds: ['write memory'], check: S => Object.values(S.devices).filter(d => d.kind === 'switch' || d.kind === 'router').every(saved) },
      ],
    },
    wifi: {
      title: 'Lesson: secure guest Wi-Fi',
      steps: [
        { title: 'Cable the access point', text: 'AP1 is mounted on the ceiling and wired to patch panel port **17**. Patch PP1 port 17 to a free switch port.', check: S => !!apPort(S) },
        { title: 'Add a guest SSID', text: 'Office tab → click the **AP** on the ceiling. Keep the staff SSID untagged and add a **Guest** SSID tagged with **VLAN 30**, marked as guest.', check: S => S.devices.AP1 && S.devices.AP1.cfg.ssids.some(s => s.guest && s.vlan) },
        { title: 'Trunk the AP port and the uplink', text: 'The AP sends two networks down one cable, so its switch port must be a trunk and VLAN 30 must exist. The uplink to R1 must be a trunk too, or VLAN 30 never reaches the router.',
          cmds: S => ['enable', 'configure terminal', 'vlan 30', 'name GUEST', 'exit', `interface ${short(apPort(S))}`, 'switchport mode trunk', `interface ${short(other(S, 'R1:Gi0/1'))}`, 'switchport mode trunk', 'end'],
          check: S => { const k = apPort(S), up = other(S, 'R1:Gi0/1'); return !!k && portCfg(S, k).mode === 'trunk' && !!S.devices[swOf(k)].cfg.vlans[30] && !!up && /^SW/.test(up) && portCfg(S, up).mode === 'trunk'; } },
        { title: 'Route and serve the guest VLAN', text: 'Give guests a gateway and addresses on R1. They can use public DNS.',
          cmds: ['configure terminal', 'interface g0/1.30', 'encapsulation dot1Q 30', 'ip address 192.168.30.1 255.255.255.0', 'ip nat inside', 'exit', 'ip dhcp pool GUEST', 'network 192.168.30.0 255.255.255.0', 'default-router 192.168.30.1', 'dns-server 8.8.8.8', 'exit'],
          check: (S, net) => Object.values(net.hosts).some(h => h.kind === 'guest' && net.needs[h.id].web) },
        { title: 'Keep guests out of the office', text: 'Right now guests can reach SRV1. An extended ACL on the guest subinterface blocks guest traffic to any private 192.168 address and allows the rest.',
          cmds: ['access-list 130 deny ip 192.168.30.0 0.0.0.255 192.168.0.0 0.0.255.255', 'access-list 130 permit ip any any', 'interface g0/1.30', 'ip access-group 130 in', 'end'],
          check: () => TO.Game.PROJECTS.wifi.cond() },
        { title: 'Save', text: 'Save the switch and R1.', cmds: ['write memory'], check: S => Object.values(S.devices).filter(d => d.kind === 'switch' || d.kind === 'router').every(saved) },
      ],
    },
    security: {
      title: 'Lesson: incident response',
      steps: [
        { title: 'You are under attack', text: 'Something just happened. Open the **Security** tab to read the alert.', check: S => S.ui.view === 'security' },
        { title: 'Contain', text: "Stop the bleeding first. For an infected PC, cut it off: shut its switch port (**interface fa0/x**, **shutdown**) or unplug its patch cable. Use **show interfaces status**, port descriptions or **show mac address-table** to find the right port. For a stolen account, reset the password in the **People** tab." },
        { title: 'Eradicate and recover', text: 'Clean up: reimage the PC or remove the rogue device from the desk (Office tab → click the desk), then bring its port back with **no shutdown**.' },
        { title: 'Prevent the next one', text: 'Attackers exploit what you leave open. Port security stops rogue devices, VLANs + ACLs stop malware spreading to the server, backups beat ransomware, and MFA beats stolen passwords. Check the Shop.' },
      ],
    },
  };

  function start(S, key) {
    if (S.mode === 'hard' || !CHAPTERS[key] || S.tutDone.includes(key)) return;
    if (S.tut && S.tut.ch === key) return;
    if (S.tut) { if (!S.tutQueue.includes(key)) S.tutQueue.push(key); return; }
    S.tut = { ch: key, i: 0 };
  }
  function finish(S) {
    if (!S.tut) return;
    S.tutDone.push(S.tut.ch);
    S.tut = null;
    const nxt = S.tutQueue.shift();
    if (nxt) start(S, nxt);
  }
  function current(S) { return S.tut ? CHAPTERS[S.tut.ch].steps[S.tut.i] : null; }
  function advance(S) { S.tut.i++; if (S.tut.i >= CHAPTERS[S.tut.ch].steps.length) finish(S); }
  function check(S, net) {
    let guard = 0;
    for (let st = current(S); st && st.check && guard++ < 20; st = current(S)) {
      if (!st.check(S, net)) break;
      advance(S);
    }
  }
  function cmds(S) { const st = current(S); if (!st || !st.cmds) return []; return typeof st.cmds === 'function' ? st.cmds(S) : st.cmds; }
  const blocksClock = S => !!(S.tut && CHAPTERS[S.tut.ch].pause);

  TO.Tutorial = { CHAPTERS, start, finish, current, next: S => { if (S.tut && !current(S).check) advance(S); }, check, cmds, blocksClock };
})(globalThis.TO = globalThis.TO || {});
