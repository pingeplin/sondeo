import commander from 'commander';
import { Wrapper } from './wrapper';
import { Bar } from './bar';
import fs from 'fs';
import { InjectorImpl } from './injectorImpl';
import { ParserImpl } from './parserImpl';
import { DownloaderImpl } from './downloaderImpl';
import { WriterImpl } from './writerImpl';
import { DecryptorImpl } from './decryptorImpl';
import { MergerImpl } from './mergerImpl';
import { parseCurl } from './curl';

// Accumulate repeatable `-H "Name: Value"` flags into a single headers object.
function collectHeader(
  raw: string,
  acc: Record<string, string>
): Record<string, string> {
  const sep = raw.indexOf(':');
  if (sep === -1) {
    throw new commander.InvalidOptionArgumentError(
      `header must be in "Name: Value" form, got: ${raw}`
    );
  }
  acc[raw.slice(0, sep).trim()] = raw.slice(sep + 1).trim();
  return acc;
}

// Resolve a `--curl` value: `@file` reads a file, `-` reads stdin, anything
// else is the inline command string.
function readCurlSource(value: string): string {
  if (value === '-') return fs.readFileSync(0, 'utf8');
  if (value.startsWith('@')) return fs.readFileSync(value.slice(1), 'utf8');
  return value;
}

const program = commander.program;
program
  .option('-t, --target <string>', 'm3u8 target url')
  .requiredOption('-o, --out-path <string>', 'output path')
  .option(
    '-H, --header <header>',
    'extra request header "Name: Value" (repeatable)',
    collectHeader,
    {}
  )
  .option(
    '--curl <curl>',
    'a curl command to take the URL and headers from ' +
      '(inline string, @file, or - for stdin)'
  );

program.parse(process.argv);

// Derive target + headers, letting an explicit -t / -H override the curl.
let target: string | undefined = program.target;
let headers: Record<string, string> = program.header;
if (program.curl) {
  const parsed = parseCurl(readCurlSource(program.curl));
  target = target ?? parsed.url;
  headers = { ...parsed.headers, ...program.header };
}

if (!target) {
  console.error('a target URL is required: pass -t <url> or --curl <command>');
  process.exit(1);
}

const pathExists = fs.existsSync(program.outPath);

if (!pathExists) {
  fs.mkdir(program.outPath, () => {
    console.log(program.outPath, 'created');
  });
}

const injector = new InjectorImpl();
const downloader = new DownloaderImpl();
downloader.headers = headers;
injector.set('Parser', new ParserImpl());
injector.set('Downloader', downloader);
injector.set('Writer', new WriterImpl());
injector.set('Decryptor', new DecryptorImpl());
injector.set('Merger', new MergerImpl());

const wrapper = new Wrapper(program.outPath, injector);
const bar = new Bar();

wrapper.save(target).subscribe({
  next: (status) => {
    bar.setMaxValue(status.total);
    bar.write(status.downloaded);
  },
  error: (err) => {
    console.error('\n' + (err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  },
  complete: () => {
    console.log('\nDone.');
  },
});
