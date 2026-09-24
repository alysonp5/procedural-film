#!/usr/bin/env node
// tools/e2e/run.cjs : T8 end-to-end tests (docs/game-spec.md 13.8). Owner: P7.
//
//   node tools/e2e/run.cjs                          serves web/ with tools/e2e/serve.cjs and tests it
//   node tools/e2e/run.cjs https://<name>.vercel.app  tests the deployed site (production e2e)
//   options: --only PW3,PW7   --profiles desktop,pixel7,iphone   --gl gpu|swiftshader (default gpu)
//            --site https://<name>.vercel.app   the host the share meta must name (PW13); default: the URL
//            under test when it is a *.vercel.app origin, else https://claude-quest-nu.vercel.app
//
// Chromium desktop 1280x720, Chromium with Pixel 7 emulation and an iPhone-sized Chromium viewport
// (390x844, touch). No WebKit (15.1). Every test runs in a fresh browser context (fresh storage) and
// fails on any console error, page error or CSP violation, besides its own assertions.
// Claims about the engine (a jump, a pause holding lv.t) are proven by replaying the console's own
// recorded tape (FILM.shell.proof.record()) through the Node harness and matching its fingerprint.
'use strict';

const path = require('path');
const zlib = require('zlib');
const E = require('./lib.cjs');
const PNG = require('../png.cjs');
const { SITE_RE, DEFAULT_SITE } = require('../site.cjs');

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const ONLY = opt('only', null) ? opt('only').split(',') : null;
const PROFILE_LIST = opt('profiles', 'desktop,pixel7,iphone').split(',');
const GL = opt('gl', 'gpu');

const B = { A: 1, B: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128 };

class Fail extends Error {}
function ok(cond, msg) {
  if (!cond) throw new Fail(msg);
}

// start a game from the title with a key press, then wait for play
async function newQuest(t) {
  await t.key('Enter');
  await t.until(() => FILM.shell.stats.state === 'game' && FILM.shell.stats.mode === 'play', null, 6000);
}

// ------------------------------------------------------------------------------------------------ tests
// Each: { id, name, profiles, query, run(t, ctx) -> detail string }
const TESTS = [
  {
    id: 'PW1',
    name: 'no errors; only the document (and /favicon.ico); CSP meta present, no violations',
    profiles: ['desktop', 'pixel7', 'iphone'],
    async run(t) {
      await t.goto('');
      await t.title();
      await t.steps(120);
      const meta = await t.page.evaluate(() => {
        const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        return m ? m.getAttribute('content') : null;
      });
      ok(meta && meta.startsWith("default-src 'none'; script-src 'sha256-"), 'CSP meta missing or malformed');
      const nScripts = await t.page.evaluate(() => document.scripts.length);
      const nHashes = (meta.match(/'sha256-/g) || []).length;
      ok(nHashes === nScripts, `CSP lists ${nHashes} hashes for ${nScripts} scripts`);
      const origin = new URL(t.url).origin;
      const other = t.requests.filter((u) => {
        const x = new URL(u);
        return !(x.origin === origin && (x.pathname === '/' || x.pathname === '/favicon.ico'));
      });
      ok(other.length === 0, `unexpected requests: ${other.join(', ')}`);
      const h = t.docHeaders || {};
      ok(h['x-content-type-options'] === 'nosniff' && h['referrer-policy'] === 'no-referrer' && /frame-ancestors 'none'/.test(h['content-security-policy'] || ''),
        `document headers missing vercel.json values: ${JSON.stringify(h)}`);
      return `${nHashes} script hashes; requests: ${t.requests.map((u) => new URL(u).pathname).join(' ')}; headers nosniff, no-referrer, frame-ancestors 'none'`;
    },
  },
  {
    id: 'PW2',
    name: 'the title is presented within the budget (FCP <= 1000 ms); stats.state is title',
    profiles: ['desktop', 'pixel7', 'iphone'],
    async run(t) {
      await t.goto('?proof=1');
      await t.title();
      await t.steps(10);
      const r = await t.page.evaluate(() => {
        const fcp = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint');
        return { fcp: fcp ? fcp.startTime : null, state: FILM.shell.stats.state };
      });
      ok(r.state === 'title', `state ${r.state}`);
      ok(r.fcp != null && r.fcp <= 1000, `first contentful paint ${r.fcp} ms (budget 1000)`);
      return `first contentful paint ${r.fcp.toFixed(0)} ms, backend ${(await t.stats()).backend}`;
    },
  },
  {
    id: 'PW3',
    name: 'Enter starts NEW QUEST in play within 3 s; RIGHT for 120 frames moves right; Z emits jump',
    profiles: ['desktop'],
    async run(t) {
      await t.goto();
      await t.title();
      const t0 = Date.now();
      await t.key('Enter');
      await t.until(() => FILM.shell.stats.mode === 'play', null, 3000);
      const ms = Date.now() - t0;
      // a standing jump first (the first bug walks in soon after), then RIGHT for 120 frames
      await t.key('KeyZ', 12);
      await t.steps(50);
      const x0 = (await t.snap()).x;
      await t.page.keyboard.down('ArrowRight');
      await t.steps(120);
      const x1 = (await t.snap()).x;
      await t.page.keyboard.up('ArrowRight');
      await t.steps(2);
      ok(x1 > x0 + 60, `x ${x0} -> ${x1} after 120 frames of RIGHT`);
      const rec = await t.page.evaluate(() => FILM.shell.proof.record());
      const R = E.replay(rec);
      ok(R.fp === rec.fp, `Node replay fp ${R.fp} differs from the page's ${rec.fp}`);
      const jumps = R.events.filter((e) => e.type === 'jump');
      ok(jumps.length >= 1, `no jump event after Z; events: ${R.events.map((e) => e.i + ':' + e.type).slice(-25).join(' ')}; A frames ${R.frames.map((f, i) => (f.b & B.A ? i : -1)).filter((i) => i >= 0).slice(0, 5)}`);
      const zFrame = R.frames.findIndex((f, i) => i > 0 && (f.b & B.A) && !(R.frames[i - 1].b & B.A));
      ok(jumps.some((e) => e.i >= zFrame && e.i <= zFrame + 2), `jump at ${jumps.map((e) => e.i)} not on Z press ${zFrame}`);
      return `play ${ms} ms after Enter; x ${x0.toFixed(1)} -> ${x1.toFixed(1)}; jump on frame ${jumps[0].i} (Z at ${zFrame}); replay fp ${R.fp} matches`;
    },
  },
  {
    id: 'PW4',
    name: 'after the first key the AudioContext runs and the audio frame advances',
    profiles: ['desktop', 'pixel7'],
    async run(t) {
      await t.goto();
      await t.title();
      const before = (await t.stats()).audio;
      ok(before === 'none', `an AudioContext existed before any gesture (${before})`);
      await t.page.evaluate(() => {
        const live = FILM.audio.live;
        FILM.audio.live = function () {
          const s = live.apply(this, arguments);
          window.__snd = s;
          return s;
        };
      });
      if (t.profile === 'desktop') await t.key('ArrowDown');
      else {
        const r = await t.rect('#tv');
        await t.touch(r.cx, r.cy, 2);
      }
      await t.until(() => FILM.shell.stats.audio === 'running' && window.__snd, null, 5000);
      const f0 = await t.page.evaluate(() => window.__snd.frame);
      await t.page.waitForTimeout(600);
      const f1 = await t.page.evaluate(() => window.__snd.frame);
      ok(f1 > f0 + 10, `audio frame ${f0} -> ${f1}`);
      return `audio ${before} -> running; driver frame ${f0} -> ${f1} in 600 ms`;
    },
  },
  {
    id: 'PW5',
    name: 'START pauses (lv.t holds 120 frames) and resumes; a hidden page pauses',
    profiles: ['desktop'],
    async run(t) {
      await t.goto();
      await t.title();
      await newQuest(t);
      await t.steps(30);
      await t.key('Enter');
      await t.until(() => FILM.shell.stats.state === 'paused' && FILM.shell.stats.mode === 'pause', null, 3000);
      const s0 = await t.snap();
      await t.steps(130);
      const s1 = await t.snap();
      ok(s0.x === s1.x && s0.y === s1.y, 'Claw\'d moved while paused');
      await t.key('Enter');
      await t.until(() => FILM.shell.stats.state === 'game' && FILM.shell.stats.mode === 'play', null, 3000);
      const rec = await t.page.evaluate(() => FILM.shell.proof.record());
      const R = E.replay(rec);
      ok(R.fp === rec.fp, `replay fp ${R.fp} vs ${rec.fp}`);
      const p0 = R.frames.findIndex((f) => f.mode === 'pause');
      let p1 = p0;
      while (p1 < R.frames.length && R.frames[p1].mode === 'pause') p1++;
      ok(p0 > 0 && p1 - p0 >= 120, `pause lasted ${p1 - p0} frames`);
      const held = R.frames.slice(p0, p1).every((f) => f.lvT === R.frames[p0].lvT);
      ok(held, 'lv.t changed during the pause');
      ok(R.events.some((e) => e.type === 'pause') && R.events.some((e) => e.type === 'unpause' && e.i >= p1 - 1), 'pause/unpause events missing');
      ok(R.frames[R.frames.length - 1].lvT > R.frames[p0].lvT, 'lv.t did not resume');
      // a hidden page pauses
      await t.steps(20);
      await t.page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await t.until(() => FILM.shell.stats.state === 'paused', null, 3000);
      await t.page.evaluate(() => {
        delete document.hidden;
        delete document.visibilityState;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await t.steps(30);
      ok((await t.stats()).state === 'paused', 'the game resumed by itself after the page came back');
      return `paused ${p1 - p0} frames with lv.t held at ${R.frames[p0].lvT}; unpause resumed; hidden page paused and stayed paused`;
    },
  },
  {
    id: 'PW6',
    name: 'feed(full.modern) with fast(8) reaches the credits; after a reload HI-SCORE is the score, CONTINUE enabled',
    profiles: ['desktop'],
    timeout: 300000,
    async run(t) {
      await t.goto();
      await t.title();
      const tape = E.tape('full.modern');
      const r = await t.page.evaluate(async (tp) => {
        FILM.shell.proof.fast(8);
        const res = await FILM.shell.proof.feed(tp);
        FILM.shell.proof.fast(0);
        return res;
      }, tape);
      ok(r.match === true, `fp ${r.fp} vs tape ${tape.fp}`);
      ok(r.mode === 'credits', `ended in ${r.mode}`);
      ok(r.score > 0, 'no score');
      await t.steps(30);
      await t.goto();
      await t.title();
      const after = await t.page.evaluate(() => {
        const save = JSON.parse(localStorage.getItem('claude-quest.save.v1'));
        const M = FILM.__cq.menu;
        const rows = M.items(M.init('title', { save }), { save });
        return { save, top: FILM.shell.proof.snap().top, rows: rows.map((x) => ({ label: x.label || x.text || x.say, disabled: !!x.disabled })) };
      });
      ok(after.save.hi === r.score, `saved hi ${after.save.hi} vs run score ${r.score}`);
      ok(after.top === r.score, `title HI-SCORE ${after.top} vs ${r.score}`);
      ok(after.save.reach === '1-4' && after.save.cleared === true, `reach ${after.save.reach}, cleared ${after.save.cleared}`);
      const cont = after.rows.find((x) => /continue/i.test(String(x.label)));
      ok(cont && !cont.disabled, `CONTINUE row ${JSON.stringify(cont)}`);
      return `fed ${r.frames} frames, fp ${r.fp} matches, score ${r.score}, mode ${r.mode}; after reload hi ${after.save.hi}, reach ${after.save.reach}, CONTINUE enabled`;
    },
  },
  {
    id: 'PW7',
    name: 'touch: tapping START starts; holding the right sector moves; the AB zone gives mask 3',
    profiles: ['pixel7', 'iphone'],
    async run(t) {
      await t.goto();
      await t.title();
      const pad = await t.page.evaluate(() => {
        const q = (s) => {
          const e = document.querySelector(s);
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
        };
        return { start: q('[data-btn="START"]'), dpad: q('[data-dpad]'), a: q('[data-btn="A"]'), b: q('[data-btn="B"]'), tv: q('#tv'), vw: innerWidth, vh: innerHeight };
      });
      ok(pad.start && pad.dpad && pad.a && pad.b, 'the touch pad is missing');
      await t.touch(pad.start.cx, pad.start.cy, 4);
      await t.until(() => FILM.shell.stats.state === 'game' && FILM.shell.stats.mode === 'play', null, 6000);
      const x0 = (await t.snap()).x;
      await t.touchDown([[pad.dpad.cx + pad.dpad.w * 0.38, pad.dpad.cy]]);
      await t.steps(90);
      const held = (await t.stats()).buttons;
      await t.touchUp();
      await t.steps(20);
      const x1 = (await t.snap()).x;
      ok(held === B.RIGHT, `right sector gave mask ${held}`);
      ok(x1 > x0 + 40, `x ${x0} -> ${x1}`);
      const mx = (pad.a.cx + pad.b.cx) / 2, my = (pad.a.cy + pad.b.cy) / 2;
      await t.touchDown([[mx, my]]);
      await t.steps(6);
      const ab = (await t.stats()).buttons;
      await t.touchUp();
      ok(ab === (B.A | B.B), `AB zone gave mask ${ab}`);
      return `START tap -> play; right sector mask ${held}, x ${x0.toFixed(1)} -> ${x1.toFixed(1)}; AB zone mask ${ab}`;
    },
  },
  {
    id: 'PW8',
    name: 'a stubbed standard gamepad: button 9 starts; a disconnect pauses',
    profiles: ['desktop'],
    init: function () {
      const mk = () => ({
        id: 'e2e stub (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
        axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      });
      window.__pad = null;
      window.__mkPad = mk;
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__pad, null, null, null] });
    },
    async run(t) {
      await t.goto();
      await t.title();
      const press = async (i, hold) => {
        await t.page.evaluate((k) => {
          window.__pad.buttons[k] = { pressed: true, touched: true, value: 1 };
        }, i);
        await t.steps(hold);
        await t.page.evaluate((k) => {
          window.__pad.buttons[k] = { pressed: false, touched: false, value: 0 };
        }, i);
        await t.steps(3);
      };
      await t.page.evaluate(() => {
        window.__pad = window.__mkPad();
        window.dispatchEvent(new Event('gamepadconnected'));
      });
      await t.steps(5);
      await press(9, 4);
      await t.until(() => FILM.shell.stats.state === 'game' && FILM.shell.stats.mode === 'play', null, 6000);
      const x0 = (await t.snap()).x;
      await t.page.evaluate(() => (window.__pad.axes[0] = 1));
      await t.steps(60);
      await t.page.evaluate(() => (window.__pad.axes[0] = 0));
      await t.steps(20);
      const x1 = (await t.snap()).x;
      ok(x1 > x0 + 30, `stick right moved x ${x0} -> ${x1}`);
      await t.page.evaluate(() => {
        window.__pad = null;
        window.dispatchEvent(new Event('gamepaddisconnected'));
      });
      await t.until(() => FILM.shell.stats.state === 'paused', null, 3000);
      return `button 9 -> play; stick right x ${x0.toFixed(1)} -> ${x1.toFixed(1)}; disconnect -> paused`;
    },
  },
  {
    id: 'PW9',
    name: 'C toggles clean; WEBGL_lose_context falls back to clean; restoring brings webgl2 back',
    profiles: ['desktop'],
    async run(t) {
      await t.goto('?proof=1');
      await t.title();
      await t.until(() => FILM.shell.stats.backend === 'webgl2', null, 15000);
      await t.key('KeyC');
      await t.until(() => FILM.shell.stats.backend === 'clean', null, 3000);
      await t.key('KeyC');
      await t.until(() => FILM.shell.stats.backend === 'webgl2', null, 15000);
      const had = await t.page.evaluate(() => {
        const gl = FILM.crt.glContext();
        window.__lose = gl && gl.getExtension('WEBGL_lose_context');
        if (!window.__lose) return false;
        window.__lose.loseContext();
        return true;
      });
      ok(had, 'no WEBGL_lose_context');
      await t.until(() => FILM.shell.stats.backend === 'clean' && FILM.crt.lost === true, null, 5000);
      await t.steps(20);
      await t.page.evaluate(() => window.__lose.restoreContext());
      await t.until(() => FILM.shell.stats.backend === 'webgl2' && FILM.crt.lost === false, null, 15000);
      await t.steps(20);
      return 'crt -> clean -> webgl2; lost -> clean; restored -> webgl2';
    },
  },
  {
    id: 'PW10',
    name: 'idle(1080) shows DEMO; any key returns to the title without starting a game',
    profiles: ['desktop'],
    async run(t) {
      await t.goto();
      await t.title();
      await t.steps(5);
      ok(await t.page.evaluate(() => FILM.shell.proof.idle(1080)), 'idle() refused');
      await t.until(() => FILM.shell.stats.state === 'demo', null, 3000);
      // DEMO blinks at y 40: white ($30) pixels in its box on some frame of a blink cycle
      const seen = await t.page.evaluate(
        () =>
          new Promise((resolve) => {
            const L = FILM.lib;
            const hex = L.NES[0x30].toLowerCase();
            const want = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
            let n = 0, hits = 0;
            const tick = () => {
              const d = FILM.native().ctx.getImageData(140, 38, 40, 12).data;
              for (let i = 0; i < d.length; i += 4) if (d[i] === want[0] && d[i + 1] === want[1] && d[i + 2] === want[2]) hits++;
              if (++n < 70) requestAnimationFrame(tick);
              else resolve({ hits, state: FILM.shell.stats.state, mode: FILM.shell.stats.mode });
            };
            requestAnimationFrame(tick);
          })
      );
      ok(seen.hits > 0, 'no DEMO caption pixels');
      ok(seen.state === 'demo', `left the demo early (${seen.state})`);
      await t.key('KeyX');
      await t.until(() => FILM.shell.stats.state === 'title', null, 3000);
      await t.steps(60);
      const s = await t.stats();
      ok(s.state === 'title' && s.levelId === '', `after the key: state ${s.state}, level '${s.levelId}'`);
      return `demo shown (${seen.hits} caption pixels over 70 frames); key -> title, no game`;
    },
  },
  {
    id: 'PW11',
    name: 'remap A to KeyL, reload, L jumps; FLASHING REDUCED shows no backdrop flash across a star pickup',
    profiles: ['desktop'],
    timeout: 240000,
    async run(t) {
      await t.goto();
      await t.title();
      // title: NEW QUEST, CONTINUE (disabled), OPTIONS -> options: FEEL DISPLAY VOLUME INPUT FLASHING CONTROLS
      await t.key('ArrowDown');
      await t.key('Enter');
      await t.until(() => FILM.shell.stats.state === 'options', null, 3000);
      for (let i = 0; i < 5; i++) await t.key('ArrowDown');
      await t.key('Enter');
      await t.until(() => FILM.shell.stats.state === 'controls', null, 3000);
      for (let i = 0; i < 4; i++) await t.key('ArrowDown'); // UP DOWN LEFT RIGHT A
      await t.key('KeyZ'); // A: bind slot 1
      await t.key('KeyL');
      await t.steps(5);
      const keys = await t.page.evaluate(() => JSON.parse(localStorage.getItem('claude-quest.save.v1')).settings.keys);
      ok(keys.A[0] === 'KeyL', `A is bound to ${JSON.stringify(keys.A)}`);
      // back to options, set FLASHING to REDUCED (row 5), back to the title
      await t.key('Escape');
      await t.until(() => FILM.shell.stats.state === 'options', null, 3000);
      for (let i = 0; i < 1; i++) await t.key('ArrowUp'); // CONTROLS -> FLASHING
      await t.key('ArrowRight');
      await t.steps(5);
      const flash = await t.page.evaluate(() => JSON.parse(localStorage.getItem('claude-quest.save.v1')).settings.flash);
      ok(flash === 'reduced', `flash setting ${flash}`);
      // reload: the binding persists and L jumps
      await t.goto();
      await t.title();
      await newQuest(t);
      await t.steps(10);
      await t.key('KeyL', 10);
      await t.steps(30);
      const rec = await t.page.evaluate(() => FILM.shell.proof.record());
      const R = E.replay(rec);
      ok(R.fp === rec.fp, 'replay fp mismatch');
      ok(R.events.some((e) => e.type === 'jump'), 'L did not jump after the reload');
      // the star pickup: the recorded film tape on a live console takes the star at frame 1030, with a
      // two-frame white backdrop flash. Sample the backdrop (native 2,2 in the HUD band) every frame.
      const probe = async () =>
        t.page.evaluate(
          (rle) =>
            new Promise((resolve) => {
              const out = [];
              const tick = () => {
                const f = FILM.shell.stats.frame;
                if (f >= 950) FILM.shell.proof.fast(1);
                if (f >= 1015 && f <= 1045) {
                  const d = FILM.native().ctx.getImageData(2, 2, 1, 1).data;
                  out.push(f + ':' + d[0] + ',' + d[1] + ',' + d[2]);
                }
                if (f > 1045) return resolve(out);
                requestAnimationFrame(tick);
              };
              FILM.shell.proof.fast(16);
              FILM.shell.proof.feed({ opts: { start: '1-1', feel: 'nes' }, rle }).then(() => {});
              requestAnimationFrame(tick);
            }),
          (await t.page.evaluate(() => FILM.__cq.RECORDED.rle))
        );
      const reduced = await probe();
      const colours = new Set(reduced.map((s) => s.split(':')[1]));
      ok(reduced.length >= 25, `only ${reduced.length} samples`);
      ok(colours.size === 1, `backdrop changed with reduced flashing: ${[...colours].join(' | ')}`);
      // control: with full flashing the same probe sees the flash (so the probe can see one)
      // (through the options menu: the page's own pagehide write would undo a direct storage edit)
      await t.goto();
      await t.title();
      await t.key('ArrowDown');
      await t.key('Enter');
      await t.until(() => FILM.shell.stats.state === 'options', null, 3000);
      for (let i = 0; i < 4; i++) await t.key('ArrowDown'); // FEEL DISPLAY VOLUME INPUT FLASHING
      await t.key('ArrowRight');
      await t.key('Escape');
      await t.until(() => FILM.shell.stats.state === 'title', null, 3000);
      const back = await t.page.evaluate(() => JSON.parse(localStorage.getItem('claude-quest.save.v1')).settings.flash);
      ok(back === 'full', `flash setting ${back} for the control run`);
      const full = await probe();
      const fullColours = new Set(full.map((s) => s.split(':')[1]));
      ok(fullColours.size >= 2, `the control run saw no flash (${[...fullColours].join(' | ')})`);
      return `A -> ${keys.A.join('/')}; L jumps after reload; reduced: ${reduced.length} frames, backdrop ${[...colours][0]} throughout; full: ${fullColours.size} colours (flash seen)`;
    },
  },
  {
    id: 'PW12',
    name: '/film loads and powers on after a click',
    profiles: ['desktop', 'pixel7'],
    async run(t) {
      const resp = await t.goto('', '/film');
      ok(resp && resp.status() === 200, `/film status ${resp && resp.status()}`);
      await t.page.waitForFunction(() => window.FILM && FILM.player && FILM.player.api, null, { timeout: 20000 });
      const before = await t.page.evaluate(() => ({ powered: FILM.player.api.powered, playing: FILM.player.api.playing }));
      const r = await t.rect('canvas');
      if (t.profile === 'desktop') await t.page.mouse.click(r.cx, r.cy);
      else {
        await t.touchDown([[r.cx, r.cy]]);
        await t.page.waitForTimeout(80);
        await t.touchUp();
      }
      await t.page.waitForFunction(() => FILM.player.api.powered && FILM.player.api.playing && FILM.player.api.frame > 150, null, { timeout: 20000, polling: 100 });
      const after = await t.page.evaluate(() => ({ frame: FILM.player.api.frame, lit: FILM.crt.power(FILM.player.api.frame).lit, audio: FILM.player.api.audioState }));
      ok(after.lit, `the TV is not lit at frame ${after.frame}`);
      return `before: powered ${before.powered}; after the click: frame ${after.frame}, lit, audio ${after.audio}`;
    },
  },
  {
    id: 'PW13',
    name: '/og.png is 200 image/png 1200x630; /favicon.ico is 200; og and twitter meta name the production host',
    profiles: ['desktop'],
    async run(t, env) {
      await t.goto('');
      const base = t.url.replace(/\/$/, '');
      const og = await t.page.request.get(base + '/og.png');
      ok(og.status() === 200 && /^image\/png/.test(og.headers()['content-type'] || ''), `/og.png ${og.status()} ${og.headers()['content-type']}`);
      const info = PNG.info(await og.body());
      ok(info.width === 1200 && info.height === 630, `og.png ${info.width}x${info.height}`);
      const ico = await t.page.request.get(base + '/favicon.ico');
      ok(ico.status() === 200, `/favicon.ico ${ico.status()}`);
      const sizes = PNG.icoInfo(await ico.body()).map((e) => e.png.width).join('/');
      ok(sizes === '16/32/48', `favicon sizes ${sizes}`);
      const apple = await t.page.request.get(base + '/apple-touch-icon.png');
      ok(apple.status() === 200 && PNG.info(await apple.body()).width === 180, `/apple-touch-icon.png ${apple.status()}`);
      const meta = await t.page.evaluate(() => {
        const g = (sel) => (document.querySelector(sel) || {}).content || null;
        return { url: g('meta[property="og:url"]'), image: g('meta[property="og:image"]'), tw: g('meta[name="twitter:image"]') };
      });
      const site = env.site;
      ok(meta.url === site + '/' && meta.image === site + '/og.png' && meta.tw === site + '/og.png', `meta ${JSON.stringify(meta)} vs ${site}`);
      return `og.png 1200x630 image/png; favicon 16/32/48; apple-touch 180; meta -> ${site}`;
    },
  },
  {
    id: 'PW14',
    name: '60 +/- 0.5 steps per second over 10 s',
    profiles: ['desktop', 'pixel7'],
    timeout: 60000,
    async run(t) {
      await t.goto();
      await t.title();
      await newQuest(t);
      await t.steps(120); // past the warm-up
      const r = await t.page.evaluate(
        () =>
          new Promise((resolve) => {
            const s0 = FILM.shell.stats.steps;
            let t0 = null;
            let n0 = 0;
            const tick = (stamp) => {
              if (t0 === null) {
                t0 = stamp;
                n0 = FILM.shell.stats.steps;
              }
              if (stamp - t0 >= 10000) return resolve({ steps: FILM.shell.stats.steps - n0, ms: stamp - t0, s0 });
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          })
      );
      const rate = (r.steps * 1000) / r.ms;
      ok(Math.abs(rate - 60) <= 0.5, `${rate.toFixed(3)} steps/s`);
      return `${r.steps} steps in ${(r.ms / 1000).toFixed(3)} s = ${rate.toFixed(3)} steps/s`;
    },
  },
  {
    id: 'layout',
    name: 'phone layout: the TV and every pad control inside the viewport, every hit target at least 56 px',
    profiles: ['pixel7', 'iphone'],
    async run(t) {
      await t.goto();
      await t.title();
      const L = await t.page.evaluate(() => {
        const box = (e) => {
          const r = e.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height, name: e.getAttribute('data-btn') || e.getAttribute('data-act') || e.className || e.id };
        };
        const hits = Array.from(document.querySelectorAll('#pad [data-btn], #pad [data-act], #pad [data-dpad]')).map(box);
        return { vw: innerWidth, vh: innerHeight, tv: box(document.getElementById('tv')), hits };
      });
      const inside = (b) => b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= L.vw + 0.5 && b.y + b.h <= L.vh + 0.5;
      ok(inside(L.tv), `the TV ${JSON.stringify(L.tv)} leaves the ${L.vw}x${L.vh} viewport`);
      ok(L.hits.length >= 7, `${L.hits.length} pad controls`);
      for (const h of L.hits) {
        ok(inside(h), `${h.name} ${JSON.stringify(h)} leaves the viewport`);
        ok(Math.min(h.w, h.h) >= 56, `${h.name} is ${h.w.toFixed(0)}x${h.h.toFixed(0)} (< 56 px)`);
      }
      return `viewport ${L.vw}x${L.vh}; TV ${L.tv.w.toFixed(0)}x${L.tv.h.toFixed(0)}; ${L.hits.length} controls all inside, smallest ${Math.min(...L.hits.map((h) => Math.min(h.w, h.h))).toFixed(0)} px`;
    },
  },
];

// ------------------------------------------------------------------------------------------------ runner
async function main() {
  let url = positional[0] || null;
  let srv = null;
  if (!url) {
    const { serve } = require('./serve.cjs');
    srv = await serve({ port: 0 });
    url = srv.url;
  }
  const origin = new URL(url).origin;
  const site = opt('site', SITE_RE.test(origin) ? origin : DEFAULT_SITE);
  if (!SITE_RE.test(site)) throw new Error(`--site ${site} does not match ${SITE_RE}`);
  console.log(`e2e against ${url}${srv ? ' (tools/e2e/serve.cjs, web/)' : ''}; share meta host ${site}; Chromium, gl ${GL}`);
  const browser = await E.launch({ gl: GL });
  const t0 = Date.now();
  let pass = 0, fail = 0;
  const failures = [];
  try {
    for (const T of TESTS) {
      if (ONLY && !ONLY.includes(T.id)) continue;
      for (const profile of T.profiles) {
        if (!PROFILE_LIST.includes(profile)) continue;
        const t = await E.open(browser, url, { profile, init: T.init || null });
        const label = `${T.id} ${profile}`;
        const started = Date.now();
        let detail = '';
        let err = null;
        try {
          detail = await Promise.race([
            T.run(t, { site, url }),
            new Promise((_, rej) => setTimeout(() => rej(new Fail(`timed out after ${(T.timeout || 90000) / 1000} s`)), T.timeout || 90000)),
          ]);
          const csp = await t.csp().catch(() => []);
          if (csp.length) err = new Fail(`CSP violations: ${csp.slice(0, 3).join(' | ')}`);
          else if (t.errors.length) err = new Fail(`console/page errors: ${t.errors.slice(0, 3).join(' | ')}`);
        } catch (e) {
          err = e;
        }
        const s = ((Date.now() - started) / 1000).toFixed(1);
        if (err) {
          fail++;
          failures.push(label);
          console.log(`[FAIL] ${label.padEnd(16)} ${T.name}\n       ${err instanceof Fail ? err.message : err.stack || err.message}${t.errors.length ? `\n       errors: ${t.errors.slice(0, 3).join(' | ')}` : ''}`);
        } else {
          pass++;
          console.log(`[PASS] ${label.padEnd(16)} ${detail} (${s}s)`);
        }
        await t.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
    if (srv) await srv.close();
  }
  console.log(`${fail ? 'FAIL' : 'PASS'} e2e ${url}: ${pass} passed, ${fail} failed${fail ? ` (${failures.join(', ')})` : ''} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(`[FAIL] e2e: ${e.stack || e.message}`);
  process.exit(1);
});
