/*
 * player.js : the interactive page around the film.
 *
 *   first click / tap  powers the TV on and plays the film with sound (a browser needs a gesture for
 *                      audio, so the page opens on the dark glass with CLICK TO POWER ON in the chrome)
 *   click or space     play / pause (with audio)
 *   left / right       step one frame back / forward
 *   C                  the TV: CRT (default) <-> clean nearest-neighbour pixels (FILM.crt.mode)
 *   F                  fullscreen on / off
 *   M                  mute / unmute (the film and the playable mode)
 *   ?t=seconds         open paused on that global time
 *   ?shot=id           loop one shot
 *   ?clean=1           open with the TV in clean mode
 *   ?render=1          no UI, canvas at native size, nothing drawn until asked (used by tools)
 *
 * The page is a column: the TV (the canvas), then the chrome row under it (status left, help or the
 * power-on prompt centre, a slot right). The TV is fitted to what the chrome leaves, so nothing in the
 * page is ever drawn over the picture. The canvas is rendered at the display's own device pixels
 * (re-mounted on resize and fullscreen), so the CRT's scanlines and grille land on real pixels.
 *
 * The clock while playing is the AudioContext clock when there is music, otherwise the
 * requestAnimationFrame timestamp. Nothing here draws: it only calls FILM.renderFrame(T).
 *
 * Extension point (phase 3, a viewer takes the controller; src/play.js, docs/playable.md):
 *   FILM.player.onMount(api)        called once, after the chrome exists and before the first draw
 *   FILM.player.onKey(e, api)       called first for every keydown and keyup; return true to consume
 *                                   the key (the film's own keys are then skipped)
 *   FILM.player.onFrame(stamp, api) called every animation frame before the film draws; return true
 *                                   when it drew the frame itself (the film is then not drawn, and
 *                                   clicks on the TV do not start the film under it)
 *   FILM.player.api                 { play(), pause(), seek(T), redraw(), relayout(), setHelp(text|null),
 *                                     T, playing, frame, powered, muted, audioState, touch, canvas, ctx,
 *                                     chrome: { root, status, help, slot }, present(frame, opts) }
 *                                   present() puts FILM.native() on the TV; opts go to FILM.crt.present
 *                                   (the playable mode passes { overlays: false })
 */
(function () {
  'use strict';

  const FILM = window.FILM;
  if (!FILM || typeof FILM.renderFrame !== 'function') return;

  const params = new URLSearchParams(window.location.search);
  const renderMode = params.get('render') === '1';
  const player = (FILM.player = FILM.player || {});
  if (typeof player.onKey !== 'function') player.onKey = null;
  if (typeof player.onFrame !== 'function') player.onFrame = null;
  if (typeof player.onMount !== 'function') player.onMount = null;

  if (renderMode) {
    // tools mount their own canvas; keep the page inert
    document.documentElement.style.background = '#000';
    return;
  }

  // A phone or tablet: the primary pointer is a finger. ?touch=1 / ?touch=0 force it either way.
  const touchParam = params.get('touch');
  const touch =
    touchParam === '1' ||
    (touchParam !== '0' && !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches));

  function start() {
    if (FILM.prepare) FILM.prepare(); // applies the timeline's fps and frame size before anything reads them
    const FPS = FILM.FPS;
    const duration = FILM.DURATION;
    const shotId = params.get('shot');
    const loopShot = shotId ? FILM.shotById(shotId) : null;
    const rangeStart = loopShot ? loopShot.start : 0;
    const rangeEnd = loopShot ? loopShot.end : duration;
    const tParam = params.get('t');

    const style = document.createElement('style');
    style.textContent = [
      'html,body{margin:0;height:100%;background:#000;overflow:hidden}',
      'body{display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;',
      '-webkit-user-select:none;user-select:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent;',
      'font:11px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#7d7a74}',
      '#film{display:block;flex:none;background:#000}',
      '#chrome{flex:none;box-sizing:border-box;width:100%;height:40px;padding:0 14px;display:flex;align-items:center;gap:12px}',
      '#chrome>div{flex:1 1 0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#chrome>#help{flex:0 1 auto;text-align:center;letter-spacing:.02em}',
      '#status{text-align:left}',
      '#slot{display:flex;justify-content:flex-end;align-items:center}',
      '#chrome>#slot{overflow:visible}',
      '#gate{color:#e8e0cf;letter-spacing:.16em;animation:cq-blink 1.2s steps(1,end) infinite}',
      '@keyframes cq-blink{0%{opacity:1}62%{opacity:0}}',
      '#bar{position:fixed;left:0;bottom:0;height:2px;background:#e8e0cf;width:0;pointer-events:none;opacity:.5}',
      'body.touch #status{display:none}',
    ].join('');
    document.head.appendChild(style);
    if (touch) document.body.classList.add('touch');

    const canvas = document.createElement('canvas');
    canvas.id = 'film';
    document.body.appendChild(canvas);
    if (params.get('clean') === '1' && FILM.crt) FILM.crt.mode = 'clean';

    const chrome = document.createElement('div');
    chrome.id = 'chrome';
    const status = document.createElement('div');
    status.id = 'status';
    const help = document.createElement('div');
    help.id = 'help';
    const slot = document.createElement('div');
    slot.id = 'slot';
    chrome.appendChild(status);
    chrome.appendChild(help);
    chrome.appendChild(slot);
    document.body.appendChild(chrome);
    const bar = document.createElement('div');
    bar.id = 'bar';
    document.body.appendChild(bar);

    const GATE_TEXT = touch ? 'TAP TO POWER ON' : 'CLICK TO POWER ON';
    const HELP_TEXT = touch ? 'START — play' : 'ENTER — play · C — CRT · I — inputs · F — fullscreen';
    let helpOverride = null;
    let powered = false;
    function showHelp() {
      if (!powered) {
        help.innerHTML = '';
        const g = document.createElement('span');
        g.id = 'gate';
        g.textContent = GATE_TEXT;
        help.appendChild(g);
      } else {
        help.textContent = helpOverride != null ? helpOverride : HELP_TEXT;
      }
    }
    showHelp();

    // Render at the display's device pixels. The TV gets the window minus whatever the chrome (and a
    // touch pad in the page flow, src/play.js) takes; fixed overlays take nothing.
    let mountedScale = 0;
    function fit() {
      const dpr = window.devicePixelRatio || 1;
      let used = 0;
      for (const el of document.body.children) {
        if (el === canvas || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.position === 'fixed' || cs.position === 'absolute') continue;
        used += el.offsetHeight;
      }
      const cssH = Math.max(60, Math.min(window.innerHeight - used, (window.innerWidth * FILM.H) / FILM.W));
      canvas.style.height = `${cssH}px`;
      canvas.style.width = `${(cssH * FILM.W) / FILM.H}px`;
      const S = Math.max(0.25, Math.min(3, (cssH * dpr) / FILM.H));
      if (Math.abs(S - mountedScale) < 0.01) return false;
      mountedScale = S;
      FILM.mount(canvas, { scale: S });
      return true;
    }

    let T = tParam != null && isFinite(Number(tParam)) ? Number(tParam) : rangeStart;
    let playing = false;
    let muted = false;
    let owned = false; // the last animation frame was drawn by FILM.player.onFrame (the playable mode)
    let audio = null; // { ctx, master, anchor, startT }
    let rafStamp0 = null;
    let rafT0 = 0;
    let lastDrawn = -1;

    const quant = (t) => Math.floor(t * FPS + 1e-6) / FPS;

    // Clip frames (instrument mode) decode on demand: a frame draws once its clips are ready, and
    // while playing the next second is prefetched so playback does not wait on the decoder.
    const hasClips = FILM.prepareFrame && FILM.CLIPS && Object.keys(FILM.CLIPS).length > 0;
    let prefetchedTo = -1;
    function prefetch(q) {
      if (!hasClips) return;
      const to = Math.min(rangeEnd - 1 / FPS, q + 1);
      for (let f = Math.max(Math.round(q * FPS), prefetchedTo + 1); f <= Math.round(to * FPS); f++) FILM.prepareFrame(f / FPS);
      prefetchedTo = Math.round(to * FPS);
    }
    function paint(q) {
      FILM.errors = [];
      const shot = FILM.renderFrame(q);
      if (FILM.errors.length && window.console) console.warn('FILM errors at', q, FILM.errors);
      // the first screen is the dark glass and the power-on prompt, nothing else
      status.textContent = powered ? `${q.toFixed(2)}s  f${Math.round(q * FPS)}  ${shot ? shot.id : ''}${muted ? '  muted' : ''}` : '';
      bar.style.width = `${(100 * (q - rangeStart)) / Math.max(1e-6, rangeEnd - rangeStart)}%`;
    }
    function draw(force) {
      const q = quant(Math.min(Math.max(T, rangeStart), rangeEnd - 1 / FPS));
      if (!force && q === lastDrawn) return;
      lastDrawn = q;
      if (!hasClips) return paint(q);
      if (q * FPS < prefetchedTo - FPS * 2) prefetchedTo = -1; // looped or seeked back
      prefetch(q);
      FILM.prepareFrame(q).then(() => {
        if (lastDrawn === q) paint(q);
      });
    }

    function stopAudio() {
      if (audio) {
        const c = audio.ctx;
        audio = null;
        c.close();
      }
    }

    function startAudio(fromT) {
      stopAudio();
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || !FILM.audio || typeof FILM.audio.render !== 'function') return;
      const ctx = new AC({ latencyHint: 'playback', sampleRate: 48000 });
      const master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      const anchor = ctx.currentTime;
      try {
        FILM.audio.render(ctx, { start: fromT, dest: master });
      } catch (e) {
        if (window.console) console.error('FILM.audio.render failed', e);
      }
      audio = { ctx, master, anchor, startT: fromT };
    }
    // A context made outside a gesture (the loop restart, a return from the playable mode) can start
    // suspended in a strict browser; the next gesture of any kind lets it run.
    const wake = () => {
      if (audio && audio.ctx.state === 'suspended') audio.ctx.resume();
    };
    for (const type of ['pointerup', 'touchend', 'keydown', 'click']) window.addEventListener(type, wake, true);

    function play() {
      if (T >= rangeEnd - 1 / FPS) T = rangeStart;
      if (!powered) {
        powered = true;
        showHelp();
      }
      playing = true;
      document.body.classList.add('playing');
      startAudio(T);
      rafStamp0 = null;
      rafT0 = T;
    }

    function pause() {
      playing = false;
      document.body.classList.remove('playing');
      stopAudio();
      T = quant(T);
      draw(true);
    }

    function tick(stamp) {
      if (player.onFrame && player.onFrame(stamp, api) === true) {
        owned = true;
        window.requestAnimationFrame(tick);
        return;
      }
      owned = false;
      if (playing) {
        if (audio) {
          // currentTime moves once per audio buffer (tens of ms under the 'playback' latency hint), which
          // would judder a 60 fps picture; the output timestamp pins a context time to a performance
          // time, so the audio clock is read at this animation frame's own stamp (latency included)
          const ts = typeof audio.ctx.getOutputTimestamp === 'function' ? audio.ctx.getOutputTimestamp() : null;
          if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
            T = audio.startT + Math.max(0, ts.contextTime + (stamp - ts.performanceTime) / 1000 - audio.anchor);
          } else {
            const lat = (audio.ctx.baseLatency || 0) + (audio.ctx.outputLatency || 0);
            T = audio.startT + Math.max(0, audio.ctx.currentTime - audio.anchor - lat);
          }
        } else {
          if (rafStamp0 == null) rafStamp0 = stamp;
          T = rafT0 + (stamp - rafStamp0) / 1000;
        }
        if (T >= rangeEnd) {
          T = rangeStart;
          if (audio) startAudio(T);
          rafStamp0 = stamp;
          rafT0 = T;
        }
        draw(false);
      }
      window.requestAnimationFrame(tick);
    }

    function step(n) {
      if (playing) pause();
      const f = Math.round(quant(T) * FPS) + n;
      const f0 = Math.round(rangeStart * FPS);
      const f1 = Math.round(rangeEnd * FPS) - 1;
      T = Math.min(f1, Math.max(f0, f)) / FPS;
      draw(true);
    }

    function seek(t) {
      T = Math.min(Math.max(Number(t) || 0, rangeStart), rangeEnd - 1 / FPS);
      if (playing) {
        if (audio) startAudio(T);
        rafStamp0 = null;
        rafT0 = T;
      }
      draw(true);
    }
    function toggleTV() {
      if (!FILM.crt) return;
      FILM.crt.mode = FILM.crt.mode === 'clean' ? 'crt' : 'clean';
      if (!owned) draw(true); // the playable mode re-presents on its next frame
    }
    function toggleMute() {
      muted = !muted;
      if (audio) audio.master.gain.value = muted ? 0 : 1;
      if (!owned) draw(true);
    }
    function toggleFullscreen() {
      const d = document;
      const el = d.documentElement;
      if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else if (el.requestFullscreen || el.webkitRequestFullscreen) (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    }
    function relayout() {
      if (fit() && !owned) draw(true);
    }
    const api = {
      play,
      pause,
      seek,
      redraw: () => draw(true),
      relayout,
      setHelp(text) {
        helpOverride = text == null ? null : String(text);
        showHelp();
      },
      get T() {
        return T;
      },
      get playing() {
        return playing;
      },
      get frame() {
        return Math.round(quant(T) * FPS);
      },
      get powered() {
        return powered;
      },
      get muted() {
        return muted;
      },
      get audioState() {
        return audio ? audio.ctx.state : 'none';
      },
      touch,
      canvas,
      chrome: { root: chrome, status, help, slot },
      get ctx() {
        return FILM.ctx;
      },
      present(frame, opts) {
        const nb = FILM.native ? FILM.native() : null;
        if (!nb) return;
        if (FILM.crt && typeof FILM.crt.present === 'function') FILM.crt.present(nb.canvas, FILM.ctx, Object.assign({}, opts, { frame }));
        else FILM.presentNearest(nb.canvas, FILM.ctx);
      },
    };
    player.api = api;

    window.addEventListener('resize', relayout);
    // The first click anywhere powers the TV on (the pad of the playable mode excepted: its START takes
    // the controller instead). After that a click on the TV or the page plays and pauses the film,
    // except while the playable mode owns the TV.
    canvas.addEventListener('click', () => {
      if (!owned) playing ? pause() : play();
    });
    document.body.addEventListener('click', (e) => {
      if (e.target === document.body && !owned) playing ? pause() : play();
    });
    document.addEventListener('click', (e) => {
      if (powered || owned || playing) return;
      if (e.target && e.target.closest && e.target.closest('[data-pad]')) return;
      play();
    });
    window.addEventListener('keyup', (e) => {
      if (player.onKey && player.onKey(e, api) === true) e.preventDefault();
    });
    window.addEventListener('keydown', (e) => {
      if (player.onKey && player.onKey(e, api) === true) {
        e.preventDefault();
        return;
      }
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      if (e.code === 'KeyC' && plain) {
        e.preventDefault();
        toggleTV();
      } else if (e.code === 'KeyF' && plain) {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.code === 'KeyM' && plain) {
        e.preventDefault();
        toggleMute();
      } else if (e.code === 'Space') {
        e.preventDefault();
        playing ? pause() : play();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        step(1);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      }
    });

    if (player.onMount) {
      try {
        player.onMount(api);
      } catch (e) {
        if (window.console) console.error('FILM.player.onMount failed', e);
      }
    }
    fit();
    draw(true);
    window.requestAnimationFrame(tick);
  }

  // Photos decode asynchronously and the hand-lettering face resolves asynchronously; drawing before
  // either is ready shows a half-built frame (and hashes differently from the same frame drawn later).
  const boot = () =>
    Promise.all([
      FILM.loadPhotos ? FILM.loadPhotos() : Promise.resolve(),
      document.fonts ? document.fonts.ready : Promise.resolve(),
    ]).then(start);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
