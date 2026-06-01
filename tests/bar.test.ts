import { describe, it, expect } from 'vitest';
import * as tty from 'tty';
import { Bar } from '../src/bar';

// A minimal write stream that captures output. When `cursorTo` is omitted it
// stands in for a piped (non-TTY) stdout, where Node does not attach the TTY
// cursor methods — the case that crashed the CLI under spawn/CI/`| tee`.
function fakeStdout(opts: { tty: boolean }) {
  const writes: string[] = [];
  const stream: any = {
    write: (s: string) => {
      writes.push(s);
      return true;
    },
  };
  if (opts.tty) {
    stream.cursorTo = () => {};
  }
  return { stream: stream as tty.WriteStream, writes };
}

describe('Bar', () => {
  it('renders progress without throwing when stdout is not a TTY', () => {
    const { stream, writes } = fakeStdout({ tty: false });
    const bar = new Bar(stream);
    bar.setMaxValue(4);

    expect(() => bar.write(2)).not.toThrow();

    const out = writes.join('');
    expect(out).toContain('50%');
    expect(out).toContain('(2/4)');
  });

  it('uses cursorTo to repaint in place when stdout is a TTY', () => {
    const { stream, writes } = fakeStdout({ tty: true });
    let cursorCalls = 0;
    (stream as any).cursorTo = () => {
      cursorCalls++;
    };
    const bar = new Bar(stream);
    bar.setMaxValue(10);

    bar.write(10);

    expect(cursorCalls).toBe(1);
    expect(writes.join('')).toContain('100%');
  });
});
