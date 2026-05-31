// One-shot DEV TOOL — NOT run during tests.
//
// Mints the synthetic HLS fixtures the test suite reads as committed static
// files. libx264 output is not byte-stable across ffmpeg builds, so the test
// suite never regenerates: it reads the committed outputs of this script.
//
// To regenerate: `node tests/fixtures/generate.mjs` then commit the results.
// Requires ffmpeg/ffprobe on PATH (generated with ffmpeg 8.1.1).
//
// Produces, under tests/fixtures/:
//   plain/seg0000{0,1,2}.ts        cleartext MPEG-TS segments (the plaintext)
//   enc-explicit/seg0000{n}.ts     AES-128-CBC(K, V) of each plain segment
//   enc-derived/seg0000{n}.ts      AES-128-CBC(K, IV=BE128(mediaSeq=0 + n))
//   enc.key                        the 16-byte AES key (key-URI target)
//   key.hex, iv.hex                K and the explicit IV V as hex text
//   meta.json                      durations + expected ffprobe layout
//   *.m3u8                         cleartext / encrypted / fMP4 / SAMPLE-AES

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SEG_COUNT = 3;
const SEG_SECONDS = 1;

// Fixed, known key + explicit IV so the byte-exact decrypt tests are stable.
const K = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const V = Buffer.from('f0e0d0c0b0a090807060504030201000', 'hex');

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}
function mkdir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function ts(name) {
  return `seg${String(name).padStart(5, '0')}.ts`;
}

// 16-byte big-endian IV from a media-sequence number (RFC 8216 §5.2).
function ivFromSeq(n) {
  const iv = Buffer.alloc(16);
  let v = BigInt(n);
  for (let i = 15; i >= 0; i--) {
    iv[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return iv;
}

function encrypt(plain, iv) {
  const c = crypto.createCipheriv('aes-128-cbc', K, iv); // PKCS#7 (default)
  return Buffer.concat([c.update(plain), c.final()]);
}

const plainDir = path.join(DIR, 'plain');
const encExplicitDir = path.join(DIR, 'enc-explicit');
const encDerivedDir = path.join(DIR, 'enc-derived');
for (const d of [plainDir, encExplicitDir, encDerivedDir]) {
  rmrf(d);
  mkdir(d);
}

// 1) Mint a single short A/V source and split into concat-compatible segments.
//    testsrc and sine are SEPARATE lavfi inputs (not "testsrc/sine").
const total = SEG_COUNT * SEG_SECONDS;
const segPattern = path.join(plainDir, 'seg%05d.ts');
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-f', 'lavfi', '-i', `testsrc=size=160x90:rate=15`,
    '-f', 'lavfi', '-i', `sine=frequency=1000:sample_rate=44100`,
    '-t', String(total),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    // Force a keyframe at every segment boundary so the segment muxer can
    // actually split into SEG_COUNT pieces (libx264's default GOP would not).
    '-force_key_frames', `expr:gte(t,n_forced*${SEG_SECONDS})`,
    '-c:a', 'aac',
    '-f', 'segment', '-segment_time', String(SEG_SECONDS),
    '-segment_format', 'mpegts', '-reset_timestamps', '1',
    segPattern,
  ],
  { stdio: 'ignore' }
);

const plainFiles = fs
  .readdirSync(plainDir)
  .filter((f) => f.endsWith('.ts'))
  .sort();

// 2) Encrypt each plaintext segment two ways.
plainFiles.forEach((f, i) => {
  const plain = fs.readFileSync(path.join(plainDir, f));
  fs.writeFileSync(path.join(encExplicitDir, ts(i)), encrypt(plain, V));
  fs.writeFileSync(path.join(encDerivedDir, ts(i)), encrypt(plain, ivFromSeq(i)));
});

// 3) Key material.
fs.writeFileSync(path.join(DIR, 'enc.key'), K);
fs.writeFileSync(path.join(DIR, 'key.hex'), K.toString('hex') + '\n');
fs.writeFileSync(path.join(DIR, 'iv.hex'), V.toString('hex') + '\n');

// 4) Per-segment durations + expected ffprobe layout, via ffprobe.
function probeDuration(file) {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nokey=1:noprint_wrappers=1',
    file,
  ]);
  return parseFloat(out.toString().trim());
}
const durations = plainFiles.map((f) => probeDuration(path.join(plainDir, f)));
const probeJson = JSON.parse(
  execFileSync('ffprobe', [
    '-v', 'error',
    '-show_format', '-show_streams',
    '-of', 'json',
    path.join(plainDir, plainFiles[0]),
  ]).toString()
);
const codecs = probeJson.streams.map((s) => s.codec_name).sort();

const meta = {
  segmentCount: plainFiles.length,
  durations,
  totalDuration: durations.reduce((a, b) => a + b, 0),
  key: K.toString('hex'),
  explicitIv: V.toString('hex'),
  mediaSequence: 0,
  expectedStreams: { count: probeJson.streams.length, codecs },
};
fs.writeFileSync(path.join(DIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

// 5) Playlists. Segment URIs are bare filenames; the test Downloader maps
//    them to fixture files (no real network).
const extinf = (i) => `#EXTINF:${durations[i].toFixed(6)},`;
const seglist = (rel) =>
  plainFiles.map((_, i) => `${extinf(i)}\n${rel}/${ts(i)}`).join('\n');

const header = (extra = '') =>
  ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:1', '#EXT-X-MEDIA-SEQUENCE:0', extra]
    .filter(Boolean)
    .join('\n');

fs.writeFileSync(
  path.join(DIR, 'cleartext.m3u8'),
  `${header()}\n${seglist('plain')}\n#EXT-X-ENDLIST\n`
);
fs.writeFileSync(
  path.join(DIR, 'encrypted-explicit.m3u8'),
  `${header(`#EXT-X-KEY:METHOD=AES-128,URI="enc.key",IV=0x${V.toString('hex')}`)}\n${seglist('enc-explicit')}\n#EXT-X-ENDLIST\n`
);
fs.writeFileSync(
  path.join(DIR, 'encrypted-derived.m3u8'),
  `${header('#EXT-X-KEY:METHOD=AES-128,URI="enc.key"')}\n${seglist('enc-derived')}\n#EXT-X-ENDLIST\n`
);
fs.writeFileSync(
  path.join(DIR, 'fmp4.m3u8'),
  `${header('#EXT-X-MAP:URI="init.mp4"')}\n#EXTINF:1.000000,\nfmp4-seg00000.m4s\n#EXT-X-ENDLIST\n`
);
fs.writeFileSync(
  path.join(DIR, 'sample-aes.m3u8'),
  `${header('#EXT-X-KEY:METHOD=SAMPLE-AES,URI="enc.key"')}\n${seglist('enc-explicit')}\n#EXT-X-ENDLIST\n`
);

console.log(`Generated ${plainFiles.length} segments; total ${meta.totalDuration.toFixed(3)}s; streams ${codecs.join('+')}`);
