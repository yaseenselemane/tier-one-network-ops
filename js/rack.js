// Server rack view: devices, ports with link LEDs, and drag-to-connect patch cables (SVG).
(function (TO) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['#4aa3ff', '#ffd23f', '#3ddc84', '#ff5d73', '#b48cff', '#ff9f43'];
  const ROWS = [['ISP', 46], ['R1', 58], ['PP1', 66], ['SW1', 62], ['SW2', 96], ['SRV1', 72], ['NAS1', 54]];
  let root, svg, info, handlers = {}, pos = {}, drag = null, selected = null, pending = null;
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const portLabel = (dev, p) => (dev.kind === 'switch' ? (p.startsWith('Gi') ? 'G' + p.split('/')[1] : p.split('/')[1]) : p);

  function layoutPorts(dev, y, h) {
    const out = [];
    const ports = dev.ports;
    if (dev.kind === 'pp') ports.forEach((p, i) => out.push([p, 250 + i * 28, y + 18]));
    else if (dev.kind === 'switch') {
      const fa = ports.filter(p => p.startsWith('Fa')), gi = ports.filter(p => p.startsWith('Gi'));
      const perRow = fa.length > 12 ? Math.ceil(fa.length / 2) : fa.length;
      fa.forEach((p, i) => out.push([p, 250 + (i % perRow) * 30, y + 16 + Math.floor(i / perRow) * 36]));
      gi.forEach((p, i) => out.push([p, 250 + perRow * 30 + 24 + i * 30, y + 16]));
    } else if (dev.kind === 'router') ports.forEach((p, i) => out.push([p, 470 + i * 46, y + 16]));
    else ports.forEach(p => out.push([p, 700, y + h / 2 - 14]));
    return out;
  }

  function build() {
    const S = TO.Game.state(), net = TO.Game.net();
    if (!S || !net || drag) return;
    pos = {};
    let y = 24, body = '';
    const devs = ROWS.filter(([id]) => S.devices[id]);
    for (const [id, h] of devs) {
      const d = S.devices[id];
      const kindCol = { isp: '#3a3f47', router: '#24384a', pp: '#2b2f35', switch: '#1f3d36', server: '#33302a', nas: '#2e2a3a' }[d.kind];
      body += `<g class="dev" data-dev="${id}">
        <rect x="70" y="${y}" width="760" height="${h}" rx="4" fill="${kindCol}" stroke="#0b0f13" stroke-width="2"/>
        <rect x="70" y="${y}" width="760" height="5" fill="rgba(255,255,255,0.06)"/>
        <text x="86" y="${y + 26}" class="dev-id">${esc(d.kind === 'router' || d.kind === 'switch' ? d.cfg.hostname : id)}</text>
        <text x="86" y="${y + 42}" class="dev-model">${esc(d.model)}</text>`;
      if (d.kind === 'server' || d.kind === 'nas') {
        for (let i = 0; i < (d.kind === 'server' ? 6 : 4); i++) body += `<rect x="${330 + i * 52}" y="${y + 12}" width="44" height="${h - 24}" rx="3" class="bay"/><circle cx="${366 + i * 52}" cy="${y + 20}" r="2.5" class="${d.encrypted ? 'led-bad' : 'led-ok'} blink"/>`;
        const state = d.kind === 'server' ? (d.encrypted ? 'ENCRYPTED' : !d.svc.files || !d.svc.dns ? 'SERVICE DOWN' : d.disk >= 100 ? 'DISK FULL' : 'OK') : S.backupOk ? 'BACKUPS OK' : 'NOT BACKING UP';
        body += `<text x="640" y="${y + h - 10}" class="dev-state ${/OK/.test(state) && !/NOT/.test(state) ? 'ok' : 'bad'}" text-anchor="end">${state}</text>`;
      }
      if (d.kind === 'router') body += `<text x="${470 + 3 * 46 + 10}" y="${y + 32}" class="dev-model">CONSOLE ▸ click name</text>`;
      if (d.kind === 'switch') body += `<text x="760" y="${y + h - 8}" class="dev-model" text-anchor="end">${d.ports.length} ports</text>`;
      for (const [p, px, py] of layoutPorts(d, y, h)) {
        const k = id + ':' + p, st = net.portStatus[k] || 'down';
        pos[k] = { x: px + 12, y: py + 9 };
        const linked = !!TO.Game.portLinked(k);
        let sub = '';
        if (d.kind === 'pp') {
          const n = +p, who = S.staff.find(s => s.present && s.desk === n);
          sub = n === 16 ? 'PRN' : n === 17 ? 'AP' : who ? who.name.split(' ')[0].slice(0, 5) : '';
        }
        body += `<g class="port${selected === k ? ' sel' : ''}${pending === k ? ' pend' : ''}" data-port="${k}">
          <rect class="hit" x="${px - 2}" y="${py - 8}" width="28" height="48" fill="transparent"/>
          <rect x="${px}" y="${py}" width="24" height="18" rx="2" class="jack ${linked ? 'used' : ''}"/>
          <rect x="${px + 6}" y="${py + 4}" width="12" height="9" class="hole"/>
          <circle cx="${px + 20}" cy="${py - 4}" r="2.6" class="led st-${st}"/>
          <text x="${px + 12}" y="${py + 29}" class="plabel">${esc(portLabel(d, p))}</text>
          ${sub ? `<text x="${px + 12}" y="${py + 39}" class="psub">${esc(sub)}</text>` : ''}
        </g>`;
      }
      body += '</g>';
      y += h + 18;
    }
    const height = y + 30;
    let cables = '';
    for (const L of S.links) {
      const a = pos[L.a], b = pos[L.b];
      if (!a || !b) continue;
      const sameRow = Math.abs(a.y - b.y) < 2;
      const sag = sameRow ? 28 + Math.abs(b.x - a.x) * 0.12 : 34 + Math.abs(b.y - a.y) * 0.25;
      const c = COLORS[L.color % COLORS.length];
      const dpath = `M${a.x},${a.y} C${a.x},${a.y + sag} ${b.x},${b.y + sag} ${b.x},${b.y}`;
      const sel = selected === L.a || selected === L.b;
      const rev = `M${b.x},${b.y} C${b.x},${b.y + sag} ${a.x},${a.y + sag} ${a.x},${a.y}`;
      const flow = !reduced() && net.portStatus[L.a] === 'up' && net.portStatus[L.b] === 'up' ? `<circle r="3.2" class="pkt"><animateMotion dur="${(1.1 + (L.color % 3) * 0.3).toFixed(1)}s" repeatCount="indefinite" path="${dpath}"/></circle><circle r="2.6" class="pkt"><animateMotion dur="${(1.5 + (L.color % 3) * 0.3).toFixed(1)}s" repeatCount="indefinite" path="${rev}"/></circle>` : '';
      cables += `<g class="cable${sel ? ' sel' : ''}" data-a="${L.a}"><path d="${dpath}" class="cable-shadow"/><path d="${dpath}" stroke="${c}" class="cable-line"/>
        <rect x="${a.x - 6}" y="${a.y - 6}" width="12" height="12" rx="2" fill="${c}" class="plug"/><rect x="${b.x - 6}" y="${b.y - 6}" width="12" height="12" rx="2" fill="${c}" class="plug"/>${flow}</g>`;
    }
    svg.setAttribute('viewBox', `48 0 804 ${height}`);
    svg.innerHTML = `<rect x="56" y="10" width="788" height="${height - 20}" rx="6" class="rack-frame"/>
      ${[62, 832].map(x => `<rect x="${x}" y="14" width="6" height="${height - 28}" class="rail"/>`).join('')}
      ${body}<g class="cables">${cables}</g><path id="dragline" class="dragline" d=""/>`;
    renderInfo();
  }

  function svgPoint(e) { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); }

  function renderInfo() {
    const S = TO.Game.state(), net = TO.Game.net();
    if (pending) { info.innerHTML = `<h3>Connecting ${esc(pending.replace(':', ' '))}</h3><p>Now tap the port at the other end of the cable. Tap ${esc(pending.replace(':', ' '))} again to cancel.</p><div class="row"><button class="btn" data-act="cancel">Cancel</button></div>`; return; }
    if (!selected) { info.innerHTML = '<h3>Patch cables</h3><p>Drag from one port to another to connect a cable, or tap one port and then the other. On a phone, swipe the rack sideways to reach more ports. Tap a port or cable to see where it goes. Click a device name to open its console or settings.</p><p class="muted">LEDs: <span class="dot st-up"></span>link up <span class="dot st-down"></span>no link <span class="dot st-disabled"></span>shut down <span class="dot st-err"></span>err-disabled <span class="dot st-faulty"></span>faulty</p>'; return; }
    const k = selected, [id, p] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    const d = S.devices[id];
    const other = net.linkOf[k];
    const st = net.portStatus[k];
    const STN = { up: 'Link up', down: 'No link', disabled: 'Administratively down (shutdown)', err: 'Err-disabled (port security)', faulty: 'Hardware fault: port is dead' };
    const rows = [['Status', STN[st] || st], ['Cable to', other ? describe(S, other) : 'nothing']];
    if (d.kind === 'switch') {
      const c = d.cfg.ifs[p];
      rows.push(['Mode', c.mode === 'trunk' ? `trunk (native ${c.native || 1}${c.allowed ? ', allowed ' + c.allowed.join(',') : ''})` : `access, VLAN ${c.vlan}${c.mode === 'dynamic' ? ' (dynamic)' : ''}`]);
      rows.push(['Port security', c.ps ? `on, max ${c.ps.max}, ${c.ps.violation}` : 'off']);
      if (c.desc) rows.push(['Description', c.desc]);
    }
    if (d.kind === 'router') {
      const c = d.cfg.ifs[p];
      rows.push(['IP', c.ip ? `${c.ip} ${c.mask}` : 'none']);
      const subs = Object.keys(d.cfg.ifs).filter(n => n.startsWith(p + '.'));
      if (subs.length) rows.push(['Subinterfaces', subs.map(n => `${n} (VLAN ${d.cfg.ifs[n].encap || '?'}) ${d.cfg.ifs[n].ip || ''}`).join('<br>')]);
    }
    if (d.kind === 'pp') rows.push(['Wall socket', describe(S, k, true)]);
    info.innerHTML = `<h3>${esc(id)} ${esc(p)}</h3><dl>${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>
      <div class="row">${other ? '<button class="btn danger" data-act="unplug">Unplug cable</button>' : ''}${d.kind === 'router' || d.kind === 'switch' ? '<button class="btn" data-act="console">Open console</button>' : ''}${d.net || d.kind === 'ap' ? '<button class="btn" data-act="settings">Settings</button>' : ''}</div>`;
  }
  function describe(S, k, wall) {
    const [id, p] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    if (id === 'PP1') {
      const n = +p;
      if (n === 16) return wall ? 'Printer PRN1' : 'PP1 port 16 → printer';
      if (n === 17) return wall ? (S.devices.AP1 ? 'Ceiling access point AP1' : 'Ceiling (no AP installed)') : 'PP1 port 17 → ceiling AP';
      const who = S.staff.find(s => s.present && s.desk === n);
      const j = S.jacks[n];
      const txt = who ? `Desk ${n}: ${esc(who.name)} (${who.pc})` : `Desk ${n} (empty)`;
      return wall ? txt + (j.ok ? '' : ' <b class="bad">cable loose at desk</b>') : `PP1 port ${n} → ${txt}`;
    }
    return `${esc(id)} ${esc(p)}`;
  }

  TO.Rack = {
    init(container, hs) {
      root = container; handlers = hs;
      root.innerHTML = '<div class="rack-wrap"><svg class="rack" role="img" aria-label="Server rack"></svg></div><aside class="rack-info panel"></aside>';
      svg = root.querySelector('svg'); info = root.querySelector('.rack-info');
      // Two ways to cable: drag from one port to another, or (touch-friendly) tap a free port, then tap the other end.
      svg.addEventListener('pointerdown', e => {
        const g = e.target.closest('.port');
        const cab = e.target.closest('.cable');
        if (g) {
          const k = g.dataset.port;
          if (pending && pending !== k) {
            const err = TO.Game.link(pending, k);
            if (err) handlers.toast(err, 'bad'); else selected = k;
            pending = null; drag = null; build();
            e.preventDefault();
            return;
          }
          selected = k;
          if (!TO.Game.portLinked(k)) {
            drag = { from: k, x: e.clientX, y: e.clientY, moved: false };
            try { svg.setPointerCapture(e.pointerId); } catch (err) { /* no active pointer: keep going */ }
            TO.Audio.play('step');
          }
          build(); renderInfo();
          e.preventDefault();
        } else if (cab) { selected = cab.dataset.a; drag = null; pending = null; build(); }
        else { pending = null; const dv = e.target.closest('.dev'); if (dv && handlers.device) handlers.device(dv.dataset.dev); else build(); }
      });
      svg.addEventListener('pointermove', e => {
        if (!drag) return;
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) drag.moved = true;
        if (!drag.moved) return;
        const a = pos[drag.from], b = svgPoint(e);
        svg.querySelector('#dragline').setAttribute('d', `M${a.x},${a.y} C${a.x},${a.y + 40} ${b.x},${b.y + 40} ${b.x},${b.y}`);
        svg.querySelectorAll('.port.hover').forEach(x => x.classList.remove('hover'));
        const over = document.elementFromPoint(e.clientX, e.clientY);
        const g = over && over.closest && over.closest('.port');
        if (g) g.classList.add('hover');
      });
      const end = e => {
        if (!drag) return;
        const from = drag.from, moved = drag.moved;
        drag = null;
        if (!moved) { pending = pending === from ? null : from; build(); return; } // a tap: arm (or cancel) tap-to-connect
        const over = document.elementFromPoint(e.clientX, e.clientY);
        const g = over && over.closest && over.closest('.port');
        if (g && g.dataset.port !== from) {
          const err = TO.Game.link(from, g.dataset.port);
          if (err) handlers.toast(err, 'bad'); else selected = g.dataset.port;
        }
        build();
      };
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', () => { drag = null; build(); });
      info.addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (b && b.dataset.act === 'cancel') { pending = null; build(); return; }
        if (!b || !selected) return;
        const id = selected.slice(0, selected.indexOf(':'));
        if (b.dataset.act === 'unplug') { TO.Game.unlink(selected); build(); }
        if (b.dataset.act === 'console') handlers.console(id);
        if (b.dataset.act === 'settings') handlers.device(id);
      });
    },
    render: build,
    select(k) { selected = k; build(); },
  };
})(globalThis.TO = globalThis.TO || {});
