import { Downloader, Result } from './interfaces/interfaces';
import https, { Agent, RequestOptions } from 'https';
import { Observable } from 'rxjs';

export class DownloaderImpl implements Downloader {
  url: URL | undefined;
  private agent = new Agent({ keepAlive: true });

  download(target: string): Observable<Result> {
    return new Observable((sub) => {
      if (!this.url) {
        sub.error('');
        return;
      }

      const host = this.url.host;
      const pathList = [
        ...this.url.pathname
          .split('/')
          .filter((e) => e)
          .slice(0, -1),
        target,
      ];
      const path = '/' + pathList.join('/') + this.url.search;
      const option: RequestOptions = {
        host,
        path,
        agent: this.agent,
      };

      https.get(option, (res) => {
        const contentLength = +(res.headers['content-length'] || 0);
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
    });
  }
}
