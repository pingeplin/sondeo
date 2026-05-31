# sondeo

A small command-line tool for downloading **HLS / `.m3u8` video streams** into a
single playable **`.mp4`**.

`sondeo` fetches a playlist, downloads every media segment (with bounded
concurrency and a live progress bar), decrypts AES-128-encrypted segments
in-process, and merges them — in playlist order — into one `.mp4` via `ffmpeg`.

## Features

- Download an HLS playlist and all of its `.ts` segments (5 concurrent, over a
  keep-alive HTTPS connection).
- **In-process AES-128-CBC decryption** of encrypted segments (`#EXT-X-KEY`),
  using both explicit (`IV=`) and sequence-derived IVs (RFC 8216 §5.2).
- **Merge into a true `.mp4`** in playlist order via the `ffmpeg` concat demuxer
  (`-c copy`, lossless — no re-encode).
- Live ASCII progress bar (`[####.....] 40% (20/50)`).
- Normalizes segments disguised with image extensions
  (`.jpg/.jpeg/.png/.gif/.bmp/.webp`) → `.ts`.
- Fails fast with clear errors: missing `ffmpeg`, fMP4 (`#EXT-X-MAP`), and
  non-AES-128 encryption are rejected before downloading.

## Requirements

- Node.js 18+ (developed/tested on 22)
- [`ffmpeg`](https://ffmpeg.org/) on your `PATH` — **required**. `sondeo`
  preflight-checks for it and aborts with an install hint if it is missing
  (e.g. `brew install ffmpeg`).

## Install

```bash
npm install
npm run build      # bundles src/ → dist/main.js via webpack
```

To use the `sondeo` command globally:

```bash
npm link
```

## Usage

```bash
sondeo -t <m3u8-url> -o <output-dir>
```

| Option           | Required | Description            |
| ---------------- | -------- | ---------------------- |
| `-t, --target`   | yes      | The `.m3u8` target URL |
| `-o, --out-path` | yes      | Output directory       |

The output directory is created if it does not exist. The merged file is written
to `<out-dir>/<playlist-name>.mp4`.

### Example

```bash
sondeo -t "https://example.com/path/playlist.m3u8" -o ./output
# → ./output/playlist.mp4
```

## How it works

`sondeo` is a small dependency-injected pipeline built on RxJS:

```
main.ts ──> Wrapper.save(target)
                │
                ├─ Merger       preflight: ffmpeg on PATH? (else abort)
                ├─ Downloader   fetch the .m3u8
                ├─ Parser       parse with m3u8-parser
                │               ↳ guards: reject fMP4 / non-AES-128
                ├─ Downloader   fetch the AES key first (if encrypted)
                ├─ Downloader   download segments, 5 at a time (mergeMap, 5)
                │   └─ Decryptor   AES-128-CBC decrypt each (if encrypted)
                ├─ Writer       write each segment to an indexed temp file
                └─ Merger       barrier → ffmpeg concat (in index order) → .mp4
```

| File                           | Responsibility                                       |
| ------------------------------ | ---------------------------------------------------- |
| `src/main.ts`                  | CLI entry point (commander), DI wiring, progress bar |
| `src/wrapper.ts`               | Orchestrates the pipeline (ordering, guards, errors) |
| `src/downloaderImpl.ts`        | HTTPS downloads with a keep-alive agent              |
| `src/parserImpl.ts`            | Thin wrapper over `m3u8-parser`                      |
| `src/decryptorImpl.ts`         | AES-128-CBC decryption (Node `crypto`)               |
| `src/iv.ts`                    | Explicit / sequence-derived IV helpers               |
| `src/mergerImpl.ts`            | ffmpeg preflight + concat-demuxer merge to `.mp4`    |
| `src/writerImpl.ts`            | Async file writes as Observables                     |
| `src/bar.ts`                   | In-place ASCII progress bar                          |
| `src/injectorImpl.ts`          | Simple service-locator dependency injection          |
| `src/interfaces/interfaces.ts` | Core contracts (Downloader/Parser/Writer/…)          |

## Supported scope

v1 targets **AES-128, single-codec, TS VOD** playlists. The following are
detected and rejected (rather than mishandled), or simply out of scope:

- fMP4 / `#EXT-X-MAP` initialization-segment streams — rejected.
- `SAMPLE-AES` / DRM — rejected (only `METHOD=AES-128`).
- Mid-playlist key rotation (multiple `#EXT-X-KEY` tags) — assumes one key.
- Master-playlist variant selection, re-encoding, and download resume.

## Development

```bash
npm test           # vitest — unit + ffmpeg-backed integration tests
npm run build      # webpack build to dist/main.js
```

Test fixtures under `tests/fixtures/` are synthetic (minted by
`tests/fixtures/generate.mjs`, a one-shot dev tool) and committed as static
files. Code is formatted with Prettier (enforced on commit via Husky +
pretty-quick).

## License

MIT
