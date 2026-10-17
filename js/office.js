// Isometric office diorama drawn on a canvas: desks, people, the server room, printer, AP and lobby.
(function (TO) {
  'use strict';
  const W = 14, H = 10, TW = 64, TH = 32;
  let cv, cx, sc = 1, ox = 0, oy = 0, cw = 0, ch = 0, hot = [], mouse = null, handlers = {}, focus = null, waves = [];
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const iso = (x, y, z = 0) => [ox + (x - y) * (TW / 2) * sc, oy + (x + y) * (TH / 2) * sc - z * sc];
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * f))));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  function poly(pts, fill, stroke) {
    cx.beginPath();
    pts.forEach((p, i) => (i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1])));
    cx.closePath();
    if (fill) { cx.fillStyle = fill; cx.fill(); }
    if (stroke) { cx.strokeStyle = stroke; cx.lineWidth = 1; cx.stroke(); }
  }
  function box(x, y, w, d, h, z, col) {
    poly([iso(x, y + d, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x, y + d, z + h)], shade(col, 0.78));
    poly([iso(x + w, y, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x + w, y, z + h)], shade(col, 0.62));
    poly([iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)], shade(col, 1));
  }
  const deskPos = n => ({ x: 4.3 + ((n - 1) % 5) * 1.9, y: 1.2 + Math.floor((n - 1) / 5) * 2.8 });

  function fit() {
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cw = r.width; ch = r.height;
    cv.width = Math.max(1, Math.round(cw * dpr)); cv.height = Math.max(1, Math.round(ch * dpr));
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mapW = (W + H) * TW / 2, mapH = (W + H) * TH / 2 + 120;
    sc = Math.min(cw / (mapW + 30), ch / (mapH + 20));
    ox = cw / 2 - ((W - H) * TW / 4) * sc;
    oy = (ch - (W + H) * (TH / 2) * sc + 120 * sc) / 2;
  }

  function addHot(kind, id, x, y, z, rw, rh, label) {
    const [sx, sy] = iso(x, y, z);
    hot.push({ kind, id, x: sx - rw * sc / 2, y: sy - rh * sc, w: rw * sc, h: rh * sc, label });
  }

  function person(px, py, color, bob, skin) {
    const [bx, by] = iso(px, py, 26 + bob);
    cx.fillStyle = 'rgba(0,0,0,0.18)';
    const [shx, shy] = iso(px, py, 0);
    cx.beginPath(); cx.ellipse(shx, shy, 10 * sc, 5 * sc, 0, 0, Math.PI * 2); cx.fill();
    cx.fillStyle = color;
    cx.beginPath(); cx.ellipse(bx, by, 9 * sc, 12 * sc, 0, 0, Math.PI * 2); cx.fill();
    cx.fillStyle = skin;
    cx.beginPath(); cx.arc(bx, by - 17 * sc, 7 * sc, 0, Math.PI * 2); cx.fill();
    return [bx, by - 30 * sc];
  }
  function bubble(x, y, bg, glyph) {
    cx.fillStyle = bg;
    cx.beginPath(); cx.arc(x, y - 6 * sc, 9 * sc, 0, Math.PI * 2); cx.fill();
    cx.beginPath(); cx.moveTo(x - 4 * sc, y + 1 * sc); cx.lineTo(x + 4 * sc, y + 1 * sc); cx.lineTo(x, y + 6 * sc); cx.fill();
    cx.fillStyle = '#fff';
    cx.font = `700 ${Math.round(12 * sc)}px "Chakra Petch", sans-serif`;
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(glyph, x, y - 5.5 * sc);
  }

  const SKIN = ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#ffdbac', '#6b4423'];

  function draw(now) {
    const S = TO.Game.state(), net = TO.Game.net();
    if (!cv || !S || !net) return;
    const r = cv.getBoundingClientRect();
    if (Math.abs(r.width - cw) > 1 || Math.abs(r.height - ch) > 1) fit();
    cx.clearRect(0, 0, cw, ch);
    hot = [];
    const t = now / 1000;
    const cb = !!(TO.Settings && TO.Settings.cb()), OKC = cb ? '#56b4e9' : '#2fbf71', BADC = cb ? '#ff8a00' : '#e5484d', PKT = cb ? '#9ad7ff' : '#5ef0a0';

    // floor
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      const server = x < 3 && y < 4, lobby = x < 3 && y >= 6;
      const base = server ? ((x + y) % 2 ? '#8d99a3' : '#86929c') : lobby ? '#8a6f9c' : ((x + y) % 2 ? '#cfa97f' : '#c8a277');
      poly([iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)], base, server ? 'rgba(0,0,0,0.08)' : null);
    }
    // walls
    poly([iso(0, 0), iso(W, 0), iso(W, 0, 100), iso(0, 0, 100)], '#e8e2d6');
    poly([iso(0, 0), iso(0, H), iso(0, H, 100), iso(0, 0, 100)], '#d4cdbf');
    for (const wx of [4.5, 7.5, 10.5]) {
      poly([iso(wx, 0, 38), iso(wx + 2, 0, 38), iso(wx + 2, 0, 86), iso(wx, 0, 86)], '#a9d8f2', '#8a8174');
      poly([iso(wx + 1, 0, 38), iso(wx + 1, 0, 86)], null, '#8a8174');
    }
    cx.fillStyle = '#5b5348';
    cx.font = `700 ${Math.round(13 * sc)}px "Chakra Petch", sans-serif`;
    cx.textAlign = 'center';
    const [lx, ly] = iso(0, 7.5, 70);
    cx.save(); cx.translate(lx, ly); cx.transform(1, 0.5, 0, 1, 0, 0); cx.fillText('BRIGHTWATER', 0, 0); cx.restore();

    // server rack
    const st = net.portStatus;
    const bad = Object.values(st).some(v => v === 'err' || v === 'faulty');
    box(0.9, 0.9, 1, 1, 96, 0, '#2d333b');
    for (let row = 0; row < 7; row++) for (let j = 0; j < 5; j++) {
      const [lx2, ly2] = iso(1.0 + j * 0.17, 1.9, 12 + row * 11);
      const blink = Math.sin(t * (3 + j) + row * 1.7) > 0.2;
      cx.fillStyle = row === 2 && bad && j === 0 ? (blink ? '#ffb02e' : '#553') : blink ? '#43e08a' : '#1b5e3b';
      cx.fillRect(lx2, ly2, 3 * sc, 2 * sc);
    }
    addHot('rack', 'rack', 1.4, 1.9, 0, 50, 110, 'Server rack (click to open)');
    // glass partition
    const glass = 'rgba(170,215,240,0.28)';
    poly([iso(3, 0), iso(3, 4), iso(3, 4, 90), iso(3, 0, 90)], glass, 'rgba(120,160,180,0.6)');
    poly([iso(0, 4), iso(3, 4), iso(3, 4, 90), iso(0, 4, 90)], glass, 'rgba(120,160,180,0.6)');
    const [gx, gy] = iso(1.5, 4, 70);
    cx.fillStyle = 'rgba(30,50,60,0.7)';
    cx.font = `600 ${Math.round(9 * sc)}px "IBM Plex Sans", sans-serif`;
    cx.save(); cx.translate(gx, gy); cx.transform(1, -0.5, 0, 1, 0, 0); cx.fillText('SERVER ROOM', 0, 0); cx.restore();

    // printer
    const prn = S.devices.PRN1;
    box(1.1, 6.3, 0.8, 0.6, 26, 0, '#dfe3e6');
    box(1.25, 6.4, 0.5, 0.35, 3, 26, '#ffffff');
    const [px1, py1] = iso(1.15, 6.9, 18);
    cx.fillStyle = prn.jam ? (Math.sin(t * 6) > 0 ? '#ff3b3b' : '#5a1d1d') : net.portStatus['PP1:16'] === 'up' ? '#43e08a' : '#777';
    cx.fillRect(px1, py1, 4 * sc, 3 * sc);
    addHot('printer', 'PRN1', 1.5, 6.9, 0, 50, 50, prn.jam ? 'Printer: paper jam!' : 'Printer PRN1');

    // lobby sofa + guests
    box(0.3, 8.4, 2.2, 0.8, 14, 0, '#4f6d7a');
    box(0.3, 8.4, 0.3, 0.8, 30, 0, '#46616d');
    for (let i = 0; i < Math.min(3, S.guests); i++) {
      const [hx, hy] = person(0.9 + i * 0.6, 8.8, '#7b8b6f', Math.sin(t * 2 + i) * 0.8, SKIN[(i + 3) % SKIN.length]);
      cx.fillStyle = '#5ec8ff'; cx.fillRect(hx + 4 * sc, hy + 20 * sc, 3 * sc, 5 * sc);
    }
    if (S.guests) addHot('lobby', 'lobby', 1.4, 8.8, 0, 90, 60, `${S.guests} visitors on guest Wi-Fi`);

    // plants
    for (const [x, y] of [[13.2, 0.4], [3.4, 9.2], [13.2, 9.2]]) {
      box(x, y, 0.4, 0.4, 12, 0, '#9a6b4b');
      const [qx, qy] = iso(x + 0.2, y + 0.2, 26);
      cx.fillStyle = '#3f8f4f'; cx.beginPath(); cx.arc(qx, qy, 11 * sc, 0, Math.PI * 2); cx.fill();
      cx.fillStyle = '#52a862'; cx.beginPath(); cx.arc(qx - 4 * sc, qy - 4 * sc, 6 * sc, 0, Math.PI * 2); cx.fill();
    }

    // desks, back rows first
    const jobsByDesk = {};
    for (const j of S.jobs) if (typeof j.arg === 'number') jobsByDesk[j.arg] = j;
    for (const j of S.jobs) if (j.kind === 'reimage') { const s2 = S.staff.find(s => s.id === j.arg); if (s2) jobsByDesk[s2.desk] = j; }
    for (let n = 1; n <= 15; n++) {
      const { x, y } = deskPos(n);
      const who = S.staff.find(s => s.present && s.desk === n);
      box(x, y, 1.3, 0.62, 24, 0, '#9b7a55');
      box(x + 0.42, y + 0.08, 0.46, 0.07, 17, 24, '#23272d');
      let screen = '#30363d';
      if (who) {
        const fail = net.fail[who.pc];
        screen = who.infected ? (Math.sin(t * 5) > 0 ? '#c05cff' : '#5b2a78') : fail === 'link' || fail === 'ip' ? '#40464e' : fail ? '#ff8c69' : '#6fd0ff';
      }
      poly([iso(x + 0.45, y + 0.15, 26), iso(x + 0.85, y + 0.15, 26), iso(x + 0.85, y + 0.15, 39), iso(x + 0.45, y + 0.15, 39)], screen);
      const [nx, ny] = iso(x + 1.2, y + 1.55, 0);
      cx.fillStyle = 'rgba(60,40,20,0.55)';
      cx.font = `600 ${Math.round(9 * sc)}px "IBM Plex Mono", monospace`;
      cx.textAlign = 'center'; cx.fillText(String(n), nx, ny);
      if (who) {
        box(x + 0.45, y + 0.9, 0.4, 0.35, 12, 0, '#363d47');
        const col = TO.DATA.DEPT_COLOR[who.dept] || '#aaa';
        const [hx, hy] = person(x + 0.65, y + 1.05, col, Math.sin(t * 1.6 + n) * 1.2, SKIN[n % SKIN.length]);
        const open = S.tickets.some(tk => tk.open && tk.staff === who.id);
        const job = jobsByDesk[n];
        if (job) bubble(hx, hy, '#e0a030', '…');
        else if (who.infected) bubble(hx, hy, '#8e3fd6', '!');
        else if (open) bubble(hx, hy, BADC, '!');
        else if (!net.fail[who.pc]) { cx.fillStyle = OKC; cx.beginPath(); cx.arc(hx, hy - 4 * sc, 4 * sc, 0, Math.PI * 2); cx.fill(); }
        addHot('desk', n, x + 0.65, y + 1.05, 0, 70, 90, `Desk ${n}: ${who.name} (${who.dept})`);
      } else addHot('desk', n, x + 0.65, y + 0.6, 0, 70, 50, `Desk ${n}: empty`);
      if (focus && focus.n === n && now < focus.until) {
        const [fx, fy] = iso(x + 0.65, y + 0.9, 0);
        cx.strokeStyle = `rgba(255,190,70,${0.5 + 0.5 * Math.sin(t * 8)})`; cx.lineWidth = 3;
        cx.beginPath(); cx.ellipse(fx, fy, 55 * sc, 28 * sc, 0, 0, Math.PI * 2); cx.stroke();
      }
    }

    // live traffic: packets run from each online desk to the server room; failing traffic bounces back in red
    if (!reduced()) {
      const door = [3.0, 2.3], rack = [1.5, 2.0];
      const at = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      for (const who of S.staff.filter(s => s.present)) {
        const nd = net.needs[who.pc];
        if (!nd || !nd.link) continue;
        const dp = deskPos(who.desk), src = [dp.x + 0.65, dp.y + 0.9], good = !net.fail[who.pc];
        for (let k = 0; k < 2; k++) {
          const f = (t * 0.26 + who.desk * 0.137 + k * 0.5) % 1;
          const u = good ? f : (f < 0.5 ? f / 0.5 : 1 - (f - 0.5) / 0.5) * 0.62;
          const p = u < 0.7 ? at(src, door, u / 0.7) : at(door, rack, (u - 0.7) / 0.3);
          const [qx, qy] = iso(p[0], p[1], 8);
          cx.fillStyle = good ? PKT : BADC;
          cx.globalAlpha = good ? 0.9 : 0.6 + 0.4 * Math.sin(t * 12);
          cx.beginPath(); cx.arc(qx, qy, 3.2 * sc, 0, Math.PI * 2); cx.fill();
          cx.globalAlpha = 1;
        }
      }
    }
    // "network restored" wave: a ring pulses out from each desk that just came back
    waves = waves.filter(w => now - w.start < 1500);
    for (const w of waves) {
      const age = now - w.start;
      if (age < 0) continue;
      const dp = deskPos(w.desk), [wx, wy] = iso(dp.x + 0.65, dp.y + 0.9, 0), k = age / 1500;
      cx.strokeStyle = cb ? `rgba(86,180,233,${1 - k})` : `rgba(61,220,151,${1 - k})`; cx.lineWidth = 4 * (1 - k) + 1;
      cx.beginPath(); cx.ellipse(wx, wy, (20 + 70 * k) * sc, (10 + 35 * k) * sc, 0, 0, Math.PI * 2); cx.stroke();
    }
    // ceiling access point
    if (S.devices.AP1) {
      const [ax, ay] = iso(8.6, 4.4, 118);
      const up = net.portStatus['PP1:17'] === 'up';
      if (up) for (let i = 0; i < 3; i++) {
        const ph = (t * 0.8 + i / 3) % 1;
        cx.strokeStyle = `rgba(90,200,255,${0.5 * (1 - ph)})`; cx.lineWidth = 2;
        cx.beginPath(); cx.ellipse(ax, ay + 40 * sc * ph, 30 * sc * ph + 8 * sc, 15 * sc * ph + 4 * sc, 0, 0, Math.PI * 2); cx.stroke();
      }
      cx.fillStyle = '#f4f6f8'; cx.beginPath(); cx.ellipse(ax, ay, 16 * sc, 8 * sc, 0, 0, Math.PI * 2); cx.fill();
      cx.fillStyle = up ? '#43e08a' : '#ffb02e'; cx.beginPath(); cx.arc(ax, ay, 2.5 * sc, 0, Math.PI * 2); cx.fill();
      hot.push({ kind: 'ap', id: 'AP1', x: ax - 20 * sc, y: ay - 12 * sc, w: 40 * sc, h: 24 * sc, label: 'Access point AP1 (click to configure)' });
    }

    // time of day light
    const late = Math.max(0, (S.t - 900) / 120);
    if (late > 0) { cx.fillStyle = `rgba(255,140,60,${Math.min(0.2, late * 0.2)})`; cx.fillRect(0, 0, cw, ch); }

    if (S.overtime) { cx.fillStyle = 'rgba(8,14,44,0.5)'; cx.fillRect(0, 0, cw, ch); }
    const h = mouse && pick(mouse.x, mouse.y);
    cv.style.cursor = h ? 'pointer' : 'default';
    if (h) {
      cx.font = `500 ${Math.max(12, Math.round(12 * sc))}px "IBM Plex Sans", sans-serif`;
      const tw = cx.measureText(h.label).width + 16;
      const bx = Math.min(mouse.x + 14, cw - tw - 4), by = Math.max(4, mouse.y - 30);
      cx.fillStyle = 'rgba(12,20,26,0.92)'; cx.fillRect(bx, by, tw, 24);
      cx.fillStyle = '#e8f1f4'; cx.textAlign = 'left'; cx.textBaseline = 'middle'; cx.fillText(h.label, bx + 8, by + 12);
    }
  }

  function pick(x, y) {
    for (let i = hot.length - 1; i >= 0; i--) { const h = hot[i]; if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h; }
    return null;
  }

  TO.Office = {
    init(canvas, hs) {
      cv = canvas; cx = cv.getContext('2d'); handlers = hs;
      const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      cv.addEventListener('pointermove', e => { mouse = pos(e); });
      cv.addEventListener('pointerleave', () => { mouse = null; });
      cv.addEventListener('click', e => {
        const p = pos(e), h = pick(p.x, p.y);
        if (h && handlers[h.kind]) handlers[h.kind](h.id);
      });
      fit();
    },
    draw,
    wave(desks) { const now = performance.now(); desks.forEach((d, i) => waves.push({ desk: d, start: now + i * 140 })); },
    focusDesk(n) { focus = { n, until: performance.now() + 3500 }; },
  };
})(globalThis.TO = globalThis.TO || {});
