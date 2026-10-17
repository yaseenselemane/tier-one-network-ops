// Hint engine: reads the live game and says what to do next, with the exact commands.
// Every task type has a hint: tickets (in game.js), projects, alerts, crises, lessons, and "what now?".
(function (TO) {
  'use strict';
  const N = TO.Net, G = TO.Game, DATA = TO.DATA;
  const S = () => G.state(), NT = () => G.net();
  const present = () => S().staff.filter(s => s.present);
  const deskPort = d => { const o = NT().linkOf['PP1:' + d]; return o && /^SW\d:/.test(o) ? o : null; };
  const pcfg = k => S().devices[k.split(':')[0]].cfg.ifs[k.split(':')[1]];
  const dev = k => k.split(':')[0];
  const ifn = k => 'interface ' + k.split(':')[1].toLowerCase();
  const cisco = () => Object.values(S().devices).filter(d => d.kind === 'switch' || d.kind === 'router');
  const subnet = h => (h && h.ip && h.src !== 'apipa' ? N.n2ip((N.ip2n(h.ip) & N.ip2n(h.mask)) >>> 0) : null);
  const step = (ok, text, o = {}) => Object.assign({ ok, text }, o);

  // contiguous Fa ports -> "fa0/5-9"
  function ranges(ports) {
    const nums = ports.filter(p => p.startsWith('Fa0/')).map(p => +p.split('/')[1]).sort((a, b) => a - b), out = [];
    for (let i = 0; i < nums.length; i++) { let j = i; while (nums[j + 1] === nums[j] + 1) j++; out.push(j > i ? `fa0/${nums[i]}-${nums[j]}` : `fa0/${nums[i]}`); i = j; }
    return out.concat(ports.filter(p => !p.startsWith('Fa0/')).map(p => p.toLowerCase().replace('gi0/', 'g0/')));
  }

  // ---------- projects ----------
  const PROJECT = {
    portsec() {
      const miss = [], unp = [];
      for (const s of present()) { const k = deskPort(s.desk); if (!k) unp.push(s); else if (!pcfg(k).ps) miss.push(k); }
      const out = [];
      if (unp.length) out.push(step(false, `Patch these desks to a switch first: ${unp.map(s => 'desk ' + s.desk).join(', ')}.`));
      const by = {};
      miss.forEach(k => (by[dev(k)] = by[dev(k)] || []).push(k));
      for (const [d, ks] of Object.entries(by)) out.push(step(false, `On ${d}, turn on port security for ${ks.length} desk port${ks.length > 1 ? 's' : ''}: ${ks.map(k => k.split(':')[1]).join(', ')}.`, { dev: d, cmds: ['enable', 'configure terminal', ...ks.slice(0, 3).flatMap(k => [ifn(k), 'switchport mode access', 'switchport port-security']), ...(ks.length > 3 ? ['(repeat for the other ports)'] : []), 'end'] }));
      if (!out.length) out.push(step(true, 'Every desk port has port security. Save with "write memory".'));
      return out;
    },
    save() {
      const un = cisco().filter(d => !N.isSaved(d));
      return un.length ? un.map(d => step(false, `${d.id} has unsaved changes.`, { dev: d.id, cmds: ['enable', 'write memory'] })) : [step(true, 'Everything is saved.')];
    },
    finvlan() {
      const D = S().devices, fin = present().filter(s => s.dept === 'Finance'), ports = fin.map(s => deskPort(s.desk)).filter(Boolean);
      if (!fin.length) return [step(true, 'No Finance staff right now.')];
      if (ports.length < fin.length) return [step(false, `Patch the Finance desks (${fin.map(s => s.desk).join(', ')}) to a switch first.`)];
      const sw = dev(ports[0]);
      const out = [step(Object.values(D).some(d => d.kind === 'switch' && d.cfg.vlans[20]), `Create VLAN 20 on ${sw}.`, { dev: sw, cmds: ['enable', 'configure terminal', 'vlan 20', 'name FINANCE', 'exit'] })];
      const bad = ports.filter(k => !(pcfg(k).vlan === 20 && pcfg(k).mode !== 'trunk'));
      out.push(step(!bad.length, `Put each Finance desk port in VLAN 20${bad.length ? ': ' + bad.map(k => k.split(':')[1]).join(', ') : ''}.`, { dev: bad.length ? dev(bad[0]) : sw, cmds: ['configure terminal', ...bad.flatMap(k => [ifn(k), 'switchport mode access', 'switchport access vlan 20']), 'exit'] }));
      const up = NT().linkOf['R1:Gi0/1'];
      out.push(step(!!up && /^SW/.test(up) && pcfg(up).mode === 'trunk', 'Turn the cable that goes to R1 into a trunk so VLAN 20 can travel.', { dev: up ? dev(up) : sw, cmds: ['configure terminal', up ? ifn(up) : 'interface <uplink port>', 'switchport mode trunk', 'end'] }));
      const r = D.R1.cfg, sub = Object.entries(r.ifs).find(([n, c]) => n.includes('.') && c.encap === 20 && c.ip);
      out.push(step(!!sub && !!sub[1].natIn, 'Give R1 a subinterface for VLAN 20 with the gateway address.', { dev: 'R1', cmds: ['enable', 'configure terminal', 'interface g0/1.20', 'encapsulation dot1Q 20', 'ip address 192.168.20.1 255.255.255.0', 'ip nat inside', 'exit'] }));
      out.push(step(!!sub && Object.values(r.pools).some(p => p.network && N.inNet(sub[1].ip, p.network, p.mask)), 'Add a DHCP pool for the new subnet (and a default router and DNS server).', { dev: 'R1', cmds: ['ip dhcp excluded-address 192.168.20.1 192.168.20.9', 'ip dhcp pool FINANCE', 'network 192.168.20.0 255.255.255.0', 'default-router 192.168.20.1', 'dns-server 192.168.1.10', 'end'] }));
      out.push(step(null, 'When everyone is back online the project completes. Then "write memory" on the switch and R1.'));
      return out;
    },
    unused() {
      const out = [];
      for (const d of Object.values(S().devices).filter(x => x.kind === 'switch')) {
        const free = d.ports.filter(p => !G.portLinked(d.id + ':' + p) && !d.cfg.ifs[p].shut);
        if (free.length) out.push(step(false, `${d.id}: ${free.length} unused port${free.length > 1 ? 's are' : ' is'} open.`, { dev: d.id, cmds: ['enable', 'configure terminal', ...ranges(free).map(r => (r.includes('-') ? 'interface range ' + r : 'interface ' + r)).flatMap(c => [c, 'shutdown']), 'end'] }));
      }
      return out.length ? out : [step(true, 'Every unused port is shut down.')];
    },
    wifi() {
      const D = S().devices, ap = D.AP1, net = NT();
      if (!ap) return [step(false, 'Buy the Wi-Fi access point in the Shop (needs level 3).')];
      const gs = ap.cfg.ssids.find(s => s.guest), gv = (gs && gs.vlan) || 30, sw = NT().linkOf['PP1:17'];
      const out = [step(!!sw && /^SW/.test(sw), 'Patch PP1 port 17 (AP) to a free switch port.')];
      out.push(step(!!(gs && gs.vlan), 'Click the AP on the office ceiling. Add a Guest SSID with VLAN 30 and tick "Guest network".'));
      const swd = sw && /^SW/.test(sw) ? dev(sw) : 'SW1';
      const up = NT().linkOf['R1:Gi0/1'], upOk = !!up && /^SW/.test(up) && pcfg(up).mode === 'trunk';
      out.push(step(!!sw && pcfg(sw) && pcfg(sw).mode === 'trunk' && !!D[swd].cfg.vlans[gv] && upOk, `Create VLAN ${gv}, make the AP's switch port a trunk, and make the uplink to R1 a trunk so the VLAN can reach the router. (If the AP is on a second switch, trunk the link between the switches and create the VLAN on both.)`, { dev: swd, cmds: ['enable', 'configure terminal', `vlan ${gv}`, `name GUEST`, 'exit', sw ? ifn(sw) : 'interface <AP port>', 'switchport mode trunk', up && /^SW/.test(up) && dev(up) === swd ? ifn(up) : 'interface <uplink port to R1>', 'switchport mode trunk', 'end'] }));
      const sub = Object.entries(D.R1.cfg.ifs).find(([n, c]) => n.includes('.') && c.encap === gv && c.ip);
      out.push(step(!!sub, `Give R1 a subinterface and DHCP pool for guests (VLAN ${gv}).`, { dev: 'R1', cmds: ['enable', 'configure terminal', `interface g0/1.${gv}`, `encapsulation dot1Q ${gv}`, `ip address 192.168.${gv}.1 255.255.255.0`, 'ip nat inside', 'exit', 'ip dhcp pool GUEST', `network 192.168.${gv}.0 255.255.255.0`, `default-router 192.168.${gv}.1`, 'dns-server 8.8.8.8', 'exit'] }));
      const guests = Object.values(net.hosts).filter(h => h.kind === 'guest');
      const web = guests.length > 0 && guests.every(g => net.needs[g.id].web);
      out.push(step(web, 'Guests should reach the internet. Check "show ip dhcp binding" and NAT (ip nat inside) on the subinterface.'));
      const srv = net.hosts.SRV1, leak = srv && guests.some(g => net.send(g, srv.ip, 'tcp', 445).ok);
      out.push(step(web && !leak, 'Block guests from the office networks with an ACL on the guest subinterface.', { dev: 'R1', cmds: ['configure terminal', `access-list 130 deny ip 192.168.${gv}.0 0.0.0.255 192.168.0.0 0.0.255.255`, 'access-list 130 permit ip any any', `interface g0/1.${gv}`, 'ip access-group 130 in', 'end'] }));
      return out;
    },
    desc() {
      const out = [];
      for (const d of Object.values(S().devices).filter(x => x.kind === 'switch')) {
        const miss = d.ports.filter(p => G.portLinked(d.id + ':' + p) && !d.cfg.ifs[p].desc);
        if (miss.length) {
          const cmds = ['enable', 'configure terminal'];
          for (const p of miss.slice(0, 4)) {
            const k = d.id + ':' + p, s = present().find(x => deskPort(x.desk) === k);
            cmds.push(ifn(k), 'description ' + (s ? `Desk ${s.desk} - ${s.name.split(' ')[0]}` : NT().linkOf[k] ? 'Link to ' + NT().linkOf[k].replace(':', ' ') : 'Device'));
          }
          if (miss.length > 4) cmds.push('(repeat for the other ports)');
          out.push(step(false, `${d.id}: ${miss.length} connected port${miss.length > 1 ? 's have' : ' has'} no description.`, { dev: d.id, cmds: cmds.concat('end') }));
        }
      }
      return out.length ? out : [step(true, 'Every connected port is labelled.')];
    },
    backup() {
      const D = S().devices, net = NT();
      if (!D.NAS1) return [step(false, 'Buy the Backup NAS in the Shop (needs level 4).')];
      const srv = net.hosts.SRV1, nas = net.hosts.NAS1;
      const out = [step(!!G.portLinked('NAS1:eth0'), 'Server room: drag NAS1 eth0 to a free switch port.')];
      const nip = D.NAS1.net.ip;
      out.push(step(N.isIp(nip), 'Click NAS1 and set an IP in the same subnet as SRV1 (e.g. 192.168.1.20 / 255.255.255.0, gateway 192.168.1.1).'));
      const ok = S().backupOk;
      out.push(step(ok, ok ? 'Backups are reaching SRV1.' : 'NAS1 must reach SRV1 on TCP 445. ' + (nas && srv && nas.ip ? net.send(nas, srv.ip, 'tcp', 445).why + '.' : 'Check the cable and IP.')));
      return out;
    },
    srvacl() {
      const D = S().devices, net = NT(), srv = net.hosts.SRV1;
      if (!srv) return [step(false, 'SRV1 must be cabled first.')];
      const staff = present().map(s => net.hosts[s.pc]).filter(Boolean);
      const moved = staff.every(h => subnet(h) !== subnet(srv));
      const sw = NT().linkOf['SRV1:eth0'];
      const swd = sw && /^SW/.test(sw) ? dev(sw) : 'SW1';
      const out = [step(moved, 'Give SRV1 its own VLAN and subnet. Switch side first:', { dev: swd, cmds: ['enable', 'configure terminal', 'vlan 99', 'name SERVERS', sw ? ifn(sw) : 'interface <SRV1 port>', 'switchport mode access', 'switchport access vlan 99', 'exit', 'interface <uplink port to R1>', 'switchport mode trunk', 'end'] })];
      out.push(step(moved, 'Router side: a gateway for VLAN 99.', { dev: 'R1', cmds: ['enable', 'configure terminal', 'interface g0/1.99', 'encapsulation dot1Q 99', 'ip address 192.168.99.1 255.255.255.0', 'ip nat inside', 'exit'] }));
      out.push(step(moved, 'Click SRV1 and change its IP to 192.168.99.10 / 255.255.255.0 gateway 192.168.99.1. Then point every DHCP pool at the new DNS: "dns-server 192.168.99.10" in each pool.', { dev: 'R1', cmds: ['configure terminal', 'ip dhcp pool STAFF', 'dns-server 192.168.99.10', 'exit'] }));
      const rdp = staff.length > 0 && staff.some(h => net.send(h, srv.ip, 'tcp', 3389).ok);
      out.push(step(moved && !rdp, 'Stop staff PCs reaching remote desktop (TCP 3389) on SRV1, but keep files (445) and DNS (53). Apply the ACL to every staff interface:', { dev: 'R1', cmds: ['configure terminal', `access-list 120 permit tcp any host ${srv.ip} eq 445`, `access-list 120 permit udp any host ${srv.ip} eq 53`, `access-list 120 deny ip any host ${srv.ip}`, 'access-list 120 permit ip any any', 'interface g0/1', 'ip access-group 120 in', '(repeat "ip access-group 120 in" on any VLAN subinterface staff use)', 'end'] }));
      out.push(step(null, 'Everyone must stay online, so check the Tickets tab. Then "write memory".'));
      return out;
    },
  };

  // ---------- alerts ----------
  function alertHint(a) {
    const s = S(), net = NT(), t = a.title, out = [];
    const stf = a.pc && s.staff.find(x => x.pc === a.pc);
    if (/beaconing|EDR: malware/.test(t) && stf) {
      const k = deskPort(stf.desk);
      if (s.owned.edr) out.push(step(null, 'Press "Isolate" on the alert. EDR cuts the PC off instantly.'));
      else if (k) out.push(step(false, `Contain it: shut ${a.pc}'s switch port (${k.replace(':', ' ')}), or unplug its patch cable in the Server room.`, { dev: dev(k), cmds: ['enable', 'configure terminal', ifn(k), 'shutdown', 'end'] }));
      out.push(step(null, `Clean up: Office, click desk ${stf.desk}, then "Reimage PC" (30 min).`));
      if (!s.owned.edr && k) out.push(step(null, 'Recover: after the reimage, bring the port back.', { dev: dev(k), cmds: ['configure terminal', ifn(k), 'no shutdown', 'end'] }));
      out.push(step(null, 'Prevent next time: finish Protect the server so malware cannot reach SRV1.'));
    } else if (/Account takeover/.test(t)) out.push(step(null, 'People tab: press "Reset password" for that user right now. You have about an hour.'), step(null, 'Prevent next time: buy MFA in the Shop.'));
    else if (/Unknown device|Port security violation/.test(t)) {
      const m = /desk (\d+)/.exec(a.text), d = m ? +m[1] : null, k = d && deskPort(d);
      out.push(step(null, d ? `Office: click desk ${d} and press "Remove device" (5 min).` : 'Find the desk with the extra device and remove it.'));
      if (k) out.push(step(null, `If ${k.replace(':', ' ')} went err-disabled, reset it after removing the device.`, { dev: dev(k), cmds: ['enable', 'configure terminal', ifn(k), 'shutdown', 'no shutdown', 'end'] }));
      out.push(step(null, 'Prevent next time: port security on every desk port (see the Lock down desk ports project).'));
    } else if (/Guest device probing|guest/i.test(t)) {
      const ap = s.devices.AP1, gs = ap && ap.cfg.ssids.find(x => x.guest), gv = (gs && gs.vlan) || 30;
      out.push(step(null, 'Block guests from reaching office addresses with an ACL on the guest subinterface.', { dev: 'R1', cmds: ['enable', 'configure terminal', `access-list 130 deny ip 192.168.${gv}.0 0.0.0.255 192.168.0.0 0.0.255.255`, 'access-list 130 permit ip any any', `interface g0/1.${gv}`, 'ip access-group 130 in', 'end'] }));
      out.push(step(null, 'Quick emergency option: unplug the AP\'s cable in the Server room.'));
    } else if (/RANSOMWARE/.test(t)) out.push(step(null, s.backupLast ? 'Server room: click SRV1 and press "Restore from backup" (60 min).' : 'There is no backup. Server room: click SRV1 and press "Rebuild" ($2,500, 3 hours).'), step(null, 'Also find and reimage the infected PC, or it will do it again.'), step(null, 'Prevent next time: buy a Backup NAS and complete Protect the server.'));
    else if (/Hardware fault/.test(t)) {
      const m = /on (SW\d) (\S+)/.exec(a.title), swd = m ? m[1] : 'SW1', old = m ? m[2] : '';
      const free = s.devices[swd] && s.devices[swd].ports.find(p => p.startsWith('Fa') && !G.portLinked(swd + ':' + p) && !s.devices[swd].cfg.ifs[p].shut);
      out.push(step(null, `Server room: unplug the cable from the dead port and plug it into a spare port${free ? ' such as ' + free : ''}.`), step(null, 'Copy the dead port\'s settings (VLAN and port security) onto the spare port.', { dev: swd, cmds: ['enable', 'configure terminal', free ? 'interface ' + free.toLowerCase() : 'interface <spare port>', 'switchport mode access', old ? `(match the VLAN/port-security of ${old})` : '', 'end'].filter(Boolean) }));
    } else if (/file service stopped/.test(t)) out.push(step(null, 'Server room: click SRV1 and press "Start" next to the file share.'));
    else if (/disk full/.test(t)) out.push(step(null, 'Server room: click SRV1 and press "Clean up".'));
    else if (/ISP outage/.test(t)) out.push(step(null, 'Nothing to fix on your side. The ISP restores service in 20 to 40 minutes. Tickets close themselves afterwards.'));
    else if (/Password spray/.test(t)) out.push(step(null, 'Watch for the follow-up "Account takeover" alert, then reset that password in the People tab.'), step(null, 'Buy MFA in the Shop to stop this for good.'));
    else if (/Data leaking|Invoice fraud|stolen|Breach|Social engineering succeeded/i.test(t)) out.push(step(null, 'This already happened. Check the other alerts and the Projects tab for what would have stopped it.'));
    else if (/Overnight power/.test(t)) out.push(step(null, 'Reconfigure what was lost, then "write memory". A UPS in the Shop prevents this.'));
    else out.push(step(null, 'Read the alert, then follow the playbook on the Security tab: contain, clean up, recover, prevent.'));
    return out;
  }

  // ---------- lessons ----------
  const LESSON = {
    basics: [
      'Just press Next.',
      'Click the "Server room" tab in the top bar.',
      'In the Server room, press on PP1 port 1 (labelled Amara), drag to SW1 port Fa0/1 (the first port in the SW1 row) and let go.',
      'Same drag again: PP1 2 to Fa0/2, 3 to Fa0/3, 4 to Fa0/4, PP1 16 (PRN) to Fa0/10, and SRV1 eth0 (right of the SRV1 row) to Fa0/11.',
      'Drag SW1 port G1 (right end of the SW1 row) to R1 Gi0/1 (the middle port of the R1 row).',
      'Click the name "R1" in the rack, or the Console button at the right of the tab bar.',
      'Click each command in the lesson card to paste it, then press Enter. Start with "enable".',
      'Run the commands in order. The prompt shows where you are: (config)# for global, (dhcp-config)# inside a pool.',
      'You must be in "interface g0/1" before "ip nat inside". Then "end".',
      'Open the Tickets tab and press Hint on any ticket to see exactly what is wrong.',
      'Type "end" first if the prompt shows (config), then "write memory".',
      'Press Next to start the day.',
    ],
    vlans: [
      'Press Next.',
      'On the switch console (SW1 tab): enable, configure terminal, vlan 20, name FINANCE.',
      'Look at the People tab for the Finance desks, then find their switch ports with "show interfaces status" or the rack view.',
      'The uplink is the SW1 port that connects to R1. Make it a trunk with "switchport mode trunk".',
      'On R1: "interface g0/1.20" then "encapsulation dot1Q 20" BEFORE the ip address.',
      'The pool needs network, default-router and dns-server. Check with "show ip dhcp pool".',
      'Run "write memory" on SW1, then open the R1 console and run it again.',
    ],
    wifi: [
      'The AP is wired to patch panel port 17. Drag PP1 17 to a free switch port.',
      'Click the access point on the office ceiling to edit its SSIDs.',
      'On the switch: create vlan 30 and make the AP port "switchport mode trunk".',
      'On R1 the subinterface is g0/1.30 with encapsulation dot1Q 30, then a DHCP pool for 192.168.30.0.',
      'The ACL goes on the guest subinterface: "ip access-group 130 in".',
      'Run "write memory" on both devices.',
    ],
    security: [
      'Click the Security tab. The newest alert is at the top of the Alerts list.',
      'Contain first: shut the port or reset the password, whatever the alert says. Press Hint on the alert for exact commands.',
      'Reimage the PC or remove the rogue device from the desk (click the desk in the Office tab).',
      'Open the Shop and Projects tab to see what would have stopped this.',
    ],
  };
  function lesson(Sx) {
    if (!Sx || !Sx.tut) return null;
    const list = LESSON[Sx.tut.ch];
    return list && list[Sx.tut.i] ? list[Sx.tut.i] : null;
  }

  // ---------- crises ----------
  function crisis() {
    const c = S().crisis;
    if (!c) return null;
    return { title: DATA.CRISES[c.key].title, text: DATA.CRISES[c.key].hint };
  }

  // ---------- "what now?" ----------
  function next() {
    const s = S(), net = NT();
    const L = lesson(s);
    if (L) return { title: 'Current lesson', text: L, view: null };
    const open = s.tickets.filter(t => t.open);
    const crit = s.alerts.find(a => !a.resolved && (a.sev === 'crit' || a.sev === 'high') && s.t - a.t < 120 && s.day === a.day);
    const att = s.attacks.find(a => !a.over && a.detected);
    if (att && crit) return { title: 'Security incident: ' + crit.title, text: crit.text, steps: alertHint(crit), view: 'security' };
    if (s.crisis && s.crisis.active) { const c = crisis(); return { title: c.title + ' in progress', text: c.text, view: null }; }
    const late = open.filter(t => t.breached || s.t - t.created > t.sla * 0.6).sort((a, b) => a.created - b.created)[0];
    const t = late || open.slice().sort((a, b) => (a.created + a.sla) - (b.created + b.sla))[0];
    if (t) return { title: `Ticket ${t.id}: ${t.kind === 'net' ? DATA.NEED_LABEL[t.need] : t.kind === 'acct' ? 'account' : 'request'}`, text: G.hint(t), view: 'office', ticket: t.id };
    if (crit) return { title: 'Alert: ' + crit.title, text: crit.text, steps: alertHint(crit), view: 'security' };
    if (s.projects.length) { const p = s.projects[0], P = G.PROJECTS[p.key]; return { title: 'Project: ' + P.title, text: P.desc, steps: PROJECT[p.key] ? PROJECT[p.key]() : [], view: 'office' }; }
    const buy = DATA.SHOP.find(i => s.level >= i.level && !G.owns(i.key) && s.money >= i.price);
    if (buy) return { title: 'Spend your budget', text: `You can afford ${buy.name} ($${buy.price}). ${buy.desc}`, view: 'shop' };
    if (cisco().some(d => !N.isSaved(d))) return { title: 'Save your work', text: 'Some devices have unsaved changes. Run "write memory" on each one.', steps: PROJECT.save() };
    const open2 = Object.values(s.devices).filter(d => d.kind === 'switch').some(d => d.ports.some(p => !G.portLinked(d.id + ':' + p) && !d.cfg.ifs[p].shut));
    if (open2) return { title: 'Tidy up', text: 'Unused switch ports are open. Shut them down.', steps: PROJECT.unused() };
    return { title: 'All quiet', text: 'Nothing urgent right now. Good moment to check the Security tab, make sure every device is saved, and spend your budget in the Shop.', view: null };
  }
  function text(h) {
    const out = [h.title, h.text];
    for (const st of h.steps || []) { out.push(`${st.ok === true ? '[x]' : st.ok === false ? '[ ]' : ' - '} ${st.text}${st.dev ? ` (on ${st.dev})` : ''}`); (st.cmds || []).forEach(c => out.push('      ' + c)); }
    return out.join('\n');
  }

  TO.Hints = { project: key => (PROJECT[key] ? PROJECT[key]() : []), alert: alertHint, lesson, crisis, next, text };
})(globalThis.TO = globalThis.TO || {});
