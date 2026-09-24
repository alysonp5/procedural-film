/*
 * play.js : the playable mode. A viewer takes the controller from the film (docs/playable.md).
 *
 *   ENTER (or the touch pad's START, or START on a gamepad)   take the controller: a fresh console
 *                                                              (FILM.game.create) at the title screen
 *   ESC (or the touch pad's FILM)                              give it back: the film resumes
 *   I                                                          the NES controller input display (the
 *                                                              film shows the recorded tape's buttons)
 *
 * Controls in the playable mode: arrows or WASD move, Z or K is A (jump), X or J is B (run),
 * ENTER is START, SHIFT is SELECT. A gamepad with the standard mapping: D-pad or left stick, the
 * right and top face buttons are A, the bottom and left ones B, START and SELECT (back). A phone or
 * tablet gets a translucent pad: D-pad left, B and A right, SELECT, START and FILM between them.
 *
 * The console steps at exactly 60 Hz from a fixed-timestep accumulator on the animation-frame clock,
 * whatever the display's refresh; a stall is caught up by at most MAX_CATCHUP steps and the rest is
 * dropped, so the game never runs fast to make up time. Each animation frame that stepped draws the
 * console into FILM.native() and puts it on the TV through FILM.player.api.present(), at
 * FILM.crt.settledFrame() with the film's baked overlays off. Sound is the
 * film's own driver and chip generated live (FILM.audio.live), fed every step's events.
 *
 * Only the player's hooks are used (src/player.js): onMount, onKey, onFrame. Nothing here runs with
 * ?render=1. FILM.player.live exposes read-only stats (steps, frame, rate, buttons) for tools.
 */
(function () {
  'use strict';

  const FILM = window.FILM;
  if (!FILM) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get('render') === '1') return;
  const player = (FILM.player = FILM.player || {});

  const STEP_MS = 1000 / 60; // one console frame
  const TOL_MS = 2; // animation-frame jitter absorbed without a skipped or doubled step
  const MAX_CATCHUP = 5; // most steps one animation frame may run: full speed down to 12 drawn frames/s
  const MAX_GAP_MS = 250; // a longer gap (a hidden tab) is not caught up at all

  const KEYS = {
    ArrowUp: 'UP', KeyW: 'UP',
    ArrowDown: 'DOWN', KeyS: 'DOWN',
    ArrowLeft: 'LEFT', KeyA: 'LEFT',
    ArrowRight: 'RIGHT', KeyD: 'RIGHT',
    KeyZ: 'A', KeyK: 'A',
    KeyX: 'B', KeyJ: 'B',
    Enter: 'START', NumpadEnter: 'START',
    ShiftLeft: 'SELECT', ShiftRight: 'SELECT',
  };
  const LIVE_HELP = '← → — move · Z — jump · X — run · ENTER — start · ESC — film';

  const S = {
    active: false,
    game: null,
    snd: null,
    actx: null,
    gain: null,
    keys: 0, // held keyboard buttons
    touch: 0, // held touch-pad buttons
    pad: 0, // held gamepad buttons
    padPrev: 0,
    latch: 0, // pressed since the last step: a tap shorter than a frame still reaches the console
    suppress: 0, // buttons held when the controller was taken: ignored until released
    buttons: 0, // what the console saw on its last step
    acc: 0,
    last: null,
    steps: 0,
    rafs: 0,
    rate: 0,
    rateT0: null,
    rateN0: 0,
    presented: '',
    wasPlaying: false,
    wasPowered: false,
    overlay: false,
    bakedInput: undefined, // FILM.crt.overlays.input before the chrome display hid it
    ui: null,
    api: null,
  };

  const BTN = () => (FILM.game && FILM.game.BUTTONS) || { A: 1, B: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128 };

  // ---------------------------------------------------------------------------------------------
  // The page: the input display (in the chrome's right slot) and the touch pad
  // ---------------------------------------------------------------------------------------------
  const CSS = [
    // the NES controller input display
    '#nes{display:none;align-items:center;gap:8px;pointer-events:none}',
    '#nes.on{display:flex}',
    '#nes .cap{font-size:9px;letter-spacing:.16em;color:#6d6a64}',
    '#nes .shell{width:122px;height:34px;box-sizing:border-box;padding:3px;border-radius:3px;background:#c4c2bd;box-shadow:inset 0 -2px 0 #9d9b96}',
    '#nes .face{position:relative;width:100%;height:100%;border-radius:2px;background:#17171a}',
    '#nes i{position:absolute;display:block;background:#2e2e33}',
    '#nes .v{left:11px;top:3px;width:8px;height:22px;border-radius:1px}',
    '#nes .h{left:4px;top:10px;width:22px;height:8px;border-radius:1px}',
    '#nes .u{left:11px;top:3px;width:8px;height:7px;background:none}',
    '#nes .d{left:11px;top:18px;width:8px;height:7px;background:none}',
    '#nes .l{left:4px;top:10px;width:7px;height:8px;background:none}',
    '#nes .r{left:19px;top:10px;width:7px;height:8px;background:none}',
    '#nes .mid{left:34px;top:7px;width:38px;height:14px;border-radius:2px;background:#8f8d88}',
    '#nes .se{left:38px;top:12px;width:13px;height:5px;border-radius:3px;background:#2e2e33}',
    '#nes .st{left:55px;top:12px;width:13px;height:5px;border-radius:3px;background:#2e2e33}',
    '#nes .bb,#nes .ba{top:6px;width:16px;height:16px;border-radius:2px;background:#bdbbb6}',
    '#nes .bb{left:78px}#nes .ba{left:96px}',
    '#nes .b,#nes .a{top:8px;width:12px;height:12px;border-radius:50%;background:#9c2a20}',
    '#nes .b{left:80px}#nes .a{left:98px}',
    '#nes i.lit{background:#f4f1ea;box-shadow:0 0 6px rgba(255,248,230,.85)}',
    '#nes .b.lit,#nes .a.lit{background:#ff5a45;box-shadow:0 0 7px rgba(255,90,69,.95)}',
    // the touch pad (phones and tablets only)
    '#pad{flex:none;box-sizing:border-box;width:100%;max-width:520px;height:196px;padding:8px 18px 22px;display:flex;',
    'align-items:center;justify-content:space-between;touch-action:none;cursor:default;color:rgba(255,255,255,.62);',
    'font:600 11px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.12em}',
    '#pad *{touch-action:none}',
    '#pad .dpad{position:relative;width:124px;height:124px;flex:none}',
    '#pad .dpad>div{position:absolute}',
    '#pad .x{inset:0;background:rgba(255,255,255,.13);clip-path:polygon(34% 0,66% 0,66% 34%,100% 34%,100% 66%,66% 66%,66% 100%,34% 100%,34% 66%,0 66%,0 34%,34% 34%)}',
    '#pad .u{left:34%;top:0;width:32%;height:34%}',
    '#pad .d{left:34%;bottom:0;width:32%;height:34%}',
    '#pad .l{left:0;top:34%;width:34%;height:32%}',
    '#pad .r{right:0;top:34%;width:34%;height:32%}',
    '#pad .dpad>div.lit{background:rgba(255,255,255,.34)}',
    '#pad .mid{display:flex;flex-direction:column;align-items:center;gap:12px}',
    '#pad .pill{width:62px;height:24px;border-radius:12px;display:flex;align-items:center;justify-content:center;',
    'background:rgba(255,255,255,.11);border:1px solid rgba(255,255,255,.2);font-size:9px}',
    '#pad .pill.lit{background:rgba(255,255,255,.34)}',
    '#pad .exit{display:none}',
    'body.live #pad .exit{display:flex}',
    '#pad .ab{display:flex;align-items:flex-end;gap:14px;flex:none}',
    '#pad .btn{width:58px;height:58px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
    'background:rgba(214,64,52,.24);border:1.5px solid rgba(255,120,100,.42);font-size:17px;letter-spacing:0}',
    '#pad .btn.a{margin-bottom:30px}',
    '#pad .btn.lit{background:rgba(236,72,56,.62)}',
    'body.touch #chrome>#help{flex:1 1 0}',
    'body.touch #chrome>#slot{flex:0 0 auto}',
    'body.live #bar{display:none}',
    // landscape: the pad moves off the page flow and sits over the TV's side edges
    '@media (orientation: landscape){',
    '#pad{position:fixed;left:0;top:0;right:0;bottom:0;width:auto;max-width:none;height:auto;padding:0;display:block;pointer-events:none}',
    '#pad .dpad,#pad .ab,#pad .mid{position:fixed;pointer-events:auto}',
    // sized to fit the side margins a 16:9 TV leaves on a phone held sideways (about 110 px)
    '#pad .dpad{left:4px;bottom:56px;width:104px;height:104px}',
    '#pad .ab{right:6px;bottom:56px;gap:4px}',
    '#pad .btn{width:50px;height:50px;font-size:15px}',
    '#pad .btn.a{margin-bottom:26px}',
    '#pad .mid{left:50%;bottom:8px;transform:translateX(-50%);flex-direction:row;gap:10px}',
    'body.touch #chrome>#help{flex:0 1 auto;text-align:left}',
    '}',
  ].join('');

  function el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function buildUI(api) {
    if (S.ui) return S.ui;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const ui = { nes: null, nesCap: null, nesLit: {}, nesMask: -1, pad: null, padLit: {}, padMask: -1 };

    // the input display: an NES controller in the chrome, lit by the buttons held on this frame
    const slot = api.chrome && api.chrome.slot;
    if (slot) {
      const nes = el('div', '', slot);
      nes.id = 'nes';
      ui.nesCap = el('span', 'cap', nes, 'TAPE');
      const face = el('div', 'face', el('div', 'shell', nes));
      for (const c of ['v', 'h', 'u', 'd', 'l', 'r', 'mid', 'se', 'st', 'bb', 'ba', 'b', 'a']) {
        const i = el('i', c, face);
        const name = { u: 'UP', d: 'DOWN', l: 'LEFT', r: 'RIGHT', se: 'SELECT', st: 'START', b: 'B', a: 'A' }[c];
        if (name) ui.nesLit[name] = i;
      }
      ui.nes = nes;
    }

    // the touch pad
    if (api.touch) {
      const pad = el('div', '');
      pad.id = 'pad';
      pad.setAttribute('data-pad', '');
      const dpad = el('div', 'dpad', pad);
      dpad.setAttribute('data-dpad', '');
      el('div', 'x', dpad);
      for (const [c, name] of [['u', 'UP'], ['d', 'DOWN'], ['l', 'LEFT'], ['r', 'RIGHT']]) ui.padLit[name] = el('div', c, dpad);
      const mid = el('div', 'mid', pad);
      for (const name of ['SELECT', 'START']) {
        const p = el('div', 'pill', mid, name);
        p.setAttribute('data-btn', name);
        ui.padLit[name] = p;
      }
      const exit = el('div', 'pill exit', mid, 'FILM');
      exit.setAttribute('data-act', 'exit');
      const ab = el('div', 'ab', pad);
      for (const name of ['B', 'A']) {
        const b = el('div', 'btn ' + name.toLowerCase(), ab, name);
        b.setAttribute('data-btn', name);
        ui.padLit[name] = b;
      }
      // after the chrome, so in portrait the pad sits under the TV and its status line
      const chrome = api.chrome && api.chrome.root;
      if (chrome && chrome.parentNode) chrome.parentNode.insertBefore(pad, chrome.nextSibling);
      else document.body.appendChild(pad);
      ui.pad = pad;
      bindTouch(pad, api);
    }
    S.ui = ui;
    return ui;
  }

  function light(map, mask, prev) {
    const B = BTN();
    for (const name in map) {
      const on = (mask & B[name]) !== 0;
      if (prev < 0 || on !== ((prev & B[name]) !== 0)) map[name].classList.toggle('lit', on);
    }
  }
  function showInputs(mask, live) {
    const ui = S.ui;
    if (!ui || !ui.nes || !S.overlay) return;
    const cap = live ? 'YOU' : 'TAPE';
    if (ui.nesCap.textContent !== cap) ui.nesCap.textContent = cap;
    if (mask !== ui.nesMask) {
      light(ui.nesLit, mask, ui.nesMask);
      ui.nesMask = mask;
    }
  }
  // While the chrome's input display shows, the film's baked pad (FILM.crt.overlays.input) is off so the
  // two never double up; hiding the chrome display restores what was there before.
  function toggleOverlay() {
    S.overlay = !S.overlay;
    if (S.ui && S.ui.nes) {
      S.ui.nes.classList.toggle('on', S.overlay);
      S.ui.nesMask = -1;
    }
    const ov = FILM.crt && FILM.crt.overlays;
    if (ov) {
      if (S.overlay) {
        S.bakedInput = ov.input;
        ov.input = false;
      } else if (S.bakedInput !== undefined) {
        ov.input = S.bakedInput;
        S.bakedInput = undefined;
      }
    }
    if (!S.active && S.api && !S.api.playing) S.api.redraw(); // a paused film shows the change at once
  }

  // ---------------------------------------------------------------------------------------------
  // Sound: the film's driver and chip, generated as the console plays
  // ---------------------------------------------------------------------------------------------
  function startSound(api) {
    if (!FILM.audio || typeof FILM.audio.live !== 'function') return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      if (!S.actx) {
        S.actx = new AC({ latencyHint: 'interactive' });
        S.gain = S.actx.createGain();
        S.gain.connect(S.actx.destination);
      }
      if (S.actx.state === 'suspended') S.actx.resume();
      S.gain.gain.value = api.muted ? 0 : 1;
      S.snd = FILM.audio.live(S.actx, { song: 'title', dest: S.gain });
    } catch (e) {
      S.snd = null;
      if (window.console) console.error('FILM.audio.live failed', e);
    }
  }
  function stopSound() {
    if (S.snd) S.snd.stop();
    S.snd = null;
    if (S.actx && S.actx.state === 'running') S.actx.suspend();
  }
  // A context made outside a gesture (a gamepad's START, a touch-down) starts suspended; the next
  // gesture of any kind lets it run.
  const wake = () => {
    if (S.active && S.actx && S.actx.state === 'suspended' && !document.hidden) S.actx.resume();
  };
  for (const type of ['pointerup', 'touchend', 'keydown', 'click']) window.addEventListener(type, wake, true);

  // ---------------------------------------------------------------------------------------------
  // Taking and giving back the controller
  // ---------------------------------------------------------------------------------------------
  function enter(api, held) {
    if (S.active || !FILM.game || typeof FILM.game.create !== 'function') return;
    S.wasPlaying = api.playing;
    const wasPowered = api.powered;
    api.pause();
    S.game = FILM.game.create({});
    S.active = true;
    S.suppress = held | 0;
    S.latch = 0;
    S.buttons = 0;
    S.acc = 0;
    S.last = null;
    S.presented = '';
    S.rateT0 = null;
    S.wasPowered = wasPowered;
    document.body.classList.add('live');
    startSound(api);
    api.setHelp(api.touch ? '' : LIVE_HELP);
  }
  function exit(api) {
    if (!S.active) return;
    S.active = false;
    stopSound();
    S.game = null;
    S.keys = 0;
    S.latch = 0;
    S.buttons = 0;
    document.body.classList.remove('live');
    api.setHelp(null);
    if (S.wasPlaying || !S.wasPowered) api.play();
    api.redraw();
  }

  // ---------------------------------------------------------------------------------------------
  // Inputs
  // ---------------------------------------------------------------------------------------------
  function onKey(e, api) {
    const down = e.type === 'keydown';
    const code = e.code;
    const name = KEYS[code];
    if (!down && name) S.keys &= ~BTN()[name]; // a release always lands, whatever else is held
    if (e.metaKey || e.ctrlKey || e.altKey) return false; // browser shortcuts stay the browser's
    if (!S.active) {
      if (down && (code === 'Enter' || code === 'NumpadEnter')) {
        if (!e.repeat) enter(api, 0);
        return true;
      }
      if (code === 'KeyI') {
        if (down && !e.repeat) toggleOverlay();
        return true;
      }
      return false;
    }
    if (code === 'Escape') {
      if (down) exit(api);
      return true;
    }
    if (code === 'KeyC' || code === 'KeyF' || code === 'KeyM') return false; // the player's own keys
    if (code === 'KeyI') {
      if (down && !e.repeat) toggleOverlay();
      return true;
    }
    if (name) {
      const b = BTN()[name];
      if (down && !e.repeat) {
        S.keys |= b;
        S.latch |= b;
      }
      return true;
    }
    return code === 'Space'; // never the film's play/pause while the viewer holds the controller
  }

  // The standard mapping (w3c gamepad): 0 bottom, 1 right, 2 left, 3 top face button, 8 back/select,
  // 9 start, 12-15 the D-pad. The NES has B left of A: the bottom and left buttons are B, the right
  // and top ones A, as Nintendo's own NES collections map a modern pad.
  function pollGamepads() {
    let list = null;
    try {
      list = navigator.getGamepads ? navigator.getGamepads() : null;
    } catch (e) {
      list = null;
    }
    const B = BTN();
    let m = 0;
    if (list) {
      for (const gp of list) {
        if (!gp || gp.connected === false) continue;
        const on = (i) => {
          const b = gp.buttons[i];
          return !!b && (b.pressed || b.value > 0.5);
        };
        if (on(12)) m |= B.UP;
        if (on(13)) m |= B.DOWN;
        if (on(14)) m |= B.LEFT;
        if (on(15)) m |= B.RIGHT;
        if (on(1) || on(3)) m |= B.A;
        if (on(0) || on(2)) m |= B.B;
        if (on(9)) m |= B.START;
        if (on(8)) m |= B.SELECT;
        const ax = gp.axes[0] || 0;
        const ay = gp.axes[1] || 0;
        if (ax < -0.5) m |= B.LEFT;
        if (ax > 0.5) m |= B.RIGHT;
        if (ay < -0.5) m |= B.UP;
        if (ay > 0.5) m |= B.DOWN;
      }
    }
    const pressed = m & ~S.padPrev;
    S.padPrev = m;
    S.pad = m;
    if (S.active) S.latch |= pressed;
    return pressed;
  }

  // Touch: every finger is tracked on its own. A finger that lands on the D-pad keeps steering it
  // (8 ways from the pad's centre) wherever it slides; a finger on a button can roll onto the next.
  function bindTouch(pad, api) {
    const fingers = new Map(); // pointerId -> { dpad: bool, mask }
    const B = BTN();
    const dpadEl = pad.querySelector('[data-dpad]');
    function dpadMask(x, y) {
      const r = dpadEl.getBoundingClientRect();
      const dx = x - (r.left + r.width / 2);
      const dy = y - (r.top + r.height / 2);
      const dead = r.width * 0.1;
      if (Math.hypot(dx, dy) < dead) return 0;
      let m = 0;
      const t = 0.4142; // tan 22.5 degrees: eight equal sectors
      if (Math.abs(dx) > Math.abs(dy) * t) m |= dx < 0 ? B.LEFT : B.RIGHT;
      if (Math.abs(dy) > Math.abs(dx) * t) m |= dy < 0 ? B.UP : B.DOWN;
      return m;
    }
    function buttonAt(x, y) {
      const hit = document.elementFromPoint(x, y);
      const b = hit && hit.closest ? hit.closest('[data-btn]') : null;
      return b ? B[b.getAttribute('data-btn')] || 0 : 0;
    }
    function update() {
      let m = 0;
      for (const f of fingers.values()) m |= f.mask;
      const pressed = m & ~S.touch;
      S.touch = m;
      if (S.active) S.latch |= pressed;
      if (S.ui) {
        light(S.ui.padLit, m, S.ui.padMask);
        S.ui.padMask = m;
      }
      if (!S.active && pressed & B.START) enter(api, m);
    }
    pad.addEventListener('pointerdown', (e) => {
      const onDpad = !!(e.target.closest && e.target.closest('[data-dpad]'));
      const onBtn = !!(e.target.closest && e.target.closest('[data-btn]'));
      if (!onDpad && !onBtn) return;
      e.preventDefault();
      fingers.set(e.pointerId, { dpad: onDpad, mask: onDpad ? dpadMask(e.clientX, e.clientY) : buttonAt(e.clientX, e.clientY) });
      update();
    });
    pad.addEventListener('pointermove', (e) => {
      const f = fingers.get(e.pointerId);
      if (!f) return;
      e.preventDefault();
      const m = f.dpad ? dpadMask(e.clientX, e.clientY) : buttonAt(e.clientX, e.clientY);
      if (m !== f.mask) {
        f.mask = m;
        update();
      }
    });
    const lift = (e) => {
      if (fingers.delete(e.pointerId)) update();
    };
    pad.addEventListener('pointerup', lift);
    pad.addEventListener('pointercancel', lift);
    pad.addEventListener('lostpointercapture', lift);
    pad.addEventListener('contextmenu', (e) => e.preventDefault());
    pad.addEventListener('click', (e) => {
      const act = e.target.closest ? e.target.closest('[data-act]') : null;
      if (act && act.getAttribute('data-act') === 'exit') exit(api);
    });
  }

  window.addEventListener('blur', () => {
    S.keys = 0;
  });
  document.addEventListener('visibilitychange', () => {
    if (!S.active || !S.actx) return;
    if (document.hidden) {
      if (S.actx.state === 'running') S.actx.suspend();
    } else {
      S.last = null; // no catch-up for the time away
      if (S.actx.state === 'suspended') S.actx.resume();
    }
  });

  // ---------------------------------------------------------------------------------------------
  // The live console: fixed 60 Hz steps, drawn once per animation frame
  // ---------------------------------------------------------------------------------------------
  function stepOnce() {
    const B = BTN();
    const raw = S.keys | S.touch | S.pad | S.latch;
    S.latch = 0;
    S.suppress &= raw;
    let m = raw & ~S.suppress;
    // a real D-pad cannot press opposite directions together
    if ((m & (B.LEFT | B.RIGHT)) === (B.LEFT | B.RIGHT)) m &= ~(B.LEFT | B.RIGHT);
    if ((m & (B.UP | B.DOWN)) === (B.UP | B.DOWN)) m &= ~(B.UP | B.DOWN);
    S.buttons = m;
    const ev = S.game.step(m);
    S.steps++;
    if (S.snd && ev && ev.length) S.snd.events(ev);
  }

  // The TV shows the live console lit and filling the frame, whatever film frame was paused on: any
  // other film frame carries the film's camera (the wide shot of the set) and power state. The film's
  // baked proof layers stay off, since the live controller is not the film's tape.
  function tvFrame() {
    if (FILM.crt && typeof FILM.crt.settledFrame === 'function') return FILM.crt.settledFrame();
    const c = FILM.TIMELINE && FILM.TIMELINE.crt;
    return c && c.powerOn ? c.powerOn[1] : 0;
  }

  function onFrame(stamp, api) {
    if (!S.ui) buildUI(api);
    const padPressed = pollGamepads();
    if (!S.active) {
      if (padPressed & BTN().START) enter(api, S.pad);
      else {
        if (S.overlay && FILM.game && typeof FILM.game.sim === 'function') {
          const sim = FILM.game.sim();
          const st = sim.states[Math.max(0, Math.min(sim.length - 1, api.frame))];
          showInputs(st ? st.btn | 0 : 0, false);
        }
        return false;
      }
    }
    S.rafs++;
    if (S.last == null) {
      S.last = stamp;
      S.acc = STEP_MS; // the first animation frame shows the first console frame
    } else {
      const dt = stamp - S.last;
      S.last = stamp;
      S.acc += dt > MAX_GAP_MS ? STEP_MS : dt;
    }
    let n = 0;
    while (S.acc >= STEP_MS - TOL_MS && n < MAX_CATCHUP) {
      stepOnce();
      S.acc -= STEP_MS;
      n++;
    }
    if (S.acc >= STEP_MS) S.acc = 0; // too far behind: drop the backlog rather than run fast later
    const nb = FILM.native();
    if (n) S.game.draw(nb.ctx);
    const out = FILM.ctx && FILM.ctx.canvas;
    const key = out ? `${out.width}x${out.height}:${FILM.crt ? FILM.crt.mode : ''}` : '';
    if (n || key !== S.presented) {
      api.present(tvFrame(), { overlays: false });
      S.presented = key;
    }
    if (S.gain) S.gain.gain.value = api.muted ? 0 : 1;
    if (S.rateT0 == null) {
      S.rateT0 = stamp;
      S.rateN0 = S.steps;
    } else if (stamp - S.rateT0 >= 1000) {
      S.rate = ((S.steps - S.rateN0) * 1000) / (stamp - S.rateT0);
      S.rateT0 = stamp;
      S.rateN0 = S.steps;
    }
    if (api.chrome && api.chrome.status) {
      api.chrome.status.textContent = `LIVE  f${S.game.frame}  ${S.rate ? S.rate.toFixed(1) : '--'} steps/s${api.muted ? '  muted' : ''}`;
    }
    showInputs(S.buttons, true);
    return true;
  }

  player.onMount = (api) => {
    S.api = api;
    buildUI(api);
  };
  player.onKey = onKey;
  player.onFrame = onFrame;
  player.live = Object.freeze({
    get active() {
      return S.active;
    },
    get game() {
      return S.game;
    },
    get steps() {
      return S.steps;
    },
    get frame() {
      return S.game ? S.game.frame : 0;
    },
    get rafs() {
      return S.rafs;
    },
    get rate() {
      return S.rate;
    },
    get buttons() {
      return S.buttons;
    },
    get overlay() {
      return S.overlay;
    },
    get audioState() {
      return S.actx ? S.actx.state : 'none';
    },
    get sound() {
      return S.snd ? S.snd.frame : 0;
    },
  });
})();
