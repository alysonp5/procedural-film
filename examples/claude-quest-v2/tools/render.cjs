#!/usr/bin/env node
// render.cjs : deterministic frame-by-frame render to MP4 with the synthesised soundtrack.
//
//   node tools/render.cjs                                  whole film -> exports/<slug>.mp4 (slug = project folder name)
//   node tools/render.cjs --from 4 --to 9 --scale 0.5 --out exports/test.mp4
//   node tools/render.cjs --workers 6 --scale 2            4K (3840x2160) with six browser processes
//
// Options:
//   --from s, --to s   global seconds (default 0 .. duration)
//   --scale s          render scale (default 1 = the timeline's frame, 1920x1080 for claude-quest; 2 = 4K)
//   --out path         output file (relative paths are from the project root)
//   --workers N        browser processes rendering in parallel (default 1). Every worker count streams
//                      PNG frames straight into one ffmpeg in frame order through a small reorder
//                      window: nothing is written to disk (a 4K film as PNGs would be ~50 GB)
//   --clean            the TV off: FILM.crt.mode = 'clean', a whole-pixel nearest-neighbour upscale
//   --silent           writes a silent stereo track and does not load music.js at all
//   --phone [path]     also write a sharing copy: 1280x720, x264 crf 24, capped to <= 30 MB
//                      (default path: <out>-phone.mp4)
// Audio: AAC through AudioToolbox (aac_at, stereo) when ffmpeg has it (macOS), else the native encoder in mono.
//   --keep             keep the .tmp/ work folder (the WAV)
//   --crf N            x264 quality (default 16)   --preset p   x264 preset (default medium)
//   --fixtures         use tools/fixtures instead of src
//
// Video: libx264, yuv420p (BT.709), crf 16, at the timeline's fps (FILM.TIMELINE.fps, default 24), +faststart. Audio: OfflineAudioContext rendered in the
// page at 48 kHz stereo, written as WAV, muxed as AAC 192k.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const C = require('./common.cjs');

const FFMPEG = process.env.FFMPEG || 'ffmpeg'; // ffmpeg on PATH, or set FFMPEG to a binary
const SR = 48000;

function runFfmpeg(args, { stdin = false } = {}) {
  const proc = spawn(FFMPEG, args, { stdio: [stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
  let err = '';
  proc.stderr.on('data', (d) => (err += d.toString()));
  const done = new Promise((resolve, reject) => {
    proc.on('error', (e) => reject(new Error(`could not start ffmpeg (${FFMPEG}): ${e.message}`)));
    proc.on('close', (code, signal) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${signal || code}\n${err.trim()}`))));
  });
  // mark handled now: ffmpeg can fail while frames are still rendering, before anyone awaits `done`
  done.catch(() => {});
  return { proc, done };
}

function encodeArgs({ input, wav, out, frames, crf, preset, fps }) {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...input,
    '-i', wav,
    '-map', '0:v:0', '-map', '1:a:0',
    '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    ...C.aacArgs(FFMPEG, 192), '-ar', String(SR),
    '-t', (frames / fps).toFixed(6),
    '-movflags', '+faststart',
    out,
  ];
}

async function main() {
  const args = C.parseArgs(process.argv.slice(2), ['fixtures', 'silent', 'keep', 'clean']);
  if (args.phone === 'true') args.phone = true;
  const fixtures = typeof args.fixtures === 'string' ? args.fixtures : !!args.fixtures;
  const silent = !!args.silent;
  const scale = args.scale ? Number(args.scale) : 1;
  const workers = Math.max(1, Math.floor(Number(args.workers || 1)));
  const crf = args.crf != null ? Number(args.crf) : 16;
  const preset = typeof args.preset === 'string' ? args.preset : 'medium';
  const tStart = Date.now();
  const lap = () => ((Date.now() - tStart) / 1000).toFixed(1) + 's';

  const src = C.sources({ fixtures, player: true, needMusic: !silent });
  // a silent render never depends on the score (a score that fails to load cannot stop a picture test)
  if (silent && src.musicFile) src.files = src.files.filter((f) => f !== src.musicFile);
  for (const w of src.warnings) console.log(`[warn] ${w}`);
  const TL = src.timeline;
  const FPS = TL.fps;
  const from = args.from != null ? Number(args.from) : 0;
  const to = args.to != null ? Number(args.to) : TL.duration;
  const f0 = Math.max(0, Math.round(from * FPS));
  const f1 = Math.min(Math.round(TL.duration * FPS), Math.round(to * FPS));
  const frames = f1 - f0;
  if (!(frames > 0)) C.die(`nothing to render: --from ${from} --to ${to} (duration ${TL.duration}s)`);
  const out = C.resolveOut(typeof args.out === 'string' ? args.out : fixtures ? 'exports/fixtures.mp4' : `exports/${C.SLUG}.mp4`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const work = path.join(C.TMP, C.uniqueName('render'));
  fs.mkdirSync(work, { recursive: true });
  const forgetWork = args.keep ? () => {} : C.cleanupOnExit(work);
  const wav = path.join(work, 'audio.wav');
  // ffmpeg writes here; only a complete encode (ffmpeg exit 0, every frame delivered) is moved to --out,
  // so a failed render never replaces a previous good export.
  const partial = path.join(work, 'encode' + (path.extname(out) || '.mp4'));

  console.log(`render ${fixtures ? '(fixtures)' : '(src)'}: frames ${f0}..${f1 - 1} (${frames} frames at ${FPS} fps, ${(frames / FPS).toFixed(3)}s) scale ${scale}, ${workers} worker(s)`);
  console.log(`work folder ${work}`);

  const launches = [];
  let pages = [];
  let enc = null;
  let ok = false;
  try {
    // one browser process per worker so pages really render in parallel
    for (let i = 0; i < workers; i++) launches.push(C.launch());
    const bs = await Promise.all(launches);
    pages = await Promise.all(bs.map((b, i) => C.openPage(b, src.files, { scale, prefix: `render-w${i}` })));
    for (const pg of pages) {
      const problems = [...pg.loadErrors.map((e) => `${e.file}:${e.line}:${e.col} ${e.message}`), ...pg.state.regErrors, ...pg.pageErrors];
      if (problems.length || !pg.info) throw new Error(`scripts failed to load:\n  ${problems.join('\n  ') || 'FILM did not initialise'}`);
    }
    const { w, h } = pages[0].info;
    const tv = await Promise.all(pages.map((pg) => pg.page.evaluate((m) => window.__h.crtMode(m), args.clean ? 'clean' : null)));
    console.log(`canvas ${w}x${h}${tv[0] ? `, display ${tv[0].mode}` : ''}`);

    // ---- audio first: fast, and a broken score fails before minutes of frames
    const tA = Date.now();
    if (silent) {
      const n = Math.round((frames / FPS) * SR);
      C.writeWavFloat(wav, Buffer.alloc(n * 8).toString('base64'), 2, SR);
      console.log(`audio: silent track (${(n / SR).toFixed(3)}s)`);
    } else {
      if (!pages[0].state.hasAudio) throw new Error(`${src.label}/music.js loaded but FILM.audio.render is not a function`);
      let a;
      try {
        a = await pages[0].page.evaluate(([s, e, sr]) => window.__h.audio(s, e, sr), [f0 / FPS, f1 / FPS, SR]);
      } catch (e) {
        throw new Error(`FILM.audio.render failed: ${e.message}`);
      }
      C.writeWavFloat(wav, a.b64, 2, SR);
      console.log(`audio: ${(a.frames / SR).toFixed(3)}s 48 kHz stereo, peak ${a.peak.toFixed(3)}${a.peak > 1 ? ' (CLIPS above 1.0)' : ''}, ${((Date.now() - tA) / 1000).toFixed(1)}s -> ${wav}`);
    }

    // ---- frames
    let done = 0;
    let lastPrint = 0;
    const tV = Date.now();
    const progress = (force) => {
      const now = Date.now();
      if (!force && now - lastPrint < 2000) return;
      lastPrint = now;
      const el = (now - tV) / 1000;
      const fps = done / Math.max(1e-3, el);
      console.log(`frames ${done}/${frames} (${((100 * done) / frames).toFixed(0)}%)  ${fps.toFixed(1)} fps  eta ${((frames - done) / Math.max(1e-3, fps)).toFixed(0)}s`);
    };
    const renderOne = async (pg, f) => {
      const r = await pg.page.evaluate((T) => window.__h.render(T), f / FPS);
      if (r.errors.length) throw new Error(`frame ${f} (T=${(f / FPS).toFixed(3)}, ${r.shot}): ${r.errors.map((e) => e.message).join('; ')}`);
      return Buffer.from(await pg.page.evaluate(() => window.__h.png()), 'base64');
    };

    // Workers claim frames in order and render them in parallel; the writer hands them to ffmpeg's stdin
    // strictly in frame order. A worker may run at most WINDOW frames ahead of the writer, so memory
    // stays at a few frames and a slow encoder applies back-pressure to the renderers.
    enc = runFfmpeg(encodeArgs({ input: ['-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-'], wav, out: partial, frames, crf, preset, fps: FPS }), { stdin: true });
    const stdin = enc.proc.stdin;
    let pipeErr = null;
    let exited = false;
    stdin.on('error', (e) => (pipeErr = e));
    const closed = new Promise((res) => enc.proc.once('close', () => res((exited = true))));
    const encoderGone = async () => {
      if (!pipeErr && !exited) return;
      const why = await enc.done.then(() => (pipeErr ? pipeErr.message : 'exited early'), (e) => e.message);
      throw new Error(`ffmpeg stopped reading frames after ${done} of ${frames}: ${why}`);
    };
    const WINDOW = Math.max(2, workers * 3);
    const ready = new Map();
    let nextClaim = f0;
    let failure = null;
    let wakeWriter = null;
    const waiting = [];
    const kick = () => {
      if (wakeWriter) {
        const w = wakeWriter;
        wakeWriter = null;
        w();
      }
    };
    const release = () => waiting.splice(0).forEach((r) => r());
    const worker = async (pg) => {
      while (!failure) {
        while (!failure && nextClaim - (f0 + done) >= WINDOW) await new Promise((r) => waiting.push(r));
        if (failure || nextClaim >= f1) return;
        const f = nextClaim++;
        try {
          ready.set(f, await renderOne(pg, f));
        } catch (e) {
          failure = failure || e;
        }
        kick();
      }
    };
    const writer = async () => {
      for (let f = f0; f < f1; ) {
        if (failure) throw failure;
        const png = ready.get(f);
        if (!png) {
          await new Promise((r) => (wakeWriter = r));
          continue;
        }
        ready.delete(f);
        await encoderGone();
        if (!stdin.write(png)) {
          await Promise.race([new Promise((res) => stdin.once('drain', res)), closed]);
          await encoderGone();
        }
        done++;
        f++;
        release();
        progress(false);
      }
    };
    try {
      await Promise.all([writer(), ...pages.map((pg) => worker(pg))]);
    } catch (e) {
      failure = failure || e;
      release();
      kick();
      throw failure;
    }
    if (failure) throw failure;
    stdin.end();
    progress(true);
    console.log(`frames rendered in ${((Date.now() - tV) / 1000).toFixed(1)}s (${(frames / Math.max(1e-3, (Date.now() - tV) / 1000)).toFixed(1)} fps), encoding...`);
    await enc.done;
    if (done !== frames) throw new Error(`only ${done} of ${frames} frames were rendered`);
    if (!fs.existsSync(partial) || fs.statSync(partial).size === 0) throw new Error(`ffmpeg exited 0 but wrote no output at ${partial}`);
    try {
      fs.renameSync(partial, out);
    } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      fs.copyFileSync(partial, out + '.partial');
      fs.renameSync(out + '.partial', out);
      fs.rmSync(partial, { force: true });
    }
    ok = true;
  } finally {
    if (enc && enc.proc.exitCode === null && enc.proc.signalCode === null) {
      enc.proc.kill('SIGKILL');
      await enc.done.catch(() => {});
    }
    await Promise.all(pages.map((pg) => pg.close()));
    await Promise.all(launches.map((p) => p.then((b) => b.close()).catch(() => {})));
    fs.rmSync(partial, { force: true });
    if (!args.keep) {
      fs.rmSync(work, { recursive: true, force: true });
      forgetWork();
    } else if (!ok) {
      console.log(`kept work folder ${work} (no partial video)`);
    }
  }
  const size = fs.statSync(out).size;
  console.log(`wrote ${out} (${(size / 1024 / 1024).toFixed(2)} MB, ${frames} frames, ${(frames / FPS).toFixed(3)}s) total ${lap()}`);
  if (args.phone) await phoneCopy(out, typeof args.phone === 'string' ? C.resolveOut(args.phone) : out.replace(/\.[a-z0-9]+$/i, '') + '-phone.mp4', frames / FPS, FPS);
}

// The sharing copy: 1280x720 at the film's frame rate, crf 24, with a bitrate cap so the file stays under
// 30 MB whatever the picture holds (the CRT's texture costs bits); re-encoded tighter if it still is not.
async function phoneCopy(src, dst, dur, fps) {
  const LIMIT = 30 * 1000 * 1000;
  const audioK = 128;
  let capK = Math.floor((LIMIT * 8 * 0.95) / dur / 1000) - audioK;
  const tmp = dst + '.partial.mp4';
  for (let attempt = 0; attempt < 3; attempt++) {
    const enc = runFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error', '-i', src,
      '-vf', 'scale=1280:720:flags=lanczos,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-maxrate', `${capK}k`, '-bufsize', `${capK * 2}k`,
      '-r', String(fps), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      ...C.aacArgs(FFMPEG, audioK), '-ar', String(SR),
      '-movflags', '+faststart', tmp,
    ]);
    await enc.done;
    const size = fs.statSync(tmp).size;
    if (size <= LIMIT) {
      fs.renameSync(tmp, dst);
      console.log(`phone copy ${dst} (${(size / 1024 / 1024).toFixed(2)} MB, 1280x720, crf 24, cap ${capK} kb/s)`);
      return;
    }
    capK = Math.floor(capK * (LIMIT / size) * 0.92);
  }
  fs.rmSync(tmp, { force: true });
  throw new Error(`phone copy stayed above 30 MB after 3 attempts`);
}

main().catch((e) => {
  console.error(`\n[error] ${e && e.message ? e.message : e}`);
  process.exit(2);
});
