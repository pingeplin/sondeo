import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures'
);

export const fx = (...p: string[]): string => path.join(FIXTURES, ...p);
export const readFx = (...p: string[]): Buffer => fs.readFileSync(fx(...p));
export const readHex = (...p: string[]): Buffer =>
  Buffer.from(readFx(...p).toString().trim(), 'hex');

export interface FixtureMeta {
  segmentCount: number;
  durations: number[];
  totalDuration: number;
  key: string;
  explicitIv: string;
  mediaSequence: number;
  expectedStreams: { count: number; codecs: string[] };
}

export const meta = (): FixtureMeta =>
  JSON.parse(readFx('meta.json').toString()) as FixtureMeta;

/** Zero-padded segment filename, matching the fixture/runtime convention. */
export const segName = (index: number): string =>
  `seg${String(index).padStart(5, '0')}.ts`;
