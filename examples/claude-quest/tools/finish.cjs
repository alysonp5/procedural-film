#!/usr/bin/env node
// finish.cjs : engine render + real clips laid over it + loudness -> the delivered master (instrument mode).
//
//   node tools/finish.cjs                 render, composite, normalise, phone transcode
//   node tools/finish.cjs --skip-render   reuse exports/<slug>-raw.mp4
//
// finish.json at the project root:
//   {
//     "overlays": [
//       { "clip": "assets/video/shore.mp4", "from": 4.85, "to": 5.975, "at": 0 },
//       { "clip": "assets/video/shore.mp4", "from": 0.5, "to": 3.0, "at": 25, "focusIn": { "sigma": 6, "dur": 0.6 } }
//     ],
//     "lufs": -14, "truePeak": -1.5, "phone": 720
//   }
//   overlay   a clip segment [from, to) laid full-frame over the render at global time `at`; the
//             engine keeps drawing underneath, so a clip that runs short shows the render, never black.
//             Generate a clip from the engine's own frame at `at` (1:1) so the handover does not jump.
//   focusIn   the clip starts blurred (gaussian sigma, matching an engine blur of the same px) and
//             pulls sharp over dur seconds: the handover from a defocused engine frame.
// Audio: one measured linear gain to `lufs`, then a true-peak limiter. Never a single-pass loudnorm:
// it compresses the dynamics and fills in a quiet ending.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('./common.cjs');

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const slug = path.basename(C.ROOT);
const cfgFile = path.join(C.ROOT, 'finish.json');
if (!fs.existsSync(cfgFile)) {
  console.error('finish: finish.json is missing at the project root (see the header of tools/finish.cjs)');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const exp = path.join(C.ROOT, 'exports');
fs.mkdirSync(exp, { recursive: true });
const RAW = path.join(exp, `${slug}-raw.mp4`);
const OUT = path.join(exp, `${slug}.mp4`);
const PHONE = path.join(exp, `${slug}-phone.mp4`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe', maxBuffer: 1 << 26 });
  if (r.status !== 0) {
    console.error(`${cmd} failed:\n${r.stderr || ''}`);
    process.exit(1);
  }
  return (r.stdout || '') + (r.stderr || '');
}

if (!process.argv.includes('--skip-render')) run('node', [path.join(__dirname, 'render.cjs'), '--workers', '4', '--out', RAW], { inherit: true });
if (!fs.existsSync(RAW)) {
  console.error(`finish: ${path.relative(C.ROOT, RAW)} is missing (run without --skip-render)`);
  process.exit(1);
}
const dur = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', RAW]).trim());

// integrated loudness of the score, measured once
const ebu = run(FFMPEG, ['-nostats', '-i', RAW, '-af', 'ebur128', '-f', 'null', '-']);
const I = Number((/Summary:[\s\S]*?\bI:\s*(-?[\d.]+) LUFS/.exec(ebu) || [])[1]);
const target = cfg.lufs != null ? cfg.lufs : -14;
const gain = isFinite(I) ? Math.round((target - I) * 100) / 100 : 0;
const limit = Math.pow(10, (cfg.truePeak != null ? cfg.truePeak : -1.5) / 20).toFixed(3);
console.log(`score ${I} LUFS -> gain ${gain} dB, true-peak limit ${limit}`);

// video graph: every overlay is its own input, trimmed, scaled to the frame, shifted to `at`
const inputs = ['-i', RAW];
const parts = [];
let last = '0:v';
const W = Number(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', RAW]).trim());
const H = Number(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height', '-of', 'csv=p=0', RAW]).trim());
// overlays are resampled to the render's own frame rate (the timeline's fps, e.g. 60/1)
const RATE = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', RAW]).trim() || '24';
(cfg.overlays || []).forEach((o, k) => {
  const src = path.resolve(C.ROOT, o.clip);
  if (!fs.existsSync(src)) {
    console.error(`finish: overlay ${k}: ${o.clip} not found`);
    process.exit(1);
  }
  inputs.push('-i', src);
  const n = k + 1;
  const len = o.to - o.from;
  let chain = `[${n}:v]scale=${W}:${H}:flags=lanczos,setsar=1,fps=${RATE},trim=start=${o.from}:end=${o.to},setpts=PTS-STARTPTS`;
  if (o.focusIn) {
    parts.push(`${chain},split=2[o${n}a][o${n}b]`);
    parts.push(`[o${n}b]gblur=sigma=${o.focusIn.sigma || 6},format=yuva420p,fade=t=out:st=0.05:d=${o.focusIn.dur || 0.6}:alpha=1[o${n}bl]`);
    parts.push(`[o${n}a][o${n}bl]overlay=format=auto,setpts=PTS+${o.at}/TB[o${n}]`);
  } else {
    parts.push(`${chain},setpts=PTS+${o.at}/TB[o${n}]`);
  }
  parts.push(`[${last}][o${n}]overlay=enable='between(t,${o.at},${(o.at + len - 1e-3).toFixed(3)})':eof_action=pass[v${n}]`);
  last = `v${n}`;
});
const graph = parts.length ? parts.join(';\n') + `;\n[${last}]format=yuv420p[v]` : '[0:v]format=yuv420p[v]';
run(FFMPEG, [
  '-v', 'error', '-y', ...inputs,
  '-filter_complex', graph,
  '-map', '[v]', '-map', '0:a',
  '-af', `volume=${gain}dB,aresample=192000,alimiter=limit=${limit}:attack=1:release=60:level=disabled,aresample=48000`,
  '-ar', '48000',
  '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', String(dur), OUT,
]);
const ph = cfg.phone || 720;
const phH = Math.round((ph * H) / W / 2) * 2;
run(FFMPEG, ['-v', 'error', '-y', '-i', OUT, '-vf', `scale=${ph}:${phH}`, '-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k', PHONE]);
const post = run(FFMPEG, ['-nostats', '-i', OUT, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
const I2 = (/Summary:[\s\S]*?\bI:\s*(-?[\d.]+) LUFS/.exec(post) || [])[1];
const LRA = (/LRA:\s*([\d.]+) LU/.exec(post.slice(post.indexOf('Summary'))) || [])[1];
const TP = (/Peak:\s*(-?[\d.]+) dBFS/.exec(post.slice(post.indexOf('Summary'))) || [])[1];
console.log(`-> ${path.relative(C.ROOT, OUT)} (${dur.toFixed(3)} s, ${I2} LUFS, LRA ${LRA} LU, true peak ${TP} dBFS)`);
console.log(`-> ${path.relative(C.ROOT, PHONE)}`);
