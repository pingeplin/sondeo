import { Downloader, Result } from './interfaces/interfaces';
import https, { Agent, RequestOptions } from 'https';
import { Observable } from 'rxjs';

export class DownloaderImpl implements Downloader {
  url: URL | undefined;
  // Extra request headers (e.g. User-Agent, Referer) sent on every request.
  // Some CDNs 403 requests that lack a browser User-Agent or a site Referer.
  headers: Record<string, string> = {};
  private agent = new Agent({ keepAlive: true });

  download(target: string): Observable<Result> {
    return new Observable((sub) => {
      if (!this.url) {
        sub.error('');
        return;
      }

      // Split host and port: `host` (with a port) would be DNS-resolved
      // verbatim by https.get, so a non-default port must go in `port`.
      const hostname = this.url.hostname;
      const port = this.url.port || undefined;
      const basePath = this.url.pathname
        .split('/')
        .filter((e) => e)
        .slice(0, -1);

      // Separate target path from its query string
      const [targetPath, ...queryParts] = target.split('?');
      const targetSegments = targetPath.split('/').filter((e) => e);

      // Encode each path segment safely (decode first to avoid double-encoding)
      const allSegments = [...basePath, ...targetSegments];
      const encodedPath =
        '/' +
        allSegments
          .map((seg) => {
            try {
              return encodeURIComponent(decodeURIComponent(seg));
            } catch {
              return encodeURIComponent(seg);
            }
          })
          .join('/');

      const search =
        queryParts.length > 0 ? '?' + queryParts.join('?') : this.url.search;

      const option: RequestOptions = {
        hostname,
        port,
        path: encodedPath + search,
        agent: this.agent,
        headers: this.headers,
      };

      const req = https.get(option, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          sub.error(new Error(`HTTP ${res.statusCode} for ${target}`));
          res.resume();
          return;
        }

        const data: Buffer[] = [];
        res
          .on('data', (chunk: any) => {
            data.push(chunk);
          })
          .on('end', () => {
            const buffer = Buffer.concat(data);
            const dv = new DataView(
              buffer.buffer,
              buffer.byteOffset,
              buffer.length
            );
            sub.next({
              name: target,
              data: dv,
            });

            sub.complete();
          });
      });
      req.on('error', (err) => sub.error(err));
    });
  }
}
