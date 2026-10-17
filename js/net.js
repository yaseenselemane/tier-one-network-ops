// Network simulation: turns cables + device configs into who-can-reach-what.
// Pure logic (no DOM) so it runs in the browser and in Node tests.
(function (TO) {
  'use strict';

  const ip2n = s => s.split('.').reduce((a, o) => a * 256 + Number(o), 0);
  const n2ip = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  const isIp = s => typeof s === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every(o => +o <= 255);
  function prefixLen(mask) {
    if (!isIp(mask)) return -1;
    const n = ip2n(mask);
    let p = 0;
    while (p < 32 && Math.floor(n / 2 ** (31 - p)) % 2 === 1) p++;
    return n === (p === 0 ? 0 : 2 ** 32 - 2 ** (32 - p)) ? p : -1;
  }
  const lenToMask = p => n2ip(p === 0 ? 0 : 2 ** 32 - 2 ** (32 - p));
  const netN = (ip, mask) => (ip2n(ip) & ip2n(mask)) >>> 0;
  const inNet = (ip, net, mask) => !!(isIp(ip) && isIp(net) && isIp(mask)) && netN(ip, mask) === netN(net, mask);
  const wcMatch = (ip, base, wc) => ((ip2n(ip) & ~ip2n(wc)) >>> 0) === ((ip2n(base) & ~ip2n(wc)) >>> 0);
  const isPrivate = ip => inNet(ip, '10.0.0.0', '255.0.0.0') || inNet(ip, '172.16.0.0', '255.240.0.0') || inNet(ip, '192.168.0.0', '255.255.0.0');
  const clone = o => JSON.parse(JSON.stringify(o));

  function parseIf(tok) {
    const m = /^([a-z]+)(\d+(?:\/\d+)*)(?:\.(\d+))?$/i.exec(tok || '');
    if (!m) return null;
    const p = m[1].toLowerCase();
    const kind = 'fastethernet'.startsWith(p) ? 'Fa' : 'gigabitethernet'.startsWith(p) ? 'Gi' : 'vlan'.startsWith(p) ? 'Vlan' : null;
    if (!kind) return null;
    if (kind === 'Vlan') return m[3] || m[2].includes('/') || +m[2] < 1 || +m[2] > 4094 ? null : 'Vlan' + +m[2];
    if (!m[2].includes('/')) return null;
    return kind + m[2] + (m[3] ? '.' + +m[3] : '');
  }
  const longIf = n => n.replace(/^Fa/, 'FastEthernet').replace(/^Gi/, 'GigabitEthernet');

  function mac(id) {
    let h = 2166136261, g = 52711;
    for (const c of String(id)) { h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; g = (g * 31 + c.charCodeAt(0)) % 65536; }
    const s = h.toString(16).padStart(8, '0') + g.toString(16).padStart(4, '0');
    return `${s.slice(0, 4)}.${s.slice(4, 8)}.${s.slice(8, 12)}`;
  }

  const WEB = '93.184.215.14', ISP_IP = '203.0.113.1', ISP_MASK = '255.255.255.252', PUBLIC_DNS = ['8.8.8.8', '1.1.1.1'];

  const swPortCfg = () => ({ mode: 'dynamic', vlan: 1, allowed: null, native: 1, shut: false, ps: null, desc: '', portfast: false });
  function defaultCfg(d) {
    if (d.kind === 'router') return { hostname: d.id, ifs: Object.fromEntries(d.ports.map(p => [p, { shut: true }])), routes: [], pools: {}, excluded: [], acls: {}, nat: null };
    const ifs = Object.fromEntries(d.ports.map(p => [p, swPortCfg()]));
    ifs.Vlan1 = { shut: true };
    return { hostname: d.id, vlans: { 1: 'default' }, ifs, gw: null };
  }
  function newRouter(id) {
    const d = { id, kind: 'router', model: 'R4321 router', ports: ['Gi0/0', 'Gi0/1', 'Gi0/2'] };
    d.cfg = defaultCfg(d); d.saved = null; return d;
  }
  function newSwitch(id, n) {
    const d = { id, kind: 'switch', model: `C2960-${n} switch`, ports: [...Array(n)].map((_, i) => 'Fa0/' + (i + 1)).concat(['Gi0/1', 'Gi0/2']) };
    d.cfg = defaultCfg(d); d.saved = null; return d;
  }

  function UF() {
    const p = {};
    const find = k => { if (p[k] === undefined) p[k] = k; while (p[k] !== k) { p[k] = p[p[k]]; k = p[k]; } return k; };
    return { find, union: (a, b) => { const x = find(a), y = find(b); if (x !== y) p[x] = y; } };
  }

  function guestIds(S) {
    const ap = S.devices.AP1;
    if (!ap || !ap.cfg.ssids.some(s => s.guest)) return [];
    return Array.from({ length: S.guests || 0 }, (_, i) => 'GUEST-' + (i + 1));
  }
  const ROGUE_MACS = { hub: ['hub-laptop', 'hub-phone'], pi: ['b827.eb4c.11a2'] };

  function aceMatch(r, p) {
    const addr = (a, ip) => a.any || wcMatch(ip, a.ip, a.wc);
    if (r.remark) return false;
    if (r.std) return addr(r.src, p.src);
    if (r.proto !== 'ip' && r.proto !== p.proto) return false;
    if (!addr(r.src, p.src) || !addr(r.dst, p.dst)) return false;
    return !r.port || r.port === p.port;
  }
  // returns 'permit' | 'deny' | null (no ACL / empty ACL = permit everything)
  function aclEval(acl, p) {
    if (!acl || !acl.filter(r => !r.remark).length) return null;
    for (const r of acl) if (aceMatch(r, p)) return r.action;
    return 'deny';
  }

  function bestRoute(routes, dst) {
    let best = null;
    for (const r of routes) if (inNet(dst, r.net, r.mask) && (!best || prefixLen(r.mask) > prefixLen(best.mask))) best = r;
    return best;
  }

  function compute(S) {
    const D = S.devices;
    const errdis = new Set(S.errdis), faulty = new Set(S.faulty);
    const deskStaff = {};
    for (const st of S.staff) if (st.present) deskStaff[st.desk] = st;

    const occupant = n => {
      const j = S.jacks[n];
      if (!j || !j.ok) return null;
      if (n === 16) return D.PRN1 ? { dev: 'PRN1', port: 'eth0' } : null;
      if (n === 17) return D.AP1 ? { dev: 'AP1', port: 'eth0' } : null;
      const st = deskStaff[n];
      return st ? { host: st.pc } : null;
    };
    const resolve = a => {
      const i = a.indexOf(':'), dev = a.slice(0, i), port = a.slice(i + 1);
      if (dev === 'PP1') { const o = occupant(+port); return o && Object.assign({ jack: +port }, o); }
      return D[dev] ? { dev, port } : null;
    };
    const keyOf = e => (e.host ? e.host : e.dev + ':' + e.port);

    const edges = [];
    const linkOf = {};
    for (const L of S.links) {
      linkOf[L.a] = L.b; linkOf[L.b] = L.a;
      const a = resolve(L.a), b = resolve(L.b);
      if (a && b) edges.push({ a, b, L });
    }

    const macsBehind = e => {
      if (e.host) {
        const j = S.jacks[e.jack];
        return [{ mac: mac(e.host), who: e.host }].concat(j && j.rogue ? ROGUE_MACS[j.rogue].map(m => ({ mac: m.includes('.') ? m : mac(m + e.jack), who: 'ROGUE' + e.jack })) : []);
      }
      const d = D[e.dev];
      if (d.kind === 'ap') return [{ mac: mac('AP1'), who: 'AP1' }].concat(guestIds(S).map(g => ({ mac: mac(g), who: g })));
      return [{ mac: mac(d.id), who: d.id }];
    };

    // Port security runs first: a violation can err-disable the port.
    const violations = [], blockedWho = new Set();
    for (const E of edges) for (const [me, other] of [[E.a, E.b], [E.b, E.a]]) {
      if (!me.dev || D[me.dev].kind !== 'switch') continue;
      const c = D[me.dev].cfg.ifs[me.port];
      if (!c.ps || c.mode !== 'access' || c.shut || faulty.has(keyOf(me))) continue;
      const macs = macsBehind(other), max = c.ps.max || 1;
      if (macs.length <= max) continue;
      const k = keyOf(me);
      if ((c.ps.violation || 'shutdown') === 'shutdown') { if (!errdis.has(k)) { errdis.add(k); violations.push(k); } }
      else macs.slice(max).forEach(m => blockedWho.add(m.who));
    }
    S.errdis = [...errdis];

    const endOk = e => {
      if (e.host) return true;
      const d = D[e.dev], k = keyOf(e);
      if (d.down || faulty.has(k)) return false;
      if (d.kind === 'switch') return !d.cfg.ifs[e.port].shut && !errdis.has(k);
      if (d.kind === 'router') return !d.cfg.ifs[e.port].shut;
      return true;
    };
    const portStatus = {};
    for (const d of Object.values(D)) for (const p of d.ports || []) {
      const k = d.id + ':' + p;
      const cisco = d.kind === 'switch' || d.kind === 'router';
      portStatus[k] = faulty.has(k) ? 'faulty' : d.kind === 'switch' && errdis.has(k) ? 'err' : cisco && d.cfg.ifs[p].shut ? 'disabled' : 'down';
    }
    const upEdges = [], linkUp = {};
    for (const E of edges) {
      if (!(endOk(E.a) && endOk(E.b))) continue;
      upEdges.push(E);
      for (const e of [E.a, E.b]) { if (e.dev) { portStatus[keyOf(e)] = 'up'; linkUp[e.dev] = true; } else linkUp[e.host] = true; }
      for (const raw of [E.L.a, E.L.b]) if (raw.startsWith('PP1:')) portStatus[raw] = 'up';
    }

    // Layer 2: union broadcast domains across up links, matching VLAN tags.
    const uf = UF();
    const carry = e => {
      const m = {}, add = (t, k) => (m[t] = m[t] || []).push(k);
      if (e.host) { add('u', 'H|' + e.host); return m; }
      const d = D[e.dev];
      if (d.kind === 'isp') add('u', 'ISP');
      else if (d.kind === 'ap') d.cfg.ssids.forEach((s, i) => add(s.vlan ? String(s.vlan) : 'u', 'AP|' + i));
      else if (d.kind === 'switch') {
        const c = d.cfg.ifs[e.port], V = d.cfg.vlans, k = v => `S|${d.id}|${v}`;
        if (c.mode === 'trunk') {
          const nat = c.native || 1;
          if (V[nat]) add('u', k(nat));
          for (const v of Object.keys(V).map(Number)) if (v !== nat && (!c.allowed || c.allowed.includes(v))) add(String(v), k(v));
        } else if (V[c.vlan]) add('u', k(c.vlan));
      } else if (d.kind === 'router') {
        add('u', `R|${d.id}|${e.port}`);
        for (const [n, c] of Object.entries(d.cfg.ifs)) if (n.startsWith(e.port + '.') && c.encap && !c.shut) add(String(c.encap), `R|${d.id}|${n}`);
      } else add('u', 'H|' + d.id);
      return m;
    };
    for (const E of upEdges) {
      const A = carry(E.a), B = carry(E.b);
      for (const t in A) if (B[t]) for (const k of [...A[t], ...B[t]]) uf.union(A[t][0], k);
    }
    const segOf = k => uf.find(k);

    // Layer 3 interfaces
    const l3 = [];
    for (const d of Object.values(D)) {
      if (d.kind === 'router') for (const [n, c] of Object.entries(d.cfg.ifs)) {
        if (!c.ip || c.shut) continue;
        const phys = n.split('.')[0];
        if (portStatus[d.id + ':' + phys] !== 'up') continue;
        if (n.includes('.') && !c.encap) continue;
        l3.push({ type: 'router', dev: d.id, ifn: n, ip: c.ip, mask: c.mask, key: `R|${d.id}|${n}` });
      }
      if (d.kind === 'switch') for (const [n, c] of Object.entries(d.cfg.ifs)) {
        if (n.startsWith('Vlan') && c.ip && !c.shut && d.cfg.vlans[+n.slice(4)]) l3.push({ type: 'svi', dev: d.id, ifn: n, ip: c.ip, mask: c.mask, gw: d.cfg.gw, key: `S|${d.id}|${+n.slice(4)}` });
      }
    }
    if (D.ISP && !D.ISP.down) l3.push({ type: 'isp', dev: 'ISP', ip: ISP_IP, mask: ISP_MASK, key: 'ISP' });

    // Hosts
    const hostList = [];
    for (const st of S.staff) if (st.present) hostList.push({ id: st.pc, kind: 'pc', key: 'H|' + st.pc, dhcp: true, staff: st.id, desk: st.desk });
    for (const id of ['PRN1', 'SRV1', 'NAS1']) if (D[id]) hostList.push({ id, kind: D[id].kind, key: 'H|' + id, dhcp: false, stat: D[id].net });
    const gi = D.AP1 ? D.AP1.cfg.ssids.findIndex(s => s.guest) : -1;
    for (const g of guestIds(S)) hostList.push({ id: g, kind: 'guest', key: 'AP|' + gi, dhcp: true, ap: true });

    const hosts = {};
    for (const h of hostList) {
      let linked = h.ap ? !!linkUp.AP1 : !!linkUp[h.id];
      if (blockedWho.has(h.id) || (S.isolated || []).includes(h.id)) linked = false;
      const r = { id: h.id, kind: h.kind, staff: h.staff, desk: h.desk, linked, blocked: blockedWho.has(h.id), seg: linked ? segOf(h.key) : null, ip: null, mask: null, gw: null, dns: null, src: 'none', mac: mac(h.id) };
      if (!h.dhcp && h.stat && isIp(h.stat.ip) && prefixLen(h.stat.mask) > 0) Object.assign(r, { ip: h.stat.ip, mask: h.stat.mask, gw: isIp(h.stat.gw) ? h.stat.gw : null, dns: isIp(h.stat.dns) ? h.stat.dns : null, src: 'static' });
      hosts[h.id] = r;
    }

    // DHCP: a router pool serves the segment of the router interface whose address is inside the pool network.
    const pools = {}, leases = [];
    const used = new Set(l3.map(e => e.ip).concat(Object.values(hosts).filter(r => r.src === 'static').map(r => r.ip)));
    const routerIfs = l3.filter(e => e.type === 'router');
    for (const h of hostList.filter(x => x.dhcp).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))) {
      const r = hosts[h.id];
      if (!r.seg) continue;
      let got = false;
      for (const e of routerIfs) {
        if (segOf(e.key) !== r.seg) continue;
        const cfg = D[e.dev].cfg;
        const hit = Object.entries(cfg.pools).find(([, p]) => p.network && inNet(e.ip, p.network, p.mask));
        if (!hit) continue;
        const [pname, pool] = hit, pk = e.dev + '|' + pname;
        const u = pools[pk] || (pools[pk] = { dev: e.dev, name: pname, used: 0, full: false, taken: new Set() });
        const ip = allocate(cfg, pool, u, used);
        if (ip) {
          Object.assign(r, { ip, mask: pool.mask, gw: isIp(pool.router) ? pool.router : null, dns: isIp(pool.dns) ? pool.dns : null, src: 'dhcp', pool: pk });
          u.used++; leases.push({ dev: e.dev, pool: pname, ip, mac: r.mac, host: r.id }); got = true;
        } else u.full = true;
        break;
      }
      if (!got) { let n = 0; for (const c of h.id) n = (n * 7 + c.charCodeAt(0)) % 60000; Object.assign(r, { ip: `169.254.${1 + (n >> 8) % 254}.${1 + n % 254}`, mask: '255.255.0.0', src: 'apipa' }); }
    }
    for (const r of Object.values(hosts)) if (r.seg && r.ip) l3.push({ type: 'host', id: r.id, ip: r.ip, mask: r.mask, gw: r.gw, seg: r.seg });
    const idx = {};
    for (const e of l3) {
      if (!e.seg) e.seg = segOf(e.key);
      const k = e.seg + '|' + e.ip;
      if (idx[k]) idx[k].conflict = e.conflict = true; else idx[k] = e;
    }
    const byIp = (seg, ip) => idx[seg + '|' + ip] || null;

    // Layer 3 forwarding
    const yes = target => ({ ok: true, target });
    const no = why => ({ ok: false, why });
    const rIf = (dev, ifn) => D[dev].cfg.ifs[ifn];
    const aclOk = (dev, ifn, dir, p) => {
      const c = rIf(dev, ifn), n = dir === 'in' ? c.aclIn : c.aclOut;
      return !n || aclEval(D[dev].cfg.acls[n], p) !== 'deny';
    };
    function natOk(R, inIf, out, src) {
      const nat = D[R].cfg.nat;
      if (!nat || !inIf) return false;
      if (!rIf(R, inIf.ifn).natIn || !rIf(R, out.ifn).natOut) return false;
      if (nat.iface !== out.ifn) return false;
      return aclEval(D[R].cfg.acls[nat.list], { src, dst: '0.0.0.0', proto: 'ip', port: 0 }) === 'permit';
    }
    function forward(R, inIf, p, hops) {
      if (hops > 8) return no('TTL expired in transit');
      if (inIf && !aclOk(R, inIf.ifn, 'in', p)) return no(`blocked by access-list ${rIf(R, inIf.ifn).aclIn} on ${R} ${inIf.ifn} (in)`);
      const conns = l3.filter(e => e.type === 'router' && e.dev === R);
      if (conns.some(e => e.ip === p.dst)) return yes({ type: 'router', dev: R, ip: p.dst });
      let out = conns.find(e => inNet(p.dst, e.ip, e.mask)), nh = p.dst;
      if (!out) {
        const rt = bestRoute(D[R].cfg.routes, p.dst);
        if (!rt) return no(`${R} has no route to ${p.dst}`);
        nh = rt.nh; out = conns.find(e => inNet(nh, e.ip, e.mask));
        if (!out) return no(`${R}: next hop ${nh} is not on an up, connected network`);
      }
      if (!aclOk(R, out.ifn, 'out', p)) return no(`blocked by access-list ${rIf(R, out.ifn).aclOut} on ${R} ${out.ifn} (out)`);
      const t = byIp(out.seg, nh);
      if (!t) return no(`${nh} did not answer ARP on ${R} ${out.ifn}`);
      if (t.type === 'isp') {
        if (p.dst === ISP_IP) return yes(t);
        if (isPrivate(p.dst)) return no('the ISP drops private destinations');
        if (isPrivate(p.src) && !natOk(R, inIf, out, p.src)) return no(`${R} is not translating ${p.src} (check NAT: ip nat inside/outside and the NAT access-list)`);
        return yes({ type: 'internet', ip: p.dst });
      }
      if (nh !== p.dst) return t.type === 'router' ? forward(t.dev, t, p, hops + 1) : no(`${nh} is not a router`);
      return yes(t);
    }
    function listens(t, proto, port) {
      if (proto === 'icmp' || t.type === 'internet') return true;
      if (t.type === 'router' || t.type === 'svi' || t.type === 'isp') return proto === 'tcp' && (port === 22 || port === 23);
      const d = D[t.id];
      if (t.id === 'SRV1') return proto === 'tcp' ? (port === 445 && d.svc.files && !d.encrypted && d.disk < 100) || port === 3389 : proto === 'udp' && port === 53 && d.svc.dns;
      if (t.id === 'NAS1') return proto === 'tcp' && port === 445;
      if (t.id === 'PRN1') return proto === 'tcp' && port === 9100 && !d.jam;
      if (t.type === 'host' && /^PC-/.test(t.id)) return proto === 'tcp' && (port === 3389 || port === 445);
      return false;
    }
    function send(h, dst, proto = 'icmp', port = 0) {
      if (!h || !h.seg || !h.ip) return no('no network connection (link down)');
      if (h.src === 'apipa') return no('no DHCP lease (169.254.x.x address)');
      if (!isIp(dst)) return no('bad address');
      const p = { src: h.ip, dst, proto, port };
      let r;
      if (dst === h.ip) r = yes({ type: 'host', id: h.id, ip: h.ip, mask: h.mask, gw: h.gw, seg: h.seg });
      else if (inNet(dst, h.ip, h.mask)) { const t = byIp(h.seg, dst); r = t ? yes(t) : no(`${dst} did not answer (same subnet, nothing there)`); }
      else {
        if (!h.gw) return no('no default gateway set');
        if (!inNet(h.gw, h.ip, h.mask)) return no(`gateway ${h.gw} is outside ${h.ip}/${prefixLen(h.mask)}`);
        const g = byIp(h.seg, h.gw);
        if (!g || g.type !== 'router') return no(`gateway ${h.gw} is not responding`);
        r = forward(g.dev, g, p, 0);
      }
      if (!r.ok) return r;
      const t = r.target;
      if (t.type === 'host' && !inNet(h.ip, t.ip, t.mask)) {
        const g2 = t.gw && byIp(t.seg, t.gw);
        if (!g2 || g2.type !== 'router') return no(`${dst} cannot reply (its default gateway is wrong)`);
      }
      if (!listens(t, proto, port)) return no(`${dst} is not accepting ${proto.toUpperCase()} ${port}`);
      return r;
    }
    // Ping from a router or switch itself (used by the CLI).
    function sendFrom(devId, dst) {
      const d = D[devId];
      if (!isIp(dst)) return no('bad address');
      if (d.kind === 'router') {
        const conns = l3.filter(e => e.type === 'router' && e.dev === devId);
        if (conns.some(e => e.ip === dst)) return yes({ type: 'router' });
        let out = conns.find(e => inNet(dst, e.ip, e.mask));
        if (!out) { const rt = bestRoute(d.cfg.routes, dst); out = rt && conns.find(e => inNet(rt.nh, e.ip, e.mask)); }
        if (!out) return no('no route');
        const r = forward(devId, null, { src: out.ip, dst, proto: 'icmp', port: 0 }, 0);
        if (r.ok && r.target.type === 'host' && !inNet(out.ip, r.target.ip, r.target.mask)) {
          const g2 = r.target.gw && byIp(r.target.seg, r.target.gw);
          if (!g2) return no('destination cannot reply');
        }
        return r;
      }
      const svi = l3.find(e => e.type === 'svi' && e.dev === devId);
      if (!svi) return no('switch has no management IP (interface vlan with ip address, no shutdown)');
      return send({ id: devId, ip: svi.ip, mask: svi.mask, gw: d.cfg.gw, seg: svi.seg, src: 'static' }, dst);
    }

    const srv = hosts.SRV1;
    const dnsUp = () => D.SRV1 && D.SRV1.svc.dns;
    function resolveExt(h) {
      if (!h.dns) return false;
      if (srv && h.dns === srv.ip) return dnsUp() && send(h, h.dns, 'udp', 53).ok && (h === srv || resolveExt(Object.assign({}, srv, { dns: PUBLIC_DNS.includes(srv.dns) ? srv.dns : '8.8.8.8' })));
      if (PUBLIC_DNS.includes(h.dns)) return send(h, h.dns, 'udp', 53).ok;
      return false;
    }
    const resolveInt = h => !!srv && !!h.dns && h.dns === srv.ip && dnsUp() && send(h, srv.ip, 'udp', 53).ok;

    const needs = {}, fail = {};
    for (const h of Object.values(hosts)) {
      const n = { link: h.linked, ip: false, dns: false, web: false, files: false, print: false };
      if (n.link) {
        n.ip = !!h.ip && h.src !== 'apipa';
        if (n.ip) {
          n.web = send(h, WEB, 'tcp', 443).ok;
          n.dns = resolveExt(h);
          if (h.kind !== 'guest') {
            n.files = resolveInt(h) && send(h, srv.ip, 'tcp', 445).ok;
            n.print = !!hosts.PRN1 && !!hosts.PRN1.ip && send(h, hosts.PRN1.ip, 'tcp', 9100).ok;
          }
        }
      }
      needs[h.id] = n;
      let f = null;
      if (!n.link) f = 'link';
      else if (!n.ip) f = 'ip';
      else if (!n.web || !n.dns) f = n.web ? 'dns' : 'web';
      else if (h.kind !== 'guest' && !n.files) f = 'files';
      else if (h.kind !== 'guest' && !n.print) f = 'print';
      fail[h.id] = h.kind === 'pc' || h.kind === 'guest' ? f : null;
    }

    // MAC address tables and rogue devices (for show commands and security)
    const macs = {}, rogue = [];
    for (const E of upEdges) for (const [me, other] of [[E.a, E.b], [E.b, E.a]]) {
      if (!me.dev || D[me.dev].kind !== 'switch') continue;
      const c = D[me.dev].cfg.ifs[me.port];
      const list = macs[me.dev] || (macs[me.dev] = []);
      for (const m of macsBehind(other)) if (!blockedWho.has(m.who)) list.push({ vlan: c.mode === 'trunk' ? c.native || 1 : c.vlan, mac: m.mac, port: me.port, who: m.who });
    }
    for (const E of edges) for (const [me, other] of [[E.a, E.b], [E.b, E.a]]) {
      if (!me.host) continue;
      const j = S.jacks[me.jack];
      if (!j || !j.rogue) continue;
      const pk = other.dev ? other.dev + ':' + other.port : null;
      rogue.push({ desk: me.jack, kind: j.rogue, port: pk, blocked: !pk || portStatus[pk] !== 'up' || blockedWho.has('ROGUE' + me.jack) });
    }

    return { portStatus, edges, upEdges, linkOf, hosts, l3, byIp, seg: segOf, send, sendFrom, needs, fail, leases, pools, violations, macs, rogue, aclEval };
  }

  function allocate(cfg, pool, u, used) {
    if (!isIp(pool.network) || prefixLen(pool.mask) < 1) return null;
    const lo = netN(pool.network, pool.mask), hi = (lo | ~ip2n(pool.mask)) >>> 0;
    for (let n = lo + 1; n < hi; n++) {
      const ip = n2ip(n);
      if (used.has(ip) || u.taken.has(ip) || cfg.excluded.some(([a, b]) => n >= ip2n(a) && n <= ip2n(b || a))) continue;
      u.taken.add(ip);
      return ip;
    }
    return null;
  }
  function poolSize(cfg, pool) {
    if (!isIp(pool.network) || prefixLen(pool.mask) < 1) return { total: 0, excluded: 0 };
    const lo = netN(pool.network, pool.mask), hi = (lo | ~ip2n(pool.mask)) >>> 0;
    let ex = 0;
    for (const [a, b] of cfg.excluded) { const x = Math.max(ip2n(a), lo + 1), y = Math.min(ip2n(b || a), hi - 1); if (y >= x) ex += y - x + 1; }
    return { total: hi - lo - 1, excluded: ex };
  }

  // A device with no startup-config boots the factory default, so an untouched device counts as saved.
  const isSaved = d => JSON.stringify(d.cfg) === JSON.stringify(d.saved || defaultCfg(d));

  TO.Net = { isSaved, ip2n, n2ip, isIp, prefixLen, lenToMask, inNet, isPrivate, parseIf, longIf, mac, clone, defaultCfg, newRouter, newSwitch, compute, aclEval, poolSize, guestIds, WEB, ISP_IP, PUBLIC_DNS };
})(globalThis.TO = globalThis.TO || {});
