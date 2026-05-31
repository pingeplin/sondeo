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

const program = commander.program;
program
  .requiredOption('-t, --target <string>', 'm3u8 target url')
  .requiredOption('-o, --out-path <string>', 'output path');

program.parse(process.argv);

const pathExists = fs.existsSync(program.outPath);

if (!pathExists) {
  fs.mkdir(program.outPath, () => {
    console.log(program.outPath, 'created');
  });
}

const injector = new InjectorImpl();
injector.set('Parser', new ParserImpl());
injector.set('Downloader', new DownloaderImpl());
injector.set('Writer', new WriterImpl());
injector.set('Decryptor', new DecryptorImpl());
injector.set('Merger', new MergerImpl());

const wrapper = new Wrapper(program.outPath, injector);
const bar = new Bar();

wrapper.save(program.target).subscribe({
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
