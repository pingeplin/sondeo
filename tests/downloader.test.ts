import { createServer, Server } from 'node:https';
import { execFileSync } from 'node:child_process';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Observable } from 'rxjs';
import { DownloaderImpl } from '../src/downloaderImpl';
import { Result } from '../src/interfaces/interfaces';

// Self-signed cert minted once for the in-process HTTPS server.
function selfSigned(): { key: string; cert: string } {
  const pem = execFileSync('openssl', [
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
  return {
    key: pem.match(
      /-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/
    )![0],
    cert: pem.match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/
    )![0],
  };
}

const first = (obs: Observable<Result>): Promise<Result> =>
  new Promise((resolve, reject) =>
    obs.subscribe({ next: resolve, error: reject })
  );

describe('DownloaderImpl over a non-default port', () => {
  let server: Server;
  let port: number;
  const prevReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

  beforeEach(async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    server = createServer(selfSigned(), (req, res) => {
      res.end(`served:${req.url}`);
    });
    port = await new Promise<number>((resolve) =>
      server.listen(0, '127.0.0.1', () =>
        resolve((server.address() as AddressInfo).port)
      )
    );
  });

  afterEach(() => {
    server.close();
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevReject;
  });

  // Regression: host:port was passed as `host`, so Node tried to DNS-resolve
  // "127.0.0.1:<port>" → ENOTFOUND. A URL with an explicit port must work.
  it('connects to a host with an explicit port instead of DNS-resolving host:port', async () => {
    const dl = new DownloaderImpl();
    dl.url = new URL(`https://127.0.0.1:${port}/dir/index.m3u8`);

    const result = await first(dl.download('seg0.ts'));
    const body = Buffer.from(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength
    ).toString();

    expect(body).toBe('served:/dir/seg0.ts');
  });

  // CDNs like surrit.com 403 requests without a browser User-Agent / site
  // Referer; `headers` must be forwarded on every request so they pass.
  it('forwards custom request headers to the server', async () => {
    const seen: Record<string, string | string[] | undefined> = {};
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      seen.referer = req.headers['referer'];
      seen['user-agent'] = req.headers['user-agent'];
      res.end('ok');
    });

    const dl = new DownloaderImpl();
    dl.url = new URL(`https://127.0.0.1:${port}/dir/index.m3u8`);
    dl.headers = {
      Referer: 'https://missav.ai/dm26/maan-647',
      'User-Agent': 'Mozilla/5.0 sondeo-test',
    };

    await first(dl.download('seg0.ts'));

    expect(seen.referer).toBe('https://missav.ai/dm26/maan-647');
    expect(seen['user-agent']).toBe('Mozilla/5.0 sondeo-test');
  });
});
