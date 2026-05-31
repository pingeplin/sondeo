import { spawn } from 'child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join, resolve } from 'path';
import { Observable } from 'rxjs';
import { Merger } from './interfaces/interfaces';

const FFMPEG_NAMES =
  process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'];

export class MergerImpl implements Merger {
  /** True when an `ffmpeg` executable resolves on PATH, without spawning it. */
  ffmpegAvailable(): boolean {
    for (const dir of (process.env.PATH || '').split(delimiter)) {
      if (!dir) continue;
      for (const name of FFMPEG_NAMES) {
        const candidate = join(dir, name);
        try {
          if (existsSync(candidate) && statSync(candidate).isFile()) {
            return true;
          }
        } catch {
          // unreadable PATH entry — skip
        }
      }
    }
    return false;
  }

  merge(orderedSegmentPaths: string[], outPath: string): Observable<void> {
    return new Observable<void>((sub) => {
      const listDir = mkdtempSync(join(tmpdir(), 'sondeo-concat-'));
      const listPath = join(listDir, 'list.txt');
      const list =
        orderedSegmentPaths
          .map((p) => `file '${resolve(p).replace(/'/g, "'\\''")}'`)
          .join('\n') + '\n';
      writeFileSync(listPath, list);

      const cleanup = () => rmSync(listDir, { recursive: true, force: true });

      // concat demuxer + stream copy: lossless container assembly, no re-encode.
      const proc = spawn(
        'ffmpeg',
        [
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          listPath,
          '-c',
          'copy',
          outPath,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] }
      );

      let stderr = '';
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      proc.on('error', (err) => {
        cleanup();
        sub.error(err);
      });
      proc.on('close', (code) => {
        cleanup();
        if (code === 0) {
          sub.next();
          sub.complete();
        } else {
          sub.error(
            new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`)
          );
        }
      });
    });
  }
}
