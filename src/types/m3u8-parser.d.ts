declare module 'm3u8-parser' {
  export class Parser {
    [key: string]: any;
    manifest: Manifest;
  }
  export interface Manifest {
    allowCache: boolean;
    discontinuityStarts: any[];
    mediaSequence?: number;
    segments: Segment[];
    playlists: Playlist[];
    mediaGroups: MediaGroups;
  }

  export interface Segment {
    duration: number;
    uri: string;
    timeline: number;
    key?: Key;
    map?: { uri: string };
  }

  export interface MediaGroups {
    AUDIO: Audio;
    VIDEO: Audio;
    'CLOSED-CAPTIONS': Audio;
    SUBTITLES: Audio;
  }

  export interface Audio {}

  export interface Playlist {
    attributes: Attributes;
    uri: string;
    timeline: number;
  }

  export interface Attributes {
    CODECS: string;
    'FRAME-RATE': string;
    RESOLUTION: Resolution;
    BANDWIDTH: number;
    'PROGRAM-ID': number;
  }

  export interface Resolution {
    width: number;
    height: number;
  }

  export interface Key {
    method: string;
    uri: string;
    iv: number[];
  }
}
