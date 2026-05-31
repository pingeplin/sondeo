import { describe, expect, it } from 'vitest';
import { parseCurl, tokenize } from '../src/curl';

describe('tokenize', () => {
  it('splits on whitespace and strips single/double quotes', () => {
    expect(tokenize(`curl 'https://a/b' -H "x: y"`)).toEqual([
      'curl',
      'https://a/b',
      '-H',
      'x: y',
    ]);
  });

  it('treats `\\<newline>` as a line continuation, not a token break', () => {
    expect(tokenize("curl 'https://a' \\\n  -H 'x: y'")).toEqual([
      'curl',
      'https://a',
      '-H',
      'x: y',
    ]);
  });
});

describe('parseCurl', () => {
  // Browsers' "Copy as cURL" output: URL in single quotes + repeated -H flags
  // across backslash-continued lines.
  it('extracts the URL and every header from a copy-as-cURL command', () => {
    const cmd = `curl 'https://surrit.com/abc/video.m3u8' \\
  -H 'accept: */*' \\
  -H 'referer: https://missav.ai/dm26/maan-647' \\
  -H 'user-agent: Mozilla/5.0 (Macintosh) Chrome/148.0.0.0'`;

    expect(parseCurl(cmd)).toEqual({
      url: 'https://surrit.com/abc/video.m3u8',
      headers: {
        accept: '*/*',
        referer: 'https://missav.ai/dm26/maan-647',
        'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/148.0.0.0',
      },
    });
  });

  it('maps -A/-e/-b short flags onto the canonical header names', () => {
    const { headers } = parseCurl(
      `curl https://a -A 'UA/1.0' -e https://ref -b 'k=v'`
    );
    expect(headers).toEqual({
      'User-Agent': 'UA/1.0',
      Referer: 'https://ref',
      Cookie: 'k=v',
    });
  });

  it('ignores value-bearing flags it does not need (method, body, output)', () => {
    const { url, headers } = parseCurl(
      `curl -X POST https://a --data 'k=v' -o out.bin --compressed -H 'x: 1'`
    );
    expect(url).toBe('https://a');
    expect(headers).toEqual({ x: '1' });
  });

  it('accepts --header=value as well as --header value', () => {
    expect(parseCurl(`curl https://a --header='x: 1'`).headers).toEqual({
      x: '1',
    });
  });
});
