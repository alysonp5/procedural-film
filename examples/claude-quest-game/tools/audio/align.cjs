// align.cjs : proves every sound effect starts within one frame of its game event.
//   node tools/audio/align.cjs [--mock | --events saved.json] [--sr 48000] [--tol 1]
// Events: FILM.game.events() when src/game provides it (loaded in a browser page), else --mock or the
// mock list (tools/audio/mock-events.js); the source is printed.
//
// Method (a difference test, so a busy mix cannot hide an onset): render the film with every event,
// then again without event E, up to a few frames past it. The first sample where the two differ by more
// than -80 dBFS is where E's sound begins; it must lie within `tol` frames of E.f (60 fps). The
// difference over the first frame after the onset must also be audible (above -50 dBFS RMS), so an
// effect that only mutes the music without sounding would fail. Song events are not effects and are
// skipped. Renders are music + effects without the TV foley and speaker (they are identical in both).
'use strict';
const H = require('./host.cjs');

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const SR = Number(opt('sr', 48000));
const TOL = Number(opt('tol', 1));

(async () => {
  const { events, source } = await H.events({ mock: args.includes('--mock'), file: opt('events', null) });
  const FILM = H.load({ foley: false });
  const spf = SR / 60;
  const base = FILM.audio.synth(SR, { events, foley: false });
  // Identical effects on the same frame (two coins collected at once) are one sound, as on the console:
  // they are tested as a group, removed together.
  const groups = new Map();
  events.forEach((e, idx) => {
    if (e.type === 'song') return;
    const key = JSON.stringify(e);
    if (!groups.has(key)) groups.set(key, { e, idxs: [] });
    groups.get(key).idxs.push(idx);
  });
  const fx = [...groups.values()];
  const known = new Set(FILM.audio.sfx);
  const fails = [];
  const lines = [];
  let worst = 0;
  let masked = 0;
  const t0 = Date.now();
  for (const { e, idxs } of fx) {
    const tag = `f${String(e.f).padStart(5)} ${e.type}${e.combo ? ' combo ' + e.combo : ''}${e.i != null ? ' i ' + e.i : ''}${e.n != null ? ' n ' + e.n : ''}${idxs.length > 1 ? ` (x${idxs.length}, same frame)` : ''}`;
    if (!known.has(e.type)) {
      fails.push(`${tag}: no sound is defined for event type '${e.type}'`);
      continue;
    }
    const want = Math.round(e.f * spf);
    const upto = want + Math.round(6 * spf);
    const alt = FILM.audio.synth(SR, { events: events.filter((_, k) => !idxs.includes(k)), samples: Math.min(base.length, upto), foley: false });
    let onset = -1;
    for (let i = Math.max(0, want - Math.round(8 * spf)); i < alt.length; i++) {
      if (Math.abs(base[i] - alt[i]) > 1e-4) {
        onset = i;
        break;
      }
    }
    if (onset < 0) {
      // Masked by a louder effect: only allowed for priority 0 (the optional fireball whoosh), and only
      // when a higher-priority effect really holds every channel it asks for at that frame
      const me = FILM.audio.effect(e);
      const holders = events.filter((o) => o !== e && o.type !== 'song' && o.f <= e.f && FILM.audio.effect(o) && FILM.audio.effect(o).pri > me.pri);
      const held = Object.keys(me).filter((ch) => ch !== 'pri').every((ch) => holders.some((o) => (FILM.audio.effect(o)[ch] || 0) > e.f - o.f));
      if (me.pri === 0 && held) {
        const by = holders.filter((o) => Object.keys(me).some((ch) => ch !== 'pri' && (FILM.audio.effect(o)[ch] || 0) > e.f - o.f)).map((o) => `${o.type}@${o.f}`);
        lines.push(`mask ${tag.padEnd(34)} masked by ${by.join(', ')} (priority 0 yields by design)`);
        masked++;
        continue;
      }
      fails.push(`${tag}: no difference within 6 frames (the effect never sounded: a higher-priority effect held every channel it asked for?)`);
      continue;
    }
    let e2 = 0;
    const m = Math.round(spf);
    for (let i = onset; i < Math.min(alt.length, onset + m); i++) e2 += (base[i] - alt[i]) ** 2;
    const rms = 10 * Math.log10(e2 / m + 1e-30);
    const dFrames = (onset - want) / spf;
    worst = Math.max(worst, Math.abs(dFrames));
    const ok = Math.abs(dFrames) <= TOL && rms > -50;
    lines.push(`${ok ? 'ok  ' : 'FAIL'} ${tag.padEnd(34)} onset ${(onset / SR).toFixed(4)} s = frame ${(onset / spf).toFixed(3)} (${dFrames >= 0 ? '+' : ''}${dFrames.toFixed(3)} frames), first-frame level ${rms.toFixed(1)} dBFS`);
    if (!ok) fails.push(lines[lines.length - 1]);
  }
  console.log(`events: ${source}, ${events.length} events, ${fx.length} distinct effects; tolerance ${TOL} frame(s) at 60 fps (${((TOL * 1000) / 60).toFixed(1)} ms)`);
  console.log(lines.join('\n'));
  console.log(`\n${fx.length - fails.length - masked}/${fx.length} effects start within ${TOL} frame(s) of their event${masked ? `, ${masked} priority-0 effect(s) masked by a louder one by design` : ''}; worst offset ${worst.toFixed(3)} frames; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (fails.length) {
    console.log('FAILURES:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
