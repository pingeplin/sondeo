// End-to-end smoke test (NOT part of the unit suite).
//
// Proves the built CLI works against a REAL ffmpeg-encrypted AES-128 HLS stream
// served over HTTPS — i.e. that sondeo's Node-crypto decryption agrees with a
// real encoder's encryption, end to end, through the actual download path.
//
// Steps:
//   1. ffmpeg mints a genuine AES-128 HLS stream (real #EXT-X-KEY + IV).
//   2. A throwaway self-signed HTTPS server serves that directory.
//   3. The built CLI (dist/main.js) downloads + decrypts + merges → out.mp4.
//   4. ffprobe validates the result and compares duration to the source.
//
// Run: node scripts/smoke.mjs   (requires a prior `npm run build`)

import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:https';
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC_SECONDS = 4;
const work = mkdtempSync(join(tmpdir(), 'sondeo-smoke-'));
const streamDir = join(work, 'stream');
const outDir = join(work, 'out');
execFileSync('mkdir', ['-p', streamDir, outDir]);

const log = (m) => console.log(`• ${m}`);
let server;
const cleanup = () => {
  try {
    server?.close();
  } catch {}
  rmSync(work, { recursive: true, force: true });
};

try {
  // 1. Mint a real AES-128 HLS stream with ffmpeg.
  log('generating a real AES-128 HLS stream with ffmpeg…');
  const key = execFileSync('openssl', ['rand', '16']); // 16 random bytes
  const keyFile = join(streamDir, 'enc.key');
  execFileSync('sh', ['-c', `cat > "${keyFile}"`], { input: key });
  const iv = execFileSync('openssl', ['rand', '-hex', '16']).toString().trim();
  // key_info_file: line1 = key URI (as written into playlist), line2 = key path, line3 = IV
  const keyInfo = join(streamDir, 'enc.keyinfo');
  execFileSync('sh', ['-c', `cat > "${keyInfo}"`], {
    input: `enc.key\n${keyFile}\n${iv}\n`,
  });

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=320x180:rate=15`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=880:sample_rate=44100`,
      '-t',
      String(SRC_SECONDS),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '15',
      '-c:a',
      'aac',
      '-hls_time',
      '1',
      '-hls_key_info_file',
      keyInfo,
      '-hls_playlist_type',
      'vod',
      '-hls_segment_filename',
      join(streamDir, 'seg%03d.ts'),
      join(streamDir, 'index.m3u8'),
    ],
    { stdio: 'ignore' }
  );

  const playlist = readFileSync(join(streamDir, 'index.m3u8'), 'utf8');
  const segCount = (playlist.match(/\.ts/g) || []).length;
  const encrypted = /#EXT-X-KEY:METHOD=AES-128/.test(playlist);
  log(`stream ready: ${segCount} segments, encrypted=${encrypted}`);
  if (!encrypted)
    throw new Error('ffmpeg did not produce an encrypted playlist');

  // 2. Self-signed HTTPS server over the stream dir.
  const keyPem = execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    '/dev/stdout',
    '-out',
    '/dev/stdout',
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
  ]).toString();
  const certKey = keyPem.match(
    /-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/
  )[0];
  const cert = keyPem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/
  )[0];

  server = createServer({ key: certKey, cert }, (req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0].replace(/^\//, ''));
    const file = join(streamDir, name);
    if (!existsSync(file)) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    createReadStream(file).pipe(res);
  });
  const port = await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  );
  log(`serving stream over https://127.0.0.1:${port}`);

  // 3. Run the BUILT CLI against it (accept the self-signed cert for this run).
  //
  // Use async spawn, NOT spawnSync: this process is also the HTTPS origin
  // serving the segments. spawnSync blocks this event loop until the child
  // exits, which would freeze the server — the CLI's segment requests would
  // never be answered and both sides would deadlock until the timeout fired.
  // Async spawn keeps the loop free to serve while the CLI runs.
  log('running the built sondeo CLI…');
  const cli = await new Promise((resolveCli, rejectCli) => {
    const child = spawn(
      process.execPath,
      [
        'dist/main.js',
        '-t',
        `https://127.0.0.1:${port}/index.m3u8`,
        '-o',
        outDir,
      ],
      { env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' } }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectCli(new Error('CLI timed out (did not exit within 60s)'));
    }, 60000);
    child.on('error', (err) => {
      clearTimeout(timer);
      rejectCli(err);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolveCli({ status, stdout, stderr });
    });
  });
  process.stdout.write(cli.stdout || '');
  if (cli.status !== 0) {
    process.stderr.write(cli.stderr || '');
    throw new Error(`CLI exited ${cli.status}`);
  }

  // 4. Validate the merged output.
  const outFile = join(outDir, 'index.mp4');
  if (!existsSync(outFile))
    throw new Error(`expected output not found: ${outFile}`);
  const probe = JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_format',
      '-show_streams',
      '-of',
      'json',
      outFile,
    ]).toString()
  );
  const duration = parseFloat(probe.format.duration);
  const codecs = probe.streams
    .map((s) => s.codec_name)
    .sort()
    .join('+');
  const sizeKb = Math.round(readFileSync(outFile).length / 1024);

  const durationOk = Math.abs(duration - SRC_SECONDS) < 1.0;
  const mp4Ok = /mp4/.test(probe.format.format_name);
  log(
    `output: index.mp4  ${sizeKb} KB  format=${
      probe.format.format_name
    }  streams=${codecs}  duration=${duration.toFixed(2)}s`
  );

  if (mp4Ok && durationOk) {
    console.log(
      '\n✅ SMOKE PASS — real encrypted HLS → decrypted → valid .mp4'
    );
    cleanup();
    process.exit(0);
  }
  throw new Error(`validation failed: mp4Ok=${mp4Ok} durationOk=${durationOk}`);
} catch (err) {
  console.error(`\n❌ SMOKE FAIL — ${err.message}`);
  cleanup();
  process.exit(1);
}
