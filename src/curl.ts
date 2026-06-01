// Parse a curl command line into the parts sondeo needs: the request URL and
// the request headers. Targets the output of browsers' "Copy as cURL" — a
// possibly multi-line, backslash-continued command with repeated -H flags.

export interface CurlRequest {
  url?: string;
  headers: Record<string, string>;
}

// Split a shell-ish command string into argv tokens, honoring single quotes,
// double quotes, $'...' ANSI-C quotes, backslash escapes and `\<newline>` line
// continuations. Not a full POSIX shell — just enough for curl command lines.
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let started = false; // track empty quoted tokens (e.g. "")
  let i = 0;
  const n = input.length;

  const push = () => {
    if (started) tokens.push(cur);
    cur = '';
    started = false;
  };

  while (i < n) {
    const c = input[i];

    if (c === '\\') {
      const next = input[i + 1];
      if (next === '\n') {
        i += 2; // line continuation — drop backslash + newline
      } else if (next !== undefined) {
        cur += next;
        started = true;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (c === "'") {
      started = true;
      i += 1;
      while (i < n && input[i] !== "'") cur += input[i++];
      i += 1; // closing quote
      continue;
    }

    if (c === '$' && input[i + 1] === "'") {
      started = true;
      i += 2;
      const esc: Record<string, string> = {
        n: '\n',
        t: '\t',
        r: '\r',
        "'": "'",
        '\\': '\\',
      };
      while (i < n && input[i] !== "'") {
        if (input[i] === '\\' && input[i + 1] in esc) {
          cur += esc[input[i + 1]];
          i += 2;
        } else {
          cur += input[i++];
        }
      }
      i += 1;
      continue;
    }

    if (c === '"') {
      started = true;
      i += 1;
      while (i < n && input[i] !== '"') {
        if (input[i] === '\\') {
          const next = input[i + 1];
          if (next === '"' || next === '\\' || next === '$' || next === '`') {
            cur += next;
            i += 2;
            continue;
          }
          if (next === '\n') {
            i += 2;
            continue;
          }
        }
        cur += input[i++];
      }
      i += 1;
      continue;
    }

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      push();
      i += 1;
      continue;
    }

    cur += c;
    started = true;
    i += 1;
  }
  push();
  return tokens;
}

// Flags whose value we accept but discard (method, body, output, timeouts …).
const IGNORED_VALUE_FLAGS = new Set([
  '-X',
  '--request',
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-ascii',
  '--data-urlencode',
  '-o',
  '--output',
  '-w',
  '--write-out',
  '-m',
  '--max-time',
  '--connect-timeout',
  '--retry',
  '-T',
  '--upload-file',
]);

export function parseCurl(input: string): CurlRequest {
  const tokens = tokenize(input);
  const headers: Record<string, string> = {};
  let url: string | undefined;

  const setHeader = (raw: string) => {
    const sep = raw.indexOf(':');
    if (sep === -1) return;
    headers[raw.slice(0, sep).trim()] = raw.slice(sep + 1).trim();
  };

  for (let i = 0; i < tokens.length; i++) {
    let tok = tokens[i];
    if (i === 0 && tok === 'curl') continue;

    // Support `--flag=value` in addition to `--flag value`.
    let inlineVal: string | undefined;
    if (tok.startsWith('--') && tok.includes('=')) {
      const eq = tok.indexOf('=');
      inlineVal = tok.slice(eq + 1);
      tok = tok.slice(0, eq);
    }
    const value = (): string =>
      inlineVal !== undefined ? inlineVal : tokens[++i] ?? '';

    if (tok === '-H' || tok === '--header') {
      setHeader(value());
    } else if (tok === '-A' || tok === '--user-agent') {
      headers['User-Agent'] = value();
    } else if (tok === '-e' || tok === '--referer') {
      headers['Referer'] = value();
    } else if (tok === '-b' || tok === '--cookie') {
      headers['Cookie'] = value();
    } else if (tok === '--url') {
      url = value();
    } else if (IGNORED_VALUE_FLAGS.has(tok)) {
      value(); // consume and drop
    } else if (tok.startsWith('-')) {
      // Boolean flag (e.g. --compressed, -L, -s); nothing to consume.
    } else if (!url) {
      url = tok; // first bare token is the URL
    }
  }

  return { url, headers };
}
