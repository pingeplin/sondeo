import { MediaGroups, Playlist, Segment } from 'm3u8-parser';
import { Observable } from 'rxjs';

export interface Status {
  downloaded: number;
  total: number;
}

export interface Result {
  name: string;
  data: DataView;
}

export interface Downloader {
  url: URL | undefined;
  headers?: Record<string, string>;
  download(target: string): Observable<Result>;
}

export interface Parser {
  parse(index: ArrayBuffer): Manifest;
}

export interface Writer {
  writeFile(path: string, data: DataView): Observable<void>;
}

export interface Decryptor {
  decrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array;
}

export interface Merger {
  ffmpegAvailable(): boolean;
  merge(orderedSegmentPaths: string[], outPath: string): Observable<void>;
}

export interface Manifest {
  allowCache: boolean;
  discontinuityStarts: any[];
  mediaSequence?: number;
  segments: Segment[];
  playlists: Playlist[];
  mediaGroups: MediaGroups;
}

export interface Injector {
  get<T>(token: any, ...args: any): T;
}
