// Cisco IOS-style command line: modes, abbreviations, "?" help, Tab completion.
// Commands edit the structured device config; "show running-config" is generated from it.
(function (TO) {
  'use strict';
  const N = TO.Net;

  const PARAM = {
    '<ip>': t => (N.isIp(t) ? t : null),
    '<mask>': t => (N.prefixLen(t) >= 0 ? t : null),
    '<n>': t => (/^\d+$/.test(t) && +t > 0 && +t < 100000 ? +t : null),
    '<vlan>': t => (/^\d+$/.test(t) && +t >= 1 && +t <= 4094 ? +t : null),
    '<acl>': t => (/^\d+$/.test(t) && +t >= 1 && +t <= 199 ? +t : null),
    '<if>': t => N.parseIf(t),
    '<ifrange>': t => (/^[a-z]+\d+\/\d+-\d+$/i.test(t) ? t : null),
    '<word>': t => t,
    '<vlist>': t => (/^\d+(?:[-,]\d+)*$/.test(t) ? t : null),
  };
  const PLACE = {
    '<ip>': 'A.B.C.D', '<mask>': 'A.B.C.D (subnet mask)', '<n>': '<1-99999>', '<vlan>': '<1-4094>  VLAN ID', '<acl>': '<1-199>  access list number',
    '<if>': 'interface, e.g. Fa0/1  Gi0/1  Gi0/1.10  Vlan1', '<ifrange>': 'range, e.g. fa0/1-8', '<word>': 'WORD', '<vlist>': 'VLAN IDs, e.g. 10,20 or 10-30', '<line>': 'LINE',
  };
  const HELP = {
    enable: 'Turn on privileged commands', disable: 'Turn off privileged commands', exit: 'Exit from the current mode', end: 'Exit to privileged mode',
    configure: 'Enter configuration mode', terminal: 'Configure from the terminal', show: 'Show running system information', ping: 'Send echo messages',
    write: 'Write running configuration to memory', memory: 'Write to NV memory', copy: 'Copy from one file to another', 'running-config': 'Current operating configuration',
    'startup-config': 'Contents of startup configuration', reload: 'Halt and perform a cold restart', hostname: 'Set system\'s network name',
    interface: 'Select an interface to configure', range: 'Configure a range of interfaces', vlan: 'VLAN commands', no: 'Negate a command or set its defaults',
    ip: 'Global IP configuration subcommands', address: 'Set the IP address of an interface', shutdown: 'Shutdown the selected interface',
    description: 'Interface specific description', switchport: 'Set switching mode characteristics', mode: 'Set trunking mode of the interface',
    access: 'Set access mode characteristics / Set trunking mode to ACCESS unconditionally', trunk: 'Set trunking characteristics / Set trunking mode to TRUNK unconditionally',
    allowed: 'Set allowed VLAN characteristics', native: 'Set trunking native characteristics', add: 'add VLANs to the current list', remove: 'remove VLANs from the current list',
    all: 'all VLANs', 'port-security': 'Security related command', maximum: 'Max secure addresses', violation: 'Security violation mode',
    shutdown_: '', 'spanning-tree': 'Spanning Tree Subsystem', portfast: 'Portfast for access ports', encapsulation: 'Set encapsulation type for an interface',
    dot1q: 'IEEE 802.1Q Virtual LAN', nat: 'NAT configuration commands', inside: 'Inside interface for address translation', outside: 'Outside interface for address translation',
    'access-group': 'Specify access control for packets', in: 'inbound packets', out: 'outbound packets', dhcp: 'Configure DHCP server and relay parameters',
    pool: 'Configure DHCP address pools', 'excluded-address': 'Prevent DHCP from assigning certain addresses', network: 'Network number and mask',
    'default-router': 'Default routers', 'dns-server': 'DNS servers', name: 'Ascii name of the VLAN', route: 'Establish static routes',
    'default-gateway': 'Specify default gateway (if not routing IP)', 'access-list': 'Add an access list entry', source: 'Source address translation',
    list: 'Specify access list describing local addresses', overload: 'Overload an address translation', brief: 'Brief summary of IP status and configuration',
    status: 'Show interface line status', 'mac address-table': '', 'mac-address-table': '', 'address-table': 'MAC forwarding table', mac: 'MAC configuration',
    route_: '', binding: 'DHCP address bindings', 'access-lists': 'List access lists', translations: 'Translation entries', version: 'System hardware and software status',
    interfaces: 'Interface status and configuration', do: 'To run exec commands in config mode', permit: 'Specify packets to forward', deny: 'Specify packets to reject',
    protect: 'Security violation protect mode', restrict: 'Security violation restrict mode', nonegotiate: 'Device will not engage in negotiation protocol on this interface',
    lease: 'Address lease time', history: 'Display the session command history', hint: 'Show a hint about what to do next', clear: 'Reset functions', logout: 'Exit from the EXEC',
  };

  const SPECS = [];
  // modes: user priv config if vlan dhcp. kinds: r/s = router/switch outside interface mode; R/S/V = router if, switch port, switch SVI.
  const def = (modes, kinds, pattern, run, hint) => SPECS.push({ modes: modes.split(' '), kinds, toks: pattern.split(' '), run, hint });

  const dev = s => s.env.S().devices[s.devId];
  const changed = s => s.env.changed();
  const kindOf = (s, mode) => {
    const d = dev(s);
    if ((mode || s.mode) === 'if') return d.kind === 'router' ? 'R' : s.ifs[0].startsWith('Vlan') ? 'V' : 'S';
    return d.kind === 'router' ? 'r' : 's';
  };
  const eachIf = (s, fn) => { const d = dev(s); const out = []; for (const n of s.ifs) { const r = fn(d.cfg.ifs[n], n, d); if (r) out.push(r); } return out.join('\n'); };
  const linkMsg = (s, n, up) => `%LINK-5-CHANGED: Interface ${N.longIf(n)}, changed state to ${up}`;

  function session(devId, env) { return { devId, env, mode: 'user', ifs: [], vlan: null, pool: null, history: [] }; }
  function prompt(s) {
    const h = dev(s).cfg.hostname;
    const ifp = s.ifs.length > 1 ? '(config-if-range)#' : s.ifs[0] && s.ifs[0].includes('.') ? '(config-subif)#' : '(config-if)#';
    return h + { user: '>', priv: '#', config: '(config)#', if: ifp, vlan: '(config-vlan)#', dhcp: '(dhcp-config)#' }[s.mode];
  }

  // ---------- matching engine ----------
  function walk(s, specs, toks) {
    let cands = specs.map(sp => ({ sp, args: [], done: false }));
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i], tl = t.toLowerCase(), next = [];
      for (const c of cands) {
        if (c.done) { next.push(c); continue; }
        const p = c.sp.toks[i];
        if (p === undefined) continue;
        if (p === '<line>') { next.push({ ...c, args: [...c.args, toks.slice(i).join(' ')], done: true }); continue; }
        if (p[0] === '<') { const v = PARAM[p](t, s); if (v !== null && v !== undefined) next.push({ ...c, args: [...c.args, v], lit: null }); continue; }
        const alts = p.split('|');
        const ex = alts.find(a => a === tl);
        const hits = ex ? [ex] : alts.filter(a => a.startsWith(tl));
        for (const h of hits) next.push({ ...c, args: alts.length > 1 ? [...c.args, h] : c.args, lit: h });
      }
      const words = new Set(next.filter(c => c.lit).map(c => c.lit));
      let keep = next;
      if (words.has(tl)) keep = next.filter(c => !c.lit || c.lit === tl);
      else if (words.size > 1) return { err: 'ambiguous', at: i };
      if (!keep.length) return { err: 'invalid', at: i };
      cands = keep.map(c => ({ ...c, lit: null }));
    }
    return { cands };
  }
  const specsFor = (s, mode) => { const k = kindOf(s, mode); return SPECS.filter(sp => sp.modes.includes(mode || s.mode) && (sp.kinds === '*' || sp.kinds.includes(k))); };
  const tokenize = line => (line.trim() ? line.trim().split(/\s+/) : []);
  function caret(line, at) {
    const toks = tokenize(line);
    let pos = line.length - line.trimStart().length;
    for (let i = 0; i < at && i < toks.length; i++) pos = line.indexOf(toks[i], pos) + toks[i].length;
    if (at < toks.length) pos = line.indexOf(toks[at], pos);
    return ' '.repeat(pos + prompt.len) + '^\n% Invalid input detected at \'^\' marker.';
  }

  function run(s, line, mode) {
    const toks = tokenize(line);
    if (!toks.length) return '';
    let w = walk(s, specsFor(s, mode), toks);
    // Like IOS, sub-modes fall back to global config commands (e.g. "interface fa0/2" from config-vlan).
    if (w.err && !mode && ['if', 'vlan', 'dhcp'].includes(s.mode)) {
      const g = walk(s, specsFor(s, 'config'), toks);
      if (!g.err && g.cands.some(c => c.done || c.sp.toks.length === toks.length)) { s.mode = 'config'; s.ifs = []; w = g; }
    }
    if (w.err === 'ambiguous') return `% Ambiguous command:  "${line.trim()}"`;
    if (w.err) return s.mode === 'user' && w.at === 0 && toks.length === 1 ? `Translating "${toks[0]}"...domain server (255.255.255.255)\n% Unknown command or computer name, or unable to find computer address` : caret(line, w.at);
    const done = w.cands.filter(c => c.done || c.sp.toks.length === toks.length);
    if (!done.length) return '% Incomplete command.';
    return done[0].sp.run(s, done[0].args) || '';
  }

  function exec(s, line) {
    prompt.len = prompt(s).length;
    s.history.push(line);
    if (/\?\s*$/.test(line)) return help(s, line.replace(/\?\s*$/, ''));
    return run(s, line);
  }

  function help(s, line) {
    const partial = line !== '' && !/\s$/.test(line);
    const toks = tokenize(line);
    const known = partial ? toks.slice(0, -1) : toks;
    const w = walk(s, specsFor(s), known);
    if (w.err) return w.err === 'ambiguous' ? `% Ambiguous command:  "${line.trim()}"` : '% Unrecognized command';
    const pos = known.length, last = partial ? toks[toks.length - 1].toLowerCase() : '';
    const items = new Map();
    for (const c of w.cands) {
      if (c.done) continue;
      const p = c.sp.toks[pos];
      if (p === undefined) { if (!partial) items.set('<cr>', ''); continue; }
      if (p[0] === '<') { if (!partial) items.set(p === '<line>' && c.sp.hint ? c.sp.hint : PLACE[p], ''); continue; }
      for (const a of p.split('|')) if (a.startsWith(last)) items.set(a, HELP[a] || '');
    }
    if (!items.size) return '% Unrecognized command';
    if (partial) return [...items.keys()].join('  ');
    const width = Math.max(...[...items.keys()].map(k => k.length)) + 3;
    return [...items].sort((a, b) => (a[0] === '<cr>') - (b[0] === '<cr>') || a[0].localeCompare(b[0])).map(([k, v]) => '  ' + k.padEnd(width) + v).join('\n');
  }

  function complete(s, line) {
    if (/\s$/.test(line) || !line.trim()) return line;
    const toks = tokenize(line), last = toks[toks.length - 1].toLowerCase();
    const w = walk(s, specsFor(s), toks.slice(0, -1));
    if (w.err) return line;
    const opts = new Set();
    for (const c of w.cands) {
      const p = !c.done && c.sp.toks[toks.length - 1];
      if (p && p[0] !== '<') for (const a of p.split('|')) if (a.startsWith(last)) opts.add(a);
    }
    if (opts.size !== 1) return line;
    return line.slice(0, line.length - toks[toks.length - 1].length) + [...opts][0] + ' ';
  }

  // ---------- show commands ----------
  const pad = (v, n) => String(v).padEnd(n);
  const ifSort = (a, b) => a.localeCompare(b, 'en', { numeric: true });

  function ifState(s, d, n) {
    const net = s.env.net();
    const c = d.cfg.ifs[n];
    if (n.startsWith('Vlan')) {
      if (c.shut) return ['administratively down', 'down'];
      const v = +n.slice(4);
      const anyUp = d.cfg.vlans[v] && d.ports.some(p => net.portStatus[d.id + ':' + p] === 'up' && (d.cfg.ifs[p].mode === 'trunk' || d.cfg.ifs[p].vlan === v));
      return anyUp ? ['up', 'up'] : ['up', 'down'];
    }
    const phys = n.split('.')[0];
    if (c.shut || d.cfg.ifs[phys].shut) return ['administratively down', 'down'];
    const st = net.portStatus[d.id + ':' + phys];
    return st === 'up' ? ['up', 'up'] : st === 'err' ? ['down', 'down (err-disabled)'] : ['down', 'down'];
  }

  function showIpBrief(s) {
    const d = dev(s);
    const rows = ['Interface              IP-Address      OK? Method Status                Protocol'];
    const names = Object.keys(d.cfg.ifs).sort(ifSort);
    for (const n of names) {
      const c = d.cfg.ifs[n], [st, pr] = ifState(s, d, n);
      rows.push(pad(N.longIf(n), 23) + pad(c.ip || 'unassigned', 16) + 'YES ' + pad(c.ip ? 'manual' : 'unset', 7) + pad(st, 22) + pr);
    }
    return rows.join('\n');
  }
  function showIntStatus(s) {
    const d = dev(s), net = s.env.net();
    const rows = ['Port      Name               Status       Vlan       Duplex  Speed Type'];
    for (const p of d.ports) {
      const c = d.cfg.ifs[p], st = net.portStatus[d.id + ':' + p];
      const status = c.shut ? 'disabled' : st === 'up' ? 'connected' : st === 'err' ? 'err-disabled' : 'notconnect';
      rows.push(pad(p, 10) + pad((c.desc || '').slice(0, 18), 19) + pad(status, 13) + pad(c.mode === 'trunk' ? 'trunk' : c.vlan, 11) + pad(st === 'up' ? 'a-full' : 'auto', 8) + pad(st === 'up' ? (p.startsWith('Gi') ? 'a-1000' : 'a-100') : 'auto', 7) + (p.startsWith('Gi') ? '10/100/1000BaseTX' : '10/100BaseTX'));
    }
    return rows.join('\n');
  }
  function showVlan(s) {
    const d = dev(s);
    const rows = ['', 'VLAN Name                             Status    Ports', '---- -------------------------------- --------- -------------------------------'];
    for (const v of Object.keys(d.cfg.vlans).map(Number).sort((a, b) => a - b)) {
      const ports = d.ports.filter(p => d.cfg.ifs[p].mode !== 'trunk' && d.cfg.ifs[p].vlan === v);
      const chunks = [];
      for (let i = 0; i < ports.length; i += 4) chunks.push(ports.slice(i, i + 4).join(', '));
      rows.push(pad(v, 5) + pad(d.cfg.vlans[v], 33) + pad('active', 10) + (chunks[0] || ''));
      for (const ch of chunks.slice(1)) rows.push(' '.repeat(48) + ch);
    }
    for (const p of d.ports) if (d.cfg.ifs[p].mode !== 'trunk' && !d.cfg.vlans[d.cfg.ifs[p].vlan]) rows.push(`% ${p} is assigned to VLAN ${d.cfg.ifs[p].vlan}, which does not exist (port inactive)`);
    return rows.join('\n');
  }
  function showMac(s) {
    const d = dev(s), net = s.env.net();
    const list = (net.macs[d.id] || []).slice().sort((a, b) => a.vlan - b.vlan || ifSort(a.port, b.port));
    const rows = ['          Mac Address Table', '-------------------------------------------', '', 'Vlan    Mac Address       Type        Ports', '----    -----------       --------    -----'];
    for (const m of list) rows.push(pad(String(m.vlan).padStart(4), 8) + pad(m.mac, 18) + pad('DYNAMIC', 12) + m.port);
    rows.push(`Total Mac Addresses for this criterion: ${list.length}`);
    return rows.join('\n');
  }
  function showPortSec(s) {
    const d = dev(s), net = s.env.net();
    const rows = ['Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action', '                (Count)       (Count)          (Count)', '---------------------------------------------------------------------------'];
    for (const p of d.ports) {
      const c = d.cfg.ifs[p];
      if (!c.ps) continue;
      const cur = (net.macs[d.id] || []).filter(m => m.port === p).length;
      const viol = net.portStatus[d.id + ':' + p] === 'err' ? 1 : 0;
      rows.push(pad(p.padStart(11), 13) + pad(String(c.ps.max || 1).padStart(13), 15) + pad(String(Math.min(cur, c.ps.max || 1)).padStart(11), 13) + pad(String(viol).padStart(17), 19) + (c.ps.violation || 'shutdown').replace(/^./, x => x.toUpperCase()));
    }
    return rows.join('\n');
  }
  function showRoute(s) {
    const d = dev(s), net = s.env.net();
    const rows = ['Codes: L - local, C - connected, S - static, * - candidate default', ''];
    const def = d.cfg.routes.find(r => r.net === '0.0.0.0' && r.mask === '0.0.0.0');
    rows.push(def ? `Gateway of last resort is ${def.nh} to network 0.0.0.0` : 'Gateway of last resort is not set', '');
    const conns = net.l3.filter(e => e.type === 'router' && e.dev === d.id).sort((a, b) => N.ip2n(a.ip) - N.ip2n(b.ip));
    const entries = [];
    for (const r of d.cfg.routes) entries.push([N.ip2n(r.net), `S${r.net === '0.0.0.0' && r.mask === '0.0.0.0' ? '*' : ' '}    ${r.net}/${N.prefixLen(r.mask)} [1/0] via ${r.nh}`]);
    for (const e of conns) {
      const netA = N.n2ip((N.ip2n(e.ip) & N.ip2n(e.mask)) >>> 0);
      entries.push([N.ip2n(netA), `C        ${netA}/${N.prefixLen(e.mask)} is directly connected, ${N.longIf(e.ifn)}`]);
      entries.push([N.ip2n(e.ip) + 0.5, `L        ${e.ip}/32 is directly connected, ${N.longIf(e.ifn)}`]);
    }
    entries.sort((a, b) => a[0] - b[0]).forEach(e => rows.push(e[1]));
    return rows.join('\n');
  }
  const addrStr = a => (a.any ? 'any' : a.wc === '0.0.0.0' ? 'host ' + a.ip : a.ip + ' ' + a.wc);
  const PORTN = { 80: 'www', 53: 'domain', 25: 'smtp', 21: 'ftp', 23: 'telnet', 22: '22' };
  function aceStr(r) {
    if (r.remark) return 'remark ' + r.remark;
    if (r.std) return `${r.action} ${r.src.any ? 'any' : r.src.wc === '0.0.0.0' ? r.src.ip : r.src.ip + ', wildcard bits ' + r.src.wc}`;
    return `${r.action} ${r.proto} ${addrStr(r.src)} ${addrStr(r.dst)}${r.port ? ' eq ' + (PORTN[r.port] || r.port) : ''}`;
  }
  function showAcl(s) {
    const d = dev(s);
    if (!d.cfg.acls) return '';
    const rows = [];
    for (const n of Object.keys(d.cfg.acls).map(Number).sort((a, b) => a - b)) {
      rows.push(`${n < 100 ? 'Standard' : 'Extended'} IP access list ${n}`);
      d.cfg.acls[n].forEach((r, i) => rows.push(`    ${(i + 1) * 10} ${aceStr(r)}`));
    }
    return rows.join('\n');
  }
  function showDhcpBinding(s) {
    const d = dev(s), net = s.env.net();
    const rows = ['Bindings from all pools not associated with VRF:', 'IP address          Hardware address        Lease expiration        Type'];
    for (const l of net.leases.filter(x => x.dev === d.id)) rows.push(pad(l.ip, 20) + pad('01' + l.mac.replace(/\./g, '').replace(/(..)(?=.)/g, '$1.'), 24).slice(0, 24) + pad('Infinite', 24) + 'Automatic');
    return rows.join('\n');
  }
  function showDhcpPool(s) {
    const d = dev(s), net = s.env.net();
    const rows = [];
    for (const [name, p] of Object.entries(d.cfg.pools)) {
      const sz = N.poolSize(d.cfg, p), u = net.pools[d.id + '|' + name];
      rows.push(`Pool ${name} :`, ` Total addresses                : ${sz.total}`, ` Leased addresses               : ${u ? u.used : 0}`, ` Excluded addresses             : ${sz.excluded}`,
        ` Network                        : ${p.network ? p.network + ' ' + p.mask : '(none - add "network")'}`, ` Default router                 : ${p.router || '(none)'}`, ` DNS server                     : ${p.dns || '(none)'}`);
      if (u && u.full) rows.push(' %DHCPD-4-POOL_EXHAUSTED: no free addresses left in this pool');
      rows.push('');
    }
    return rows.join('\n') || '% No DHCP pools configured';
  }
  function showNat(s) {
    const d = dev(s), net = s.env.net();
    const wan = d.cfg.nat && d.cfg.ifs[d.cfg.nat.iface] && d.cfg.ifs[d.cfg.nat.iface].ip;
    const rows = ['Pro Inside global         Inside local          Outside local         Outside global'];
    let port = 1024;
    for (const h of Object.values(net.hosts)) if (wan && net.needs[h.id] && net.needs[h.id].web) {
      const p = 50000 + (N.ip2n(h.ip) % 9000);
      rows.push(`tcp ${pad(wan + ':' + port++, 22)}${pad(h.ip + ':' + p, 22)}${pad(N.WEB + ':443', 22)}${N.WEB}:443`);
    }
    return rows.join('\n');
  }
  function showRun(s, which) {
    const d = dev(s);
    const c = which === 'startup' ? d.saved : d.cfg;
    if (!c) return 'startup-config is not present';
    const L = which === 'startup' ? ['Using 1683 out of 262136 bytes', '!'] : ['Building configuration...', '', 'Current configuration : 1683 bytes', '!'];
    L.push('version 15.2', 'service timestamps log datetime msec', '!', `hostname ${c.hostname}`, '!');
    if (d.kind === 'router') {
      for (const [a, b] of c.excluded) L.push(`ip dhcp excluded-address ${a}${b && b !== a ? ' ' + b : ''}`);
      if (c.excluded.length) L.push('!');
      for (const [n, p] of Object.entries(c.pools)) {
        L.push(`ip dhcp pool ${n}`);
        if (p.network) L.push(` network ${p.network} ${p.mask}`);
        if (p.router) L.push(` default-router ${p.router}`);
        if (p.dns) L.push(` dns-server ${p.dns}`);
        L.push('!');
      }
    } else {
      for (const v of Object.keys(c.vlans).map(Number).sort((a, b) => a - b)) if (v !== 1) L.push(`vlan ${v}`, ` name ${c.vlans[v]}`, '!');
    }
    for (const n of Object.keys(c.ifs).sort(ifSort)) {
      const i = c.ifs[n];
      L.push(`interface ${N.longIf(n)}`);
      if (i.desc) L.push(` description ${i.desc}`);
      if (d.kind === 'switch' && !n.startsWith('Vlan')) {
        if (i.mode === 'trunk') {
          if ((i.native || 1) !== 1) L.push(` switchport trunk native vlan ${i.native}`);
          if (i.allowed) L.push(` switchport trunk allowed vlan ${compactList(i.allowed)}`);
          L.push(' switchport mode trunk');
        } else {
          if (i.vlan !== 1) L.push(` switchport access vlan ${i.vlan}`);
          if (i.mode === 'access') L.push(' switchport mode access');
        }
        if (i.ps) {
          if ((i.ps.max || 1) !== 1) L.push(` switchport port-security maximum ${i.ps.max}`);
          if (i.ps.violation && i.ps.violation !== 'shutdown') L.push(` switchport port-security violation ${i.ps.violation}`);
          L.push(' switchport port-security');
        }
        if (i.portfast) L.push(' spanning-tree portfast');
      } else {
        if (i.encap) L.push(` encapsulation dot1Q ${i.encap}`);
        L.push(i.ip ? ` ip address ${i.ip} ${i.mask}` : ' no ip address');
        if (i.aclIn) L.push(` ip access-group ${i.aclIn} in`);
        if (i.aclOut) L.push(` ip access-group ${i.aclOut} out`);
        if (i.natIn) L.push(' ip nat inside');
        if (i.natOut) L.push(' ip nat outside');
      }
      if (i.shut) L.push(' shutdown');
      L.push('!');
    }
    if (d.kind === 'router') {
      if (c.nat) L.push(`ip nat inside source list ${c.nat.list} interface ${N.longIf(c.nat.iface)} overload`);
      for (const r of c.routes) L.push(`ip route ${r.net} ${r.mask} ${r.nh}`);
      L.push('!');
      for (const n of Object.keys(c.acls).map(Number).sort((a, b) => a - b)) for (const r of c.acls[n]) L.push(`access-list ${n} ${aceStr(r).replace(', wildcard bits', '')}`);
    } else if (c.gw) L.push(`ip default-gateway ${c.gw}`);
    L.push('!', 'line con 0', 'line vty 0 4', ' login', '!', 'end');
    return L.join('\n');
  }
  function compactList(arr) {
    const a = [...arr].sort((x, y) => x - y), out = [];
    for (let i = 0; i < a.length; i++) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(j > i + 1 ? `${a[i]}-${a[j]}` : j === i + 1 ? `${a[i]},${a[j]}` : `${a[i]}`); i = j; }
    return out.join(',');
  }
  function expandList(str) {
    const out = new Set();
    for (const part of str.split(',')) {
      const [a, b] = part.split('-').map(Number);
      for (let v = a; v <= (b || a); v++) if (v >= 1 && v <= 4094) out.add(v);
    }
    return [...out].sort((x, y) => x - y);
  }

  function ping(s, ip) {
    const r = s.env.net().sendFrom(s.devId, ip);
    const head = `Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:\n`;
    if (r.ok) return head + '!!!!!\nSuccess rate is 100 percent (5/5), round-trip min/avg/max = 1/1/4 ms';
    return head + '.....\nSuccess rate is 0 percent (0/5)' + (s.env.mode() === 'easy' ? `\n[hint] ${r.why}` : '');
  }

  function save(s) { const d = dev(s); d.saved = N.clone(d.cfg); changed(s); return 'Building configuration...\n[OK]'; }

  // ---------- EXEC ----------
  def('user', '*', 'enable', s => { s.mode = 'priv'; });
  def('user priv', '*', 'exit', s => { s.mode = 'user'; return '\nPress RETURN to get started.'; });
  def('user priv', '*', 'logout', s => { s.mode = 'user'; return '\nPress RETURN to get started.'; });
  def('priv', '*', 'disable', s => { s.mode = 'user'; });
  def('user priv', '*', 'ping <ip>', (s, [ip]) => ping(s, ip));
  def('user priv', '*', 'show version', s => {
    const d = dev(s);
    return `Tier One IOS-style Software, Version 15.2(sim), RELEASE SOFTWARE\n\n${d.cfg.hostname} uptime is ${s.env.S().day} days\nSystem image file is "flash:tierone-15.2.bin"\n\nmodel: ${d.model}\n${d.ports.length} network interfaces\n\nConfiguration register is 0x2102`;
  });
  def('user priv', '*', 'show ip interface brief', showIpBrief);
  def('user priv config if vlan dhcp', '*', 'hint', s => s.env.hint ? s.env.hint() : '');
  def('user priv', '*', 'show history', s => s.history.slice(-20).map(h => '  ' + h).join('\n'));
  def('priv', '*', 'configure terminal', s => { s.mode = 'config'; return 'Enter configuration commands, one per line.  End with CNTL/Z.'; });
  def('priv', '*', 'show running-config', s => showRun(s, 'running'));
  def('priv', '*', 'show startup-config', s => showRun(s, 'startup'));
  def('priv', '*', 'show access-lists', showAcl);
  def('priv', 's', 'show interfaces status', showIntStatus);
  def('priv', 's', 'show vlan brief', showVlan);
  def('priv', 's', 'show vlan', showVlan);
  def('priv', 's', 'show mac address-table', showMac);
  def('priv', 's', 'show port-security', showPortSec);
  def('priv', 'r', 'show ip route', showRoute);
  def('priv', 'r', 'show ip dhcp binding', showDhcpBinding);
  def('priv', 'r', 'show ip dhcp pool', showDhcpPool);
  def('priv', 'r', 'show ip nat translations', showNat);
  def('priv', '*', 'write memory', save);
  def('priv', '*', 'write', save);
  def('priv', '*', 'copy running-config startup-config', s => 'Destination filename [startup-config]?\n' + save(s));
  def('priv', '*', 'reload', s => {
    const d = dev(s);
    const lost = JSON.stringify(d.cfg) !== JSON.stringify(d.saved || N.defaultCfg(d));
    d.cfg = d.saved ? N.clone(d.saved) : N.defaultCfg(d);
    const S = s.env.S();
    S.errdis = S.errdis.filter(k => !k.startsWith(d.id + ':'));
    s.mode = 'user'; changed(s);
    return `Proceed with reload? [confirm]\n\n%SYS-5-RELOAD: Reload requested\n...\nSystem restarted.${lost ? '\n\n*** Unsaved changes were lost. Use "write memory" before reloading. ***' : ''}\n\nPress RETURN to get started.`;
  });
  def('config if vlan dhcp', '*', 'do <line>', (s, [line]) => run(s, line, 'priv'));

  // ---------- global config ----------
  def('config if vlan dhcp', '*', 'end', s => { s.mode = 'priv'; s.ifs = []; });
  def('config', '*', 'exit', s => { s.mode = 'priv'; });
  def('if vlan dhcp', '*', 'exit', s => { s.mode = 'config'; s.ifs = []; });
  def('config', '*', 'hostname <word>', (s, [h]) => { dev(s).cfg.hostname = h; changed(s); });

  function enterIf(s, name) {
    const d = dev(s);
    if (d.kind === 'router') {
      const phys = name.split('.')[0];
      if (name.startsWith('Vlan') || !d.ports.includes(phys)) return `% Invalid interface: ${name} does not exist on ${d.cfg.hostname}`;
      if (name.includes('.') && !d.cfg.ifs[name]) { d.cfg.ifs[name] = { shut: false }; changed(s); }
    } else {
      if (name.includes('.')) return '% Subinterfaces are only supported on routers';
      if (name.startsWith('Vlan')) { if (!d.cfg.ifs[name]) { d.cfg.ifs[name] = { shut: true }; changed(s); } }
      else if (!d.ports.includes(name)) return `% Invalid interface: ${name} does not exist on ${d.cfg.hostname}`;
    }
    s.mode = 'if'; s.ifs = [name];
    return '';
  }
  def('config if', '*', 'interface <if>', (s, [n]) => enterIf(s, n));
  def('config if', 'sSV', 'interface vlan <vlan>', (s, [v]) => enterIf(s, 'Vlan' + v));
  function enterRange(s, first, last) {
    const d = dev(s);
    const m = /^(.*\/)(\d+)$/.exec(first || '');
    if (!m || last < +m[2]) return '% Invalid range';
    const names = [];
    for (let i = +m[2]; i <= last; i++) { const n = m[1] + i; if (!d.ports.includes(n)) return `% Invalid interface ${n}`; names.push(n); }
    s.mode = 'if'; s.ifs = names;
    return '';
  }
  def('config if', '*', 'interface range <if> - <n>', (s, [a, b]) => enterRange(s, a, b));
  def('config if', '*', 'interface range <ifrange>', (s, [r]) => { const m = /^(.*)-(\d+)$/.exec(r); return enterRange(s, N.parseIf(m[1]), +m[2]); });

  def('config', 's', 'vlan <vlan>', (s, [v]) => { const d = dev(s); if (!d.cfg.vlans[v]) d.cfg.vlans[v] = 'VLAN' + String(v).padStart(4, '0'); s.mode = 'vlan'; s.vlan = v; changed(s); });
  def('config', 's', 'no vlan <vlan>', (s, [v]) => { if (v === 1) return '%Default VLAN 1 may not be deleted.'; delete dev(s).cfg.vlans[v]; changed(s); });
  def('vlan', 's', 'name <word>', (s, [n]) => { dev(s).cfg.vlans[s.vlan] = n.slice(0, 32); changed(s); });
  def('config', 's', 'ip default-gateway <ip>', (s, [ip]) => { dev(s).cfg.gw = ip; changed(s); });
  def('config', 's', 'no ip default-gateway', s => { dev(s).cfg.gw = null; changed(s); });

  def('config', 'r', 'ip dhcp excluded-address <ip>', (s, [a]) => { dev(s).cfg.excluded.push([a, a]); changed(s); });
  def('config', 'r', 'ip dhcp excluded-address <ip> <ip>', (s, [a, b]) => {
    if (N.ip2n(b) < N.ip2n(a)) return '% Invalid range: end address is lower than start address';
    dev(s).cfg.excluded.push([a, b]); changed(s);
  });
  def('config', 'r', 'no ip dhcp excluded-address <ip>', (s, [a]) => { const c = dev(s).cfg; c.excluded = c.excluded.filter(x => x[0] !== a); changed(s); });
  def('config', 'r', 'no ip dhcp excluded-address <ip> <ip>', (s, [a, b]) => { const c = dev(s).cfg; c.excluded = c.excluded.filter(x => !(x[0] === a && x[1] === b)); changed(s); });
  def('config', 'r', 'ip dhcp pool <word>', (s, [n]) => { const c = dev(s).cfg; if (!c.pools[n]) c.pools[n] = {}; s.mode = 'dhcp'; s.pool = n; changed(s); });
  def('config', 'r', 'no ip dhcp pool <word>', (s, [n]) => { delete dev(s).cfg.pools[n]; changed(s); });
  def('dhcp', 'r', 'network <ip> <mask>', (s, [ip, m]) => { const p = dev(s).cfg.pools[s.pool]; p.network = N.n2ip((N.ip2n(ip) & N.ip2n(m)) >>> 0); p.mask = m; changed(s); });
  def('dhcp', 'r', 'default-router <ip>', (s, [ip]) => { dev(s).cfg.pools[s.pool].router = ip; changed(s); });
  def('dhcp', 'r', 'dns-server <ip>', (s, [ip]) => { dev(s).cfg.pools[s.pool].dns = ip; changed(s); });
  def('dhcp', 'r', 'dns-server <ip> <ip>', (s, [ip]) => { dev(s).cfg.pools[s.pool].dns = ip; changed(s); });
  def('dhcp', 'r', 'lease <n>', () => '');
  def('dhcp', 'r', 'no default-router', s => { delete dev(s).cfg.pools[s.pool].router; changed(s); });
  def('dhcp', 'r', 'no dns-server', s => { delete dev(s).cfg.pools[s.pool].dns; changed(s); });

  def('config', 'r', 'ip route <ip> <mask> <ip>', (s, [n, m, nh]) => {
    const c = dev(s).cfg, net = N.n2ip((N.ip2n(n) & N.ip2n(m)) >>> 0);
    if (!c.routes.some(r => r.net === net && r.mask === m && r.nh === nh)) c.routes.push({ net, mask: m, nh });
    changed(s);
  });
  def('config', 'r', 'no ip route <ip> <mask> <ip>', (s, [n, m, nh]) => { const c = dev(s).cfg; c.routes = c.routes.filter(r => !(r.net === n && r.mask === m && r.nh === nh)); changed(s); });
  def('config', 'r', 'ip nat inside source list <acl> interface <if> overload', (s, [n, i]) => {
    const d = dev(s);
    if (!d.cfg.ifs[i] || i.includes('.')) return `% Invalid interface ${i}`;
    d.cfg.nat = { list: n, iface: i }; changed(s);
  });
  def('config', 'r', 'no ip nat inside source list <acl> interface <if> overload', s => { dev(s).cfg.nat = null; changed(s); });

  const PORTS = { www: 80, http: 80, https: 443, domain: 53, smtp: 25, ftp: 21, telnet: 23, ssh: 22 };
  function parseAce(num, rest) {
    const t = tokenize(rest);
    let i = 0;
    if (t[0] === 'remark') return { remark: t.slice(1).join(' ') };
    const action = t[i++];
    if (action !== 'permit' && action !== 'deny') return null;
    const addr = () => {
      if (t[i] === 'any') { i++; return { any: true }; }
      if (t[i] === 'host' && N.isIp(t[i + 1])) { i += 2; return { ip: t[i - 1], wc: '0.0.0.0' }; }
      if (N.isIp(t[i])) { const ip = t[i++]; const wc = N.isIp(t[i]) ? t[i++] : '0.0.0.0'; return { ip, wc }; }
      return null;
    };
    if (num < 100) { const src = addr(); return src && i === t.length ? { action, std: true, src } : null; }
    const proto = t[i++];
    if (!['ip', 'tcp', 'udp', 'icmp'].includes(proto)) return null;
    const src = addr(); if (!src) return null;
    const dst = addr(); if (!dst) return null;
    let port = null;
    if (t[i] === 'eq') {
      if (proto !== 'tcp' && proto !== 'udp') return null;
      port = PORTS[t[i + 1]] || (/^\d+$/.test(t[i + 1] || '') ? +t[i + 1] : null);
      if (!port) return null;
      i += 2;
    }
    return i === t.length ? { action, proto, src, dst, port } : null;
  }
  def('config', 'r', 'access-list <acl> <line>', (s, [n, rest]) => {
    const r = parseAce(n, rest);
    if (!r) return `% Invalid access-list entry. Examples:\n  access-list ${n < 100 ? n : 10} permit 192.168.1.0 0.0.0.255\n  access-list ${n >= 100 ? n : 110} deny ip 192.168.30.0 0.0.0.255 192.168.0.0 0.0.255.255\n  access-list ${n >= 100 ? n : 110} permit tcp any host 192.168.99.10 eq 445`;
    const c = dev(s).cfg;
    (c.acls[n] = c.acls[n] || []).push(r); changed(s);
  }, 'permit|deny  (1-99: <source>   100-199: ip|tcp|udp|icmp <source> <destination> [eq <port>])');
  def('config', 'r', 'no access-list <acl>', (s, [n]) => { delete dev(s).cfg.acls[n]; changed(s); });

  // ---------- interface config ----------
  const overlaps = (d, n, ip, mask) => Object.entries(d.cfg.ifs).find(([o, c]) => o !== n && c.ip && (N.inNet(ip, c.ip, c.mask) || N.inNet(c.ip, ip, mask)));
  def('if', 'RV', 'ip address <ip> <mask>', (s, [ip, mask]) => eachIf(s, (c, n, d) => {
    const p = N.prefixLen(mask);
    if (p < 1 || p > 30) return `% Bad mask ${mask} for address ${ip}`;
    const host = N.ip2n(ip) - ((N.ip2n(ip) & N.ip2n(mask)) >>> 0);
    if (host === 0 || host === 2 ** (32 - p) - 1) return `% Bad mask /${p} for address ${ip} (that is the network or broadcast address)`;
    if (n.includes('.') && !c.encap) return '% Configuring IP routing on a LAN subinterface is only allowed if that subinterface is already configured as part of an IEEE 802.1Q VLAN (use "encapsulation dot1Q <vlan>" first).';
    const ov = overlaps(d, n, ip, mask);
    if (ov && d.kind === 'router') return `% ${N.n2ip((N.ip2n(ip) & N.ip2n(mask)) >>> 0)} overlaps with ${N.longIf(ov[0])}`;
    c.ip = ip; c.mask = mask; changed(s);
  }));
  def('if', 'RV', 'no ip address', s => eachIf(s, c => { delete c.ip; delete c.mask; changed(s); }));
  def('if', 'RSV', 'shutdown', s => eachIf(s, (c, n, d) => {
    c.shut = true;
    const S = s.env.S();
    S.errdis = S.errdis.filter(k => k !== d.id + ':' + n);
    changed(s);
    return linkMsg(s, n, 'administratively down');
  }));
  def('if', 'RSV', 'no shutdown', s => eachIf(s, (c, n, d) => {
    c.shut = false; changed(s);
    const k = d.id + ':' + n.split('.')[0], st = n.startsWith('Vlan') ? 'up' : s.env.net().portStatus[k];
    if (st === 'err') return `%PM-4-ERR_DISABLE: ${n} is still err-disabled. Use "shutdown" then "no shutdown" to recover.`;
    return linkMsg(s, n, st === 'up' ? 'up' : 'down');
  }));
  def('if', 'RSV', 'description <line>', (s, [t]) => eachIf(s, c => { c.desc = t.slice(0, 40); changed(s); }));
  def('if', 'RSV', 'no description', s => eachIf(s, c => { c.desc = ''; changed(s); }));
  def('if', 'R', 'encapsulation dot1q <vlan>', (s, [v]) => eachIf(s, (c, n) => {
    if (!n.includes('.')) return '% Configure encapsulation on a subinterface, e.g. interface Gi0/1.10';
    c.encap = v; changed(s);
  }));
  def('if', 'R', 'ip nat inside|outside', (s, [w]) => eachIf(s, c => { c.natIn = w === 'inside'; c.natOut = w === 'outside'; changed(s); }));
  def('if', 'R', 'no ip nat inside|outside', (s, [w]) => eachIf(s, c => { if (w === 'inside') c.natIn = false; else c.natOut = false; changed(s); }));
  def('if', 'R', 'ip access-group <acl> in|out', (s, [n, dir]) => eachIf(s, c => { c[dir === 'in' ? 'aclIn' : 'aclOut'] = n; changed(s); }));
  def('if', 'R', 'no ip access-group <acl> in|out', (s, [, dir]) => eachIf(s, c => { delete c[dir === 'in' ? 'aclIn' : 'aclOut']; changed(s); }));

  def('if', 'S', 'switchport mode access|trunk', (s, [m]) => eachIf(s, c => {
    if (m === 'trunk' && c.ps) return 'Command rejected: port security is enabled on this port.';
    c.mode = m; changed(s);
  }));
  def('if', 'S', 'switchport access vlan <vlan>', (s, [v]) => {
    const d = dev(s);
    let msg = '';
    if (!d.cfg.vlans[v]) { d.cfg.vlans[v] = 'VLAN' + String(v).padStart(4, '0'); msg = '% Access VLAN does not exist. Creating vlan ' + v; }
    eachIf(s, c => { c.vlan = v; });
    changed(s);
    return msg;
  });
  def('if', 'S', 'no switchport access vlan', s => eachIf(s, c => { c.vlan = 1; changed(s); }));
  def('if', 'S', 'switchport trunk allowed vlan <vlist>', (s, [l]) => eachIf(s, c => { c.allowed = expandList(l); changed(s); }));
  def('if', 'S', 'switchport trunk allowed vlan add <vlist>', (s, [l]) => eachIf(s, c => { if (c.allowed) c.allowed = [...new Set([...c.allowed, ...expandList(l)])].sort((a, b) => a - b); changed(s); }));
  def('if', 'S', 'switchport trunk allowed vlan remove <vlist>', (s, [l]) => eachIf(s, c => { const rm = expandList(l); c.allowed = (c.allowed || expandList('1-4094')).filter(v => !rm.includes(v)); changed(s); }));
  def('if', 'S', 'switchport trunk allowed vlan all', s => eachIf(s, c => { c.allowed = null; changed(s); }));
  def('if', 'S', 'switchport trunk native vlan <vlan>', (s, [v]) => eachIf(s, c => { c.native = v; changed(s); }));
  def('if', 'S', 'switchport nonegotiate', () => '');
  def('if', 'S', 'switchport port-security', s => eachIf(s, (c, n) => {
    if (c.mode !== 'access') return `Command rejected: ${N.longIf(n)} is a dynamic port. Set "switchport mode access" first.`;
    c.ps = c.ps || { max: 1, violation: 'shutdown' }; changed(s);
  }));
  def('if', 'S', 'no switchport port-security', s => eachIf(s, c => { c.ps = null; changed(s); }));
  def('if', 'S', 'switchport port-security maximum <n>', (s, [m]) => eachIf(s, c => {
    if (m > 132) return '% Invalid maximum (1-132)';
    if (!c.ps) c.psPending = Object.assign(c.psPending || {}, { max: m });
    else c.ps.max = m;
    changed(s);
  }));
  def('if', 'S', 'switchport port-security violation protect|restrict|shutdown', (s, [v]) => eachIf(s, c => {
    if (!c.ps) c.psPending = Object.assign(c.psPending || {}, { violation: v });
    else c.ps.violation = v;
    changed(s);
  }));
  def('if', 'S', 'spanning-tree portfast', s => eachIf(s, c => { c.portfast = true; changed(s); }) || '%Warning: portfast should only be enabled on ports connected to a single host.');
  def('if', 'S', 'no spanning-tree portfast', s => eachIf(s, c => { c.portfast = false; changed(s); }));

  // Port-security sub-settings typed before enabling it take effect when it is enabled (IOS keeps them).
  const psSpec = SPECS.find(sp => sp.toks.join(' ') === 'switchport port-security' && sp.modes.includes('if'));
  const psRun = psSpec.run;
  psSpec.run = (s, a) => { const out = psRun(s, a); eachIf(s, c => { if (c.ps && c.psPending) { Object.assign(c.ps, c.psPending); delete c.psPending; } }); return out; };

  TO.CLI = { session, exec, help, complete, prompt, parseAce, specs: SPECS };
})(globalThis.TO = globalThis.TO || {});
