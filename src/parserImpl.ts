import { Manifest, Parser } from './interfaces/interfaces';
import { Parser as M3u8Parser } from 'm3u8-parser';

export class ParserImpl implements Parser {
  parse(index: Buffer): Manifest {
    const parser = new M3u8Parser();
    parser.push(index.toString());
    parser.end();
    return parser.manifest;
  }
}
