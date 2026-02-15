import { MediaGroups, Playlist, Segment } from 'm3u8-parser';
import { Observable } from 'rxjs';

export class Data {
  parts: string[];

  constructor() {
    this.parts = [];
  }
}

export interface Status {
  downloaded: number;
  total: number;
}

export interface Result {
  name: string;
  data: DataView;
}

export interface Encoder {}

export interface Downloader {
  url: URL | undefined;
  download(target: string): Observable<Result>;
}

export interface Parser {
  parse(index: ArrayBuffer): Manifest;
}

export interface Writer {
  writeFile(path: string, data: DataView): Observable<void>;
}

export interface Manifest {
  allowCache: boolean;
  discontinuityStarts: any[];
  segments: Segment[];
  playlists: Playlist[];
  mediaGroups: MediaGroups;
}

export interface Injector {
  get<T>(token: any, ...args: any): T;
}
