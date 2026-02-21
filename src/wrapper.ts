import { from, Observable, Subject, throwError } from 'rxjs';
import {
  Data,
  Downloader,
  Injector,
  Parser,
  Status,
  Writer,
} from './interfaces/interfaces';
import { mergeMap, switchMap } from 'rxjs/operators';

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|bmp|webp)/g;

export class Wrapper {
  private readonly outPath: string;
  private data: Data;
  private parser: Parser;
  private downloader: Downloader;
  private writer: Writer;

  constructor(outPath: string, injector: Injector) {
    this.outPath = outPath;

    this.data = new Data();
    this.parser = injector.get('Parser');
    this.downloader = injector.get('Downloader');
    this.writer = injector.get('Writer');
  }

  save(target: string): Observable<Status> {
    const notify = new Subject<Status>();
    let downloadedCount = 0;

    const url = new URL(target);
    this.downloader.url = url;
    const fileName = url.pathname.split('/').slice(-1)[0];
    this.downloader
      .download(fileName)
      .pipe(
        switchMap((result) => {
          const manifest = this.parser.parse(
            Buffer.from(
              result.data.buffer,
              result.data.byteOffset,
              result.data.byteLength
            )
          );

          const fileName = result.name.split('?')[0];
          const filePath = this.outPath + '/' + fileName;

          const m3u8Str = Buffer.from(
            result.data.buffer,
            result.data.byteOffset,
            result.data.byteLength
          ).toString();
          const rewritten = Buffer.from(m3u8Str.replace(IMAGE_EXT_RE, '.ts'));
          this.writer.writeFile(
            filePath,
            new DataView(
              rewritten.buffer,
              rewritten.byteOffset,
              rewritten.byteLength
            )
          );

          if (!manifest.segments || manifest.segments.length === 0) {
            return throwError('error');
          }

          const partsSet = new Set<string>();
          const key = manifest.segments[0].key;
          if (key) {
            partsSet.add(key.uri);
          }
          for (const segment of manifest.segments) {
            partsSet.add(segment.uri);
          }
          this.data.parts = Array.from(partsSet);

          notify.next({ total: this.data.parts.length, downloaded: 0 });
          return from(this.data.parts).pipe(
            mergeMap((part) => this.downloader.download(part), 5)
          );
        }),
        mergeMap((result) => {
          const fileName = result.name
            .split('?')[0]
            .replace(IMAGE_EXT_RE, '.ts');
          const filePath = this.outPath + '/' + fileName;
          downloadedCount++;
          notify.next({
            total: this.data.parts.length,
            downloaded: downloadedCount,
          });
          return this.writer.writeFile(filePath, result.data);
        })
      )
      .subscribe({
        error: (err) => notify.error(err),
        complete: () => notify.complete(),
      });

    return notify.asObservable();
  }
}
