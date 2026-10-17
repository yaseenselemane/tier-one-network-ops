// Sound effects and background music synthesised with WebAudio (no audio files), plus saved settings.
(function (TO) {
  'use strict';
  let ctx = null, on = true, hum = null, musicBus = null;
  const SKEY = 'tierone-settings';
  const cfg = { sfx: 0.8, music: 0.4, cb: false, text: 'normal' };
  try {
    on = localStorage.getItem('tierone-sound') !== 'off';
    Object.assign(cfg, JSON.parse(localStorage.getItem(SKEY) || '{}'));
  } catch (e) { /* storage blocked: defaults */ }

  function ac() {
    if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ctx = new A(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const sfxGain = () => (on ? cfg.sfx : 0);
  function tone(freq, dur, type = 'sine', vol = 0.12, when = 0, slide = 0) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(Math.max(0.0001, vol * sfxGain()), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol, freq) {
    const c = ac(); if (!c) return;
    const b = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'highpass'; f.frequency.value = freq; g.gain.value = vol * sfxGain();
    s.buffer = b; s.connect(f).connect(g).connect(c.destination); s.start();
  }
  const SFX = {
    click() { noise(0.05, 0.35, 2500); tone(2200, 0.03, 'square', 0.03); },
    unplug() { noise(0.06, 0.25, 1200); tone(500, 0.1, 'triangle', 0.06, 0, 220); },
    ticket() { tone(880, 0.1, 'sine', 0.07); tone(1320, 0.14, 'sine', 0.05, 0.09); },
    fixed() { [660, 880, 1320].forEach((f, i) => tone(f, 0.16, 'sine', 0.08, i * 0.07)); },
    step() { tone(990, 0.08, 'sine', 0.06); tone(1480, 0.1, 'sine', 0.05, 0.06); },
    alert() { tone(560, 0.12, 'square', 0.04); tone(560, 0.12, 'square', 0.04, 0.18); },
    alarm() { for (let i = 0; i < 3; i++) tone(920, 0.2, 'sawtooth', 0.05, i * 0.26, 460); },
    levelup() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.08, i * 0.08)); },
    buy() { tone(1200, 0.07, 'square', 0.04); tone(1800, 0.12, 'square', 0.04, 0.07); },
    key() { tone(1700 + Math.random() * 500, 0.012, 'square', 0.012); },
    error() { tone(180, 0.18, 'square', 0.05); },
    dayend() { [392, 494, 587].forEach(f => tone(f, 0.8, 'sine', 0.05)); },
    chat() { tone(1500, 0.05, 'sine', 0.04); },
    restored() { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, 'triangle', 0.07, i * 0.09)); },
  };
  function setHum(want) {
    const c = want && on ? ac() : ctx;
    if (!c) return;
    if (want && on && !hum) {
      const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3; }
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = b; s.loop = true; f.type = 'lowpass'; f.frequency.value = 400; g.gain.value = 0.05 * cfg.sfx;
      s.connect(f).connect(g).connect(c.destination); s.start();
      hum = { s, g };
    } else if ((!want || !on) && hum) { hum.s.stop(); hum = null; }
  }

  // ---------- music: a lo-fi loop that turns tense under attack ----------
  const CHORDS = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]];
  const PENTA = [69, 72, 74, 76, 79];
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const music = { running: false, timer: null, next: 0, bar: 0, mood: 'calm' };
  function mnote(m, t, dur, type, gain, lp) {
    const c = ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = hz(m);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + Math.min(0.25, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); node = f; }
    node.connect(g).connect(musicBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function mhat(t, vol) {
    const c = ctx, len = Math.floor(c.sampleRate * 0.04), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'highpass'; f.frequency.value = 7000; g.gain.value = vol;
    s.buffer = b; s.connect(f).connect(g).connect(musicBus); s.start(t);
  }
  function scheduleBar(t) {
    const tense = music.mood === 'tense', beat = 60 / (tense ? 104 : 72), ch = CHORDS[music.bar % 4];
    if (!tense) {
      ch.forEach(m => mnote(m, t, beat * 4, 'triangle', 0.05, 1400));
      mnote(ch[0] - 24, t, beat * 1.8, 'sine', 0.16); mnote(ch[0] - 24, t + beat * 2, beat * 1.6, 'sine', 0.13);
      for (let i = 0; i < 8; i++) mhat(t + i * beat / 2, i % 2 ? 0.05 : 0.025);
      for (let i = 0; i < 4; i++) if (Math.random() < 0.45) mnote(PENTA[Math.floor(Math.random() * PENTA.length)], t + i * beat + (Math.random() < 0.3 ? beat / 2 : 0), beat * 0.9, 'sine', 0.05, 2400);
    } else {
      ch.forEach(m => mnote(m - 12, t, beat * 4, 'sawtooth', 0.025, 500));
      for (let i = 0; i < 4; i++) mnote(ch[0] - 24, t + i * beat, beat * 0.6, 'square', 0.12, 260);
      for (let i = 0; i < 16; i++) mhat(t + i * beat / 4, i % 4 === 2 ? 0.06 : 0.025);
      mnote(ch[0] + 6, t + beat * 3, beat * 0.9, 'sawtooth', 0.04, 900);
    }
    music.bar++;
    return beat * 4;
  }
  function tick() {
    if (!ctx || !music.running) return;
    while (music.next < ctx.currentTime + 0.4) { if (music.next < ctx.currentTime) music.next = ctx.currentTime + 0.05; music.next += scheduleBar(music.next); }
  }
  function applyMusicVol() { if (musicBus) musicBus.gain.value = on ? cfg.music * 0.8 : 0; }

  const Audio_ = {
    play(name) { if (!on || !SFX[name]) return; try { SFX[name](); } catch (e) { /* audio unavailable */ } },
    setOn(v) { on = v; try { localStorage.setItem('tierone-sound', v ? 'on' : 'off'); } catch (e) { /* ignore */ } if (!v) setHum(false); applyMusicVol(); },
    isOn: () => on,
    hum: setHum,
    unlock: ac,
    music: {
      start() {
        const c = ac(); if (!c || music.running) return;
        if (!musicBus) { musicBus = c.createGain(); musicBus.connect(c.destination); }
        applyMusicVol();
        music.running = true; music.next = c.currentTime + 0.1;
        music.timer = setInterval(tick, 120);
      },
      stop() { music.running = false; clearInterval(music.timer); },
      mood(m) { music.mood = m; },
      vol: applyMusicVol,
    },
  };
  TO.Audio = Audio_;

  function apply() {
    document.documentElement.classList.toggle('cb', !!cfg.cb);
    document.documentElement.style.zoom = { normal: 1, large: 1.15, xlarge: 1.3 }[cfg.text] || 1;
    applyMusicVol();
  }
  TO.Settings = {
    get: () => cfg,
    set(p) { Object.assign(cfg, p); try { localStorage.setItem(SKEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } apply(); },
    apply,
    cb: () => cfg.cb,
  };
  if (typeof document !== 'undefined') apply();
})(globalThis.TO = globalThis.TO || {});
