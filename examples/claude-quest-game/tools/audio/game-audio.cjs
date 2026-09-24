// game-audio.cjs : T6 static gate for the game's sound (docs/game-spec.md sections 7, 10 and 13.6).
//   node tools/audio/game-audio.cjs
// Runs src/music.js in Node (the Node host) and proves, from the driver's own register writes:
//   events     every sound-bearing event in spec section 7 (read from the spec's own table) and every
//              shell-only cue has an effect or a song; aliases play the program they alias
//   effects    each effect in 10.2 has its priority, its channels and its length; no effect touches the DMC
//   songs      death (144 frames, no loop), gameover (<= 176, no loop), sky (loops, sections A and B),
//              boss (loops), hurry (exactly 90, no loop) compile; death and gameover fall silent inside
//              their 180-frame states; hurry is three rising stabs and a held note; the boss's lead is on
//              pulse 2, so a roar (pulse 1 + noise) leaves the tune untouched
//   fast       overworldFast, undergroundFast, skyFast, castleFast, bossFast exist at speed minus 1 with
//              every section scaled and the same notes on every row; every level song in CQ.GAME_DEFS
//              (when src/game/01-world1.js has landed) has its fast variant
//   pause      a paused driver holds sf and silences the song (DMC stopped with $4015 = $0F) while effects
//              play; unpause resumes the same sf with every voice retriggered, and from there the song is
//              register-for-register the unpaused song; a song event clears the pause
//   film       FILM.audio.synth(48000) over the film's own events hashes to the pre-P5 baseline
// Exits non-zero on any failure.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./host.cjs');

// The film's soundtrack before P5 touched music.js: FILM.audio.synth(48000) (TV foley included) over
// FILM.game.events() of the untouched engine, 145 events, 2901600 samples, hashed with host.cjs fnv.
const FILM_AUDIO_HASH = 'eff5a1b339359837';
const FILM_SAMPLES = 2901600;
// FNV-1a over JSON.stringify(FILM.game.events()) of the same engine: if the audio hash moves, this says
// whether the events changed (the engine's film invariance, P1) or the sound did (music.js, P5)
const FILM_EVENTS_HASH = 'e8f7d82e';

const results = [];
function report(group, ok, msg, details = []) {
  results.push(ok);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${group}: ${msg}`);
  for (const d of details.slice(0, 30)) console.log(`       ${d}`);
  if (details.length > 30) console.log(`       ... ${details.length - 30} more`);
}

const FILM = H.load({ foley: false });
const A = FILM.audio;
const info = A.info();
const SFX = new Set(A.sfx);
const SONGS = new Set(A.songs);

// ---------------------------------------------------------------- helpers
/** Run a bare driver: evs is [[frame, event], ...]; returns per-frame writes and states. */
function drive(frames, evs, mute) {
  const d = A.driver(mute);
  const byF = new Map();
  for (const [f, e] of evs) {
    if (!byF.has(f)) byF.set(f, []);
    byF.get(f).push(Object.assign({ f }, e));
  }
  const writes = [];
  const states = [];
  for (let f = 0; f < frames; f++) {
    writes.push(d.frame(f, byF.get(f) || []));
    states.push(d.state());
  }
  return { writes, states };
}
/** The registers' values after each frame (the chip's view), for comparing two runs. */
function regTrace(writes) {
  const reg = {};
  return writes.map((w) => {
    const trig = [];
    for (let i = 0; i < w.length; i += 2) {
      reg[w[i]] = w[i + 1];
      if (w[i] === 0x4003 || w[i] === 0x4007 || w[i] === 0x400b || w[i] === 0x400f) trig.push(w[i]);
    }
    return { reg: Object.assign({}, reg), trig };
  });
}
/** Per-frame view of one channel from the writes: pulse { v, t, trig }, triangle { on, t, trig }, noise { v }. */
function channelTrace(writes, ch) {
  const base = ch === 'p1' ? 0x4000 : 0x4004;
  let v = 0;
  let t = 0;
  let triOn = false;
  let nv = 0;
  return writes.map((w) => {
    let trig = false;
    for (let i = 0; i < w.length; i += 2) {
      const a = w[i];
      const x = w[i + 1];
      if (ch === 'p1' || ch === 'p2') {
        if (a === base) v = x & 15;
        if (a === base + 2) t = (t & 0x700) | x;
        if (a === base + 3) {
          t = (t & 0xff) | ((x & 7) << 8);
          trig = true;
        }
      } else if (ch === 't') {
        if (a === 0x4008) triOn = x !== 0x80;
        if (a === 0x400a) t = (t & 0x700) | x;
        if (a === 0x400b) {
          t = (t & 0xff) | ((x & 7) << 8);
          trig = true;
        }
      } else if (ch === 'n' && a === 0x400c) nv = x & 15;
    }
    if (ch === 't') return { on: triOn, t, trig };
    if (ch === 'n') return { v: nv };
    return { v, t, trig };
  });
}
/** What the chip plays each frame, as a string: each pulse's volume, duty and (when sounding) timer, the
 * triangle's timer when on, the noise's volume and period, and any DMC sample started that frame. */
function audible(writes) {
  return regTrace(writes).map(({ reg }, f) => {
    const pul = (b) => {
      const v = reg[b] & 15;
      return v ? `${v}/${reg[b] >> 6}/${reg[b + 2] | ((reg[b + 3] & 7) << 8)}` : '0';
    };
    const tri = reg[0x4008] !== undefined && reg[0x4008] !== 0x80 ? String(reg[0x400a] | ((reg[0x400b] & 7) << 8)) : '-';
    const nv = reg[0x400c] & 15;
    const w = writes[f];
    const dmc = w.some((x, i) => i % 2 === 0 && x === 0x4015 && w[i + 1] & 0x10) ? `${reg[0x4010]}/${reg[0x4012]}/${reg[0x4013]}` : '';
    return [pul(0x4000), pul(0x4004), tri, nv ? `${nv}/${reg[0x400e]}` : '0', dmc].join(' ');
  });
}
const writesOf = (ev, frames) => drive(frames, [[0, ev]]).writes.map((w) => w.join(','));
const pitch = (t, tri) => {
  const hz = 1789773 / ((tri ? 32 : 16) * (t + 1));
  return 69 + 12 * Math.log2(hz / 440);
};

// ---------------------------------------------------------------- 1 events (spec section 7)
const SPEC = path.join(H.ROOT, 'docs', 'game-spec.md');
const spec = fs.readFileSync(SPEC, 'utf8');
const sectionOf = (head, next) => {
  const a = spec.indexOf(head);
  const b = spec.indexOf(next, a + head.length);
  return a < 0 ? '' : spec.slice(a, b < 0 ? undefined : b);
};
const rowsOf = (text) =>
  text
    .split('\n')
    .filter((l) => /^\|\s*`/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
const ticks = (cell) => [...cell.matchAll(/`([\w-]+)`/g)].map((m) => m[1]);
{
  const s7 = sectionOf('## 7. Events', '## 8.');
  const rows = rowsOf(s7);
  const bad = [];
  const seen = [];
  for (const r of rows) {
    const names = ticks(r[0]);
    const sound = r[r.length - 1];
    if (/^none\b/.test(sound)) continue;
    const song = /the `([\w-]+)` song/.exec(sound);
    for (const name of names) {
      seen.push(name);
      if (song) {
        if (!SONGS.has(song[1])) bad.push(`${name}: the '${song[1]}' song does not exist`);
      } else if (!SFX.has(name)) bad.push(`${name}: no effect (sound: ${sound})`);
    }
    // an alias plays exactly the program it names
    const as = /as `(\w+)`/.exec(sound);
    if (as && !song) {
      for (const name of names) {
        if (!SFX.has(name) || !SFX.has(as[1])) continue;
        if (writesOf({ type: name }, 80).join('|') !== writesOf({ type: as[1] }, 80).join('|')) bad.push(`${name}: does not play the '${as[1]}' program`);
      }
    }
    if (/unchanged program/.test(sound)) {
      for (const name of names) {
        const withData = /\{([^}]*)\}/.exec(r[1]);
        const ev = { type: name };
        if (withData) for (const m of withData[1].matchAll(/(\w+):\s*'([^']*)'/g)) ev[m[1]] = m[2];
        if (writesOf(ev, 80).join('|') !== writesOf({ type: name }, 80).join('|')) bad.push(`${name} ${JSON.stringify(ev)}: not the unchanged program`);
      }
    }
  }
  const shell = /Shell-only sound cues[^\n]*/.exec(s7);
  const cues = shell ? ticks(shell[0]) : [];
  for (const c of cues) if (!SFX.has(c)) bad.push(`shell cue ${c}: no effect`);
  const okParse = rows.length >= 20 && cues.length === 3;
  report('events', okParse && !bad.length, okParse ? `${seen.length} sound-bearing events in section 7 and ${cues.length} shell cues (${cues.join(', ')}) all have an effect or a song` : `could not read the section 7 table (${rows.length} rows, ${cues.length} shell cues)`, bad);
}

// ---------------------------------------------------------------- 2 effects (spec 10.2)
{
  const rows = rowsOf(sectionOf('### 10.2 S2 effects', '### 10.3'));
  const bad = [];
  const lines = [];
  const CH = { p1: 'p1', p2: 'p2', n: 'n', t: 't' };
  for (const r of rows) {
    const [idCell, priCell, chCell, frCell] = r;
    const pri = Number(priCell);
    for (const id of ticks(idCell)) {
      if (!SFX.has(id)) {
        bad.push(`${id}: no effect`);
        continue;
      }
      const alias = /as `(\w+)`/.exec(chCell);
      const want = alias ? Object.keys(A.effect({ type: alias[1] })).filter((k) => k !== 'pri').sort() : chCell.split(/,\s*/).map((c) => CH[c]).sort();
      const variants = /held/.test(frCell)
        ? [
            [{ type: id, held: true }, Number(/(\d+) \(held\)/.exec(frCell)[1])],
            [{ type: id, held: false }, Number(/(\d+) \(not\)/.exec(frCell)[1])],
          ]
        : [[{ type: id }, Number(frCell)]];
      for (const [ev, frames] of variants) {
        const e = A.effect(ev);
        const got = Object.keys(e).filter((k) => k !== 'pri').sort();
        const len = Math.max(...got.map((k) => e[k]));
        const tag = `${id}${ev.held != null ? (ev.held ? ' (held)' : ' (not held)') : ''}`;
        if (e.pri !== pri) bad.push(`${tag}: priority ${e.pri}, spec ${pri}`);
        if (got.join(',') !== want.join(',')) bad.push(`${tag}: channels ${got.join(',')}, spec ${want.join(',')}`);
        if (len !== frames) bad.push(`${tag}: ${len} frames, spec ${frames}`);
        lines.push(`${tag.padEnd(18)} pri ${e.pri}  ${got.map((k) => `${k} ${e[k]}`).join(', ')}`);
      }
    }
  }
  report('effects', rows.length >= 17 && !bad.length, `${rows.length} rows of 10.2: every effect has its priority, channels and length`, bad.length ? bad : lines);

  // no effect ever plays the DMC: no program has a DMC channel, and beyond the driver's power-on writes
  // (a run with no event) no $4010, $4012 or $4013 write and no $4015 with the DMC bit (a `pause` also
  // cuts a drum the song was playing: $4015 = $0F and the DAC's rest level in $4011, which start nothing)
  const dmcWrites = (w) => {
    const out = [];
    for (let i = 0; i < w.length; i += 2) if (w[i] === 0x4010 || w[i] === 0x4012 || w[i] === 0x4013 || (w[i] === 0x4015 && w[i + 1] & 0x10)) out.push(`$${w[i].toString(16)} = ${w[i + 1]}`);
    return out.join(' ');
  };
  const quiet = drive(80, []).writes.map(dmcWrites);
  const dmc = [];
  for (const id of A.sfx) {
    for (const ev of [{ type: id }, { type: id, held: true }, { type: id, combo: 4 }, { type: id, big: true }]) {
      const chans = Object.keys(A.effect(ev)).filter((k) => k !== 'pri');
      if (chans.some((k) => !['p1', 'p2', 't', 'n'].includes(k))) dmc.push(`${id}: a program on ${chans.join(',')}`);
      const { writes } = drive(80, [[0, ev]]);
      writes.forEach((w, f) => {
        if (dmcWrites(w) !== quiet[f]) dmc.push(`${id} frame ${f}: ${dmcWrites(w)}`);
      });
    }
  }
  report('effects', !dmc.length, `none of the ${A.sfx.length} effects plays the DMC`, dmc);
}

// ---------------------------------------------------------------- 3 songs (spec 10.1)
{
  const bad = [];
  const S = info.songs;
  const need = (id, cond, msg) => {
    if (!S[id]) bad.push(`${id}: missing`);
    else if (!cond(S[id])) bad.push(`${id}: ${msg} (${JSON.stringify(S[id])})`);
  };
  need('death', (s) => s.frames === 144 && s.loopFrame === null, 'must be 144 frames, no loop');
  need('gameover', (s) => s.frames <= 176 && s.loopFrame === null, 'must be at most 176 frames, no loop');
  need('sky', (s) => s.loopFrame !== null && s.sections.A != null && s.sections.B != null && s.sections.B > s.sections.A, 'must loop with sections A and B');
  need('boss', (s) => s.loopFrame !== null, 'must loop');
  need('hurry', (s) => s.frames === 90 && s.loopFrame === null, 'must be exactly 90 frames, no loop');
  const facts = ['death', 'gameover', 'sky', 'boss', 'hurry'].filter((id) => S[id]).map((id) => `${id}: ${S[id].frames} frames (${(S[id].frames / 60).toFixed(1)} s), speed ${S[id].speed}, ${S[id].loopFrame === null ? 'no loop' : 'loops at frame ' + S[id].loopFrame}${Object.keys(S[id].sections).length ? ', sections ' + JSON.stringify(S[id].sections) : ''}`);
  report('songs', !bad.length, 'the five new songs compile with the lengths and loops of 10.1', bad.length ? bad : facts);

  // death and gameover are silent before their 180-frame states end: the last audible frame of the
  // rendered song (any 1/60 s window above -60 dBFS), the TV left out
  const silentAfter = (id) => {
    const sr = 48000;
    const n = 240;
    const buf = A.synth(sr, { events: [{ f: 0, type: 'song', id }], samples: (n * sr) / 60, foley: false });
    let last = -1;
    for (let f = 0; f < n; f++) {
      let e = 0;
      for (let i = f * 800; i < (f + 1) * 800; i++) e += buf[i] * buf[i];
      if (Math.sqrt(e / 800) > 1e-3) last = f;
    }
    return last;
  };
  const dLast = silentAfter('death');
  const gLast = silentAfter('gameover');
  report('songs', dLast < 180 && gLast < 180, `death is last audible at frame ${dLast} and gameover at frame ${gLast}: both inside their 180-frame states`);

  // hurry: three rising stabs, then one held note
  {
    const { writes } = drive(100, [[0, { type: 'song', id: 'hurry' }]]);
    const p1 = channelTrace(writes, 'p1');
    const on = [];
    p1.forEach((x, f) => {
      if (x.trig && x.v > 0) on.push([f, pitch(x.t)]);
    });
    const stabs = on.slice(0, 3);
    const held = on[3];
    const rising = stabs.length === 3 && stabs[0][1] < stabs[1][1] && stabs[1][1] < stabs[2][1] && held && held[1] > stabs[2][1];
    const heldLen = held ? p1.slice(held[0]).findIndex((x) => x.v === 0) : -1;
    const ok = rising && on.length === 4 && (heldLen < 0 ? 90 - held[0] : heldLen) >= 40;
    report('songs', ok, `hurry: ${on.length} pulse-1 onsets at frames ${on.map((o) => o[0]).join(', ')} (pitches ${on.map((o) => o[1].toFixed(1)).join(', ')}): three rising stabs and a note held ${heldLen < 0 ? 90 - (held ? held[0] : 0) : heldLen} frames`);
  }

  // boss: the lead is on pulse 2, so a roar (pulse 1 + noise, priority 4) leaves pulse 2 untouched
  {
    const plain = drive(400, [[0, { type: 'song', id: 'boss' }]]).writes;
    const roared = drive(400, [[0, { type: 'song', id: 'boss' }], [200, { type: 'roar' }]]).writes;
    const p2a = channelTrace(plain, 'p2');
    const p2b = channelTrace(roared, 'p2');
    const diff = p2a.findIndex((x, f) => x.v !== p2b[f].v || x.t !== p2b[f].t);
    const vol = (tr) => tr.slice(160).reduce((a, x) => a + x.v, 0);
    const p1v = vol(channelTrace(plain, 'p1'));
    const p2v = vol(p2a);
    report('songs', diff < 0 && p2v > 1.5 * p1v, `boss: a roar at frame 200 leaves pulse 2 identical (${diff < 0 ? 'no frame differs' : 'differs at frame ' + diff}); the lead carries ${(p2v / Math.max(1, p1v)).toFixed(1)}x pulse 1's summed volume`);
  }

  // credits: no loop; the parade's bars end on the engine's CREDITS_ROLL, where section 'card' starts a
  // D major chord on every pitched voice; a START skip (the song from 'card') plays what the full song
  // plays from there; the ringing chord falls silent before the card's START wait is long over
  {
    const s = S.credits;
    const sb = filmSandbox();
    const roll = sb && sb.FILM.__cq && sb.FILM.__cq.TIMING ? sb.FILM.__cq.TIMING.CREDITS_ROLL : null;
    const bad = [];
    let facts = '';
    if (!s) bad.push('credits: missing');
    else {
      if (s.loopFrame !== null) bad.push(`credits loops at frame ${s.loopFrame}; it must end`);
      const at = s.sections.card;
      if (at !== roll) bad.push(`section card at frame ${at}, the engine's CREDITS_ROLL is ${roll}`);
      const full = drive(s.frames + 60, [[0, { type: 'song', id: 'credits' }]]).writes;
      const pcs = [];
      for (const ch of ['p1', 'p2', 't']) {
        const x = channelTrace(full, ch)[at];
        if (!x || !x.trig) bad.push(`${ch} starts no note on the card's frame ${at}`);
        else pcs.push(((Math.round(pitch(x.t, ch === 't')) % 12) + 12) % 12);
      }
      if (!pcs.includes(2) || pcs.some((q) => q !== 2 && q !== 6 && q !== 9)) bad.push(`the card's chord has pitch classes ${pcs.join(',')}, not D major on D`);
      const skip = drive(s.frames - at + 60, [[0, { type: 'song', id: 'credits', section: 'card' }]]).writes;
      const a = audible(full).slice(at + 1), b = audible(skip).slice(1);
      const d = a.findIndex((x, i) => x !== b[i]);
      if (d >= 0) bad.push(`a skip to the card differs from the full song ${d + 1} frames after the card (${b[d]} vs ${a[d]})`);
      const au = audible(full);
      let last = -1;
      au.forEach((x, f) => {
        if (!/^0 0 - 0/.test(x)) last = f;
      });
      if (last >= s.frames) bad.push(`still sounding at frame ${last}, after the song's ${s.frames} frames`);
      facts = `credits: ${s.frames} frames, speed ${s.speed}, no loop; the parade is frames 0-${at - 1} (${(at / 60).toFixed(1)} s = CREDITS_ROLL ${roll}); the card's D major chord (pitch classes ${pcs.join(',')}) starts on frame ${at} and rings to frame ${last}; a skip matches the full song from the card on`;
    }
    report('songs', !bad.length, bad.length ? 'credits' : facts, bad);
  }
}

// ---------------------------------------------------------------- 4 fast variants
{
  const bad = [];
  const lines = [];
  for (const id of ['overworld', 'underground', 'sky', 'castle', 'boss']) {
    const s = info.songs[id];
    const q = info.songs[id + 'Fast'];
    if (!s || !q) {
      bad.push(`${id}Fast: missing`);
      continue;
    }
    if (q.speed !== s.speed - 1) bad.push(`${id}Fast: speed ${q.speed}, want ${s.speed - 1}`);
    if (q.rows !== s.rows || q.frames !== q.rows * q.speed) bad.push(`${id}Fast: ${q.rows} rows / ${q.frames} frames`);
    if ((q.loopFrame === null) !== (s.loopFrame === null) || (s.loopFrame !== null && q.loopFrame / q.speed !== s.loopFrame / s.speed)) bad.push(`${id}Fast: loop at frame ${q.loopFrame}, the source loops at ${s.loopFrame}`);
    for (const k of Object.keys(s.sections)) if (q.sections[k] !== (s.sections[k] / s.speed) * q.speed) bad.push(`${id}Fast: section ${k} at frame ${q.sections[k]}, want ${(s.sections[k] / s.speed) * q.speed}`);
    // the same notes on every row: each channel's timer at each row start, first 96 rows
    const rows = Math.min(96, s.rows);
    const a = drive(rows * s.speed, [[0, { type: 'song', id }]]).writes;
    const b = drive(rows * q.speed, [[0, { type: 'song', id: id + 'Fast' }]]).writes;
    for (const ch of ['p1', 'p2', 't']) {
      const ta = channelTrace(a, ch);
      const tb = channelTrace(b, ch);
      for (let r = 0; r < rows; r++) {
        const x = ta[r * s.speed];
        const y = tb[r * q.speed];
        if (x.trig !== y.trig || (x.trig && x.t !== y.t)) {
          bad.push(`${id}Fast: ${ch} row ${r} differs from ${id}`);
          break;
        }
      }
    }
    lines.push(`${(id + 'Fast').padEnd(16)} speed ${q.speed} (${id} ${s.speed}), ${q.frames} frames (${s.frames}), loop ${q.loopFrame} (${s.loopFrame}), sections ${JSON.stringify(q.sections)}`);
  }
  report('fast', !bad.length, 'the five fast variants run at speed minus 1 with scaled sections and the same notes', bad.length ? bad : lines);
}

// ---------------------------------------------------------------- 5 the driver pause (spec 10.3)
{
  const HOLD = 240; // frames paused
  const song = [0, { type: 'song', id: 'overworld', section: 'A' }];
  const N = 1400;
  const ref = drive(N, [song]);
  const refW = ref.writes;
  const has = (w, a, bit) => w.some((x, i) => i % 2 === 0 && x === a && (bit == null || w[i + 1] & bit));
  const rp2 = channelTrace(refW, 'p2');
  const rt = channelTrace(refW, 't');
  const rn = channelTrace(refW, 'n');
  // two pause points in the hook: on a drum hit (the drum must be cut and never restarted while paused),
  // and inside notes sounding on pulse 2, the triangle and the noise (each must be retriggered on unpause)
  let onDrum = -1;
  let midNotes = -1;
  for (let f = 300; f < 800 && (onDrum < 0 || midNotes < 0); f++) {
    if (onDrum < 0 && has(refW[f], 0x4015, 0x10)) onDrum = f;
    if (midNotes < 0 && rp2[f].v > 0 && !rp2[f].trig && rt[f].on && !rt[f].trig && rn[f].v > 0 && !has(refW[f], 0x400f)) midNotes = f;
  }
  const lines = [];
  const bad = [];
  if (onDrum < 0 || midNotes < 0) bad.push(`no pause point found (drum ${onDrum}, mid-notes ${midNotes})`);
  for (const P0 of [onDrum, midNotes].filter((f) => f >= 0)) {
    const U = P0 + HOLD;
    const tag = `pause at ${P0}${P0 === onDrum ? ' (on a drum)' : ' (mid-note)'}`;
    const evs = [song, [P0, { type: 'pause' }], [P0 + 60, { type: 'cursor' }], [U, { type: 'unpause' }]];
    const run = drive(N, evs);
    const sfAt = ref.states[P0 - 1].sf; // the song frame the pause frame would have played
    // sf holds for the whole pause
    const drift = [];
    for (let f = P0; f < U; f++) if (run.states[f].sf !== sfAt || !run.states[f].paused) drift.push(f);
    if (drift.length) bad.push(`${tag}: sf moved or the pause dropped on ${drift.length} frames (first ${drift[0]}: sf ${run.states[drift[0]].sf})`);
    // the song is silent: only the jingle (20 frames) and the cursor tick (3) sound; the DMC is cut on the
    // pause frame ($4015 = $0F) and no drum starts until the unpause
    const p1 = channelTrace(run.writes, 'p1');
    const p2 = channelTrace(run.writes, 'p2');
    const tri = channelTrace(run.writes, 't');
    const noi = channelTrace(run.writes, 'n');
    const wP = run.writes[P0];
    if (!wP.some((x, i) => i % 2 === 0 && x === 0x4015 && wP[i + 1] === 0x0f)) bad.push(`${tag}: no $4015 = $0F on the pause frame`);
    const loud = [];
    for (let f = P0; f < U; f++) {
      const w = run.writes[f];
      if (has(w, 0x4010) || has(w, 0x4012) || has(w, 0x4013) || has(w, 0x4015, 0x10)) loud.push(`frame ${f}: a drum starts`);
      const inFx = f < P0 + 20 || (f >= P0 + 60 && f < P0 + 63);
      if (!inFx && (p1[f].v || p2[f].v)) loud.push(`frame ${f}: a pulse sounds`);
      if (tri[f].on && f > P0) loud.push(`frame ${f}: the triangle sounds`);
      if (noi[f].v) loud.push(`frame ${f}: the noise sounds`);
    }
    if (loud.length) bad.push(`${tag}: the song is not silent: ${loud.slice(0, 4).join('; ')}${loud.length > 4 ? ` (+${loud.length - 4})` : ''}`);
    // effects keep running: the jingle on both pulses, the cursor tick on pulse 2
    const jingle = p1.slice(P0, P0 + 20).filter((x) => x.v > 0).length + p2.slice(P0, P0 + 20).filter((x) => x.v > 0).length;
    const tick = p2.slice(P0 + 60, P0 + 63).filter((x) => x.v > 0).length;
    if (jingle < 30 || tick < 2) bad.push(`${tag}: the jingle sounded ${jingle} pulse frames, the cursor tick ${tick}`);
    // what reaches the speaker: silence between the jingle and the tick (every channel, the DMC included)
    const sr = 48000;
    const spf = sr / 60;
    const all = evs.map(([f, e]) => Object.assign({ f }, e));
    const buf = A.synth(sr, { events: all, samples: (P0 + 70) * spf, foley: false });
    let e2 = 0;
    for (let i = (P0 + 25) * spf; i < (P0 + 58) * spf; i++) e2 += buf[i] * buf[i];
    const rms = Math.sqrt(e2 / (33 * spf));
    if (!(rms < 1e-3)) bad.push(`${tag}: the output is not silent while paused (rms ${rms.toExponential(2)})`);
    // unpause: the same sf, the sounding voices retriggered, then register for register the unpaused song
    if (run.states[U].sf !== sfAt + 1 || run.states[U].paused) bad.push(`${tag}: unpause played sf ${run.states[U].sf - 1}, want ${sfAt}`);
    if (P0 === midNotes) {
      const wU = run.writes[U];
      const miss = [[0x4007, 'pulse 2'], [0x400b, 'the triangle'], [0x400f, 'the noise']].filter(([a]) => !has(wU, a)).map(([, n]) => n);
      if (miss.length) bad.push(`${tag}: unpause did not retrigger ${miss.join(', ')}`);
    }
    const heard = audible(run.writes);
    const refHeard = audible(refW);
    let firstDiff = -1;
    for (let k = 10; k < N - U && firstDiff < 0; k++) if (heard[U + k] !== refHeard[P0 + k] || run.states[U + k].sf !== ref.states[P0 + k].sf) firstDiff = k;
    if (firstDiff >= 0) bad.push(`${tag}: ${firstDiff} frames after the unpause the song no longer matches the unpaused song`);
    lines.push(`${tag}: sf held at ${sfAt} for ${HOLD} frames, output rms ${rms.toExponential(1)} between the jingle and the tick; unpause resumed sf ${sfAt} and matched the unpaused song for ${N - U - 10} frames`);
  }
  // a song event always clears the pause
  const s2 = drive(200, [song, [50, { type: 'pause' }], [80, { type: 'song', id: 'sky' }]]);
  if (s2.states[80].paused || s2.states[81].sf !== 2 || s2.states[81].song !== 'sky') bad.push(`a song event during the pause did not clear it: ${JSON.stringify(s2.states[81])}`);
  else lines.push('a song event during a pause clears it: the new song plays from its top');
  // a pause with no song, then a song: the song runs from its top
  const idle = drive(60, [[5, { type: 'pause' }], [30, { type: 'unpause' }], [40, { type: 'song', id: 'death' }]]);
  if (idle.states[59].sf !== 20) bad.push(`a pause with no song left the next song at sf ${idle.states[59].sf}`);
  report('pause', !bad.length, 'the driver pause holds sf, silences the song and lets effects play; unpause resumes the same sf', bad.length ? bad : lines);
}

// ---------------------------------------------------------------- 6 the game's level songs (when P3 has landed)
{
  const sb = filmSandbox();
  // the engine hangs its tables on FILM.__cq; World 1 has landed, so a missing table is a failure, not a skip
  const defs = sb && sb.FILM && sb.FILM.__cq && sb.FILM.__cq.GAME_DEFS;
  if (!defs) report('levels', false, 'FILM.__cq.GAME_DEFS is missing: src/game/01-world1.js did not load in the sandbox');
  else {
    const bad = [];
    const used = new Set();
    for (const d of Object.values(defs)) {
      if (d.song && d.song !== 'none') used.add(d.song);
      if (d.bossSong) used.add(d.bossSong);
    }
    for (const s of used) {
      if (!SONGS.has(s)) bad.push(`${s}: no such song`);
      else if (!SONGS.has(s + 'Fast')) bad.push(`${s}: no ${s}Fast for the hurry-up`);
    }
    report('levels', !bad.length, `every level and boss song in CQ.GAME_DEFS exists with its fast variant: ${[...used].join(', ')}`, bad);
  }
}

// ---------------------------------------------------------------- 7 film invariance (spec 10.4)
function filmSandbox() {
  if (filmSandbox.sb !== undefined) return filmSandbox.sb;
  const SRC = H.SRC;
  const sb = { console, Math, Float32Array, Float64Array, Uint32Array, Int32Array, Int16Array, Uint16Array, Uint8Array, Uint8ClampedArray, Int8Array, Map, Set, WeakMap, Object, Array, Number, String, Boolean, Error, TypeError, RangeError, JSON, isFinite, isNaN, parseInt, parseFloat, Symbol, Proxy, Reflect, Infinity, NaN };
  sb.window = sb;
  sb.globalThis = sb;
  sb.FILM = {};
  vm.createContext(sb);
  const gameDir = path.join(SRC, 'game');
  const files = ['core.js', 'lib.js', 'manifest.js'].map((f) => path.join(SRC, f)).concat(fs.readdirSync(gameDir).filter((f) => f.endsWith('.js')).sort().map((f) => path.join(gameDir, f)), ['timeline.js', 'foley.js', 'music.js'].map((f) => path.join(SRC, f)));
  try {
    for (const f of files) vm.runInContext(fs.readFileSync(f, 'utf8'), sb, { filename: f });
    filmSandbox.sb = sb;
  } catch (e) {
    filmSandbox.err = e;
    filmSandbox.sb = null;
  }
  return filmSandbox.sb;
}
{
  const sb = filmSandbox();
  if (!sb) report('film', false, `the film's scripts did not load in Node: ${filmSandbox.err && filmSandbox.err.message}`);
  else {
    const ev = sb.FILM.game.events();
    const js = JSON.stringify(ev);
    let eh = 0x811c9dc5 | 0;
    for (let i = 0; i < js.length; i++) eh = Math.imul(eh ^ js.charCodeAt(i), 0x01000193);
    eh = (eh >>> 0).toString(16).padStart(8, '0');
    const buf = sb.FILM.audio.synth(48000);
    const h = H.fnv(buf);
    const ok = h === FILM_AUDIO_HASH && buf.length === FILM_SAMPLES;
    const why = ok ? [] : [eh === FILM_EVENTS_HASH ? 'the film events are unchanged: the sound changed (src/music.js)' : `the film events changed (hash ${eh}, baseline ${FILM_EVENTS_HASH}): the engine broke film invariance`];
    report('film', ok, `FILM.audio.synth(48000) over the film's ${ev.length} events (hash ${eh}, baseline ${FILM_EVENTS_HASH}): ${buf.length} samples, hash ${h} (baseline ${FILM_AUDIO_HASH})`, why);
  }
}

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} of ${results.length} checks FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
