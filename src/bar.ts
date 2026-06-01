import * as tty from 'tty';

export class Bar {
  private readonly stdout: tty.WriteStream;
  private maxValue = 0;
  private dx = 0;

  constructor(stdout: tty.WriteStream = process.stdout) {
    this.stdout = stdout;
  }

  setMaxValue(value: number): void {
    if (!value || Number.isNaN(value) || this.maxValue) {
      return;
    }

    this.maxValue = value;
  }

  private getCurrentPercent(value: number): number {
    return Math.round((value / this.maxValue) * 100);
  }

  write(value: number): void {
    const cp = this.getCurrentPercent(value);
    this.dx = Math.floor(cp / 4);

    // cursorTo exists only on a TTY; when stdout is piped (CI, cron, `| tee`)
    // it's undefined, so fall back to a carriage return for the in-place update.
    if (typeof this.stdout.cursorTo === 'function') {
      this.stdout.cursorTo(0);
    } else {
      this.stdout.write('\r');
    }
    const str = `[${'#'.repeat(this.dx)}${'.'.repeat(
      25 - this.dx
    )}] ${cp}% (${value}/${this.maxValue})`;
    this.stdout.write(str);
  }
}
