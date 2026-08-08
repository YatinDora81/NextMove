/**
 * tests/e2e/helpers/server.ts — the "fixtures served locally" half of SEC 11's e2e row.
 *
 * Content scripts do not run on `file://`, so every fixture has to come over HTTP. This is a
 * deliberately tiny `node:http` server with no dependencies and no dynamic behaviour:
 *
 *   GET /corpus/<path>   →  apps/extension/fixtures/<path>   (the SEC 11 ATS corpus, verbatim)
 *   GET /live/<path>     →  apps/extension/tests/e2e/fixtures/<path>
 *
 * The corpus is hand-authored *static* HTML with no script tags at all, which is exactly right for
 * the unit layer but leaves two e2e behaviours unreachable: a typeahead whose listbox actually
 * opens, and a wizard whose step actually advances. `/live/**` holds the small scripted pages that
 * supply those, and nothing else.
 *
 * Every response carries `Cache-Control: no-store` so a fixture edited between runs is never
 * served stale, and paths are resolved and then re-checked against their root so a `..` cannot
 * escape either directory.
 */

import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';

import { CORPUS_DIR, FIXTURE_PORT, LIVE_FIXTURE_DIR } from './paths';

export interface FixtureServer {
  /** e.g. `http://localhost:4599` */
  readonly origin: string;
  /** `origin` + the corpus path, e.g. `url('/corpus/greenhouse/standard.html')`. */
  url(path: string): string;
  close(): Promise<void>;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
};

function contentTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** Resolve `relative` under `root`, refusing anything that escapes it. */
function safeJoin(root: string, relative: string): string | null {
  const cleaned = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = resolve(join(root, cleaned));
  const rootWithSep = resolve(root) + sep;
  return full.startsWith(rootWithSep) ? full : null;
}

/** Map a request path onto one of the two served roots. */
function resolveRequest(pathname: string): string | null {
  if (pathname.startsWith('/corpus/')) return safeJoin(CORPUS_DIR, pathname.slice('/corpus/'.length));
  if (pathname.startsWith('/live/')) return safeJoin(LIVE_FIXTURE_DIR, pathname.slice('/live/'.length));
  return null;
}

export async function startFixtureServer(port = FIXTURE_PORT): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    const pathname = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    const file = resolveRequest(pathname);

    if (file === null) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`no fixture route for ${pathname}`);
      return;
    }

    readFile(file).then(
      (body) => {
        res.writeHead(200, {
          'content-type': contentTypeFor(file),
          'cache-control': 'no-store',
        });
        res.end(body);
      },
      () => {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`fixture not found: ${pathname}`);
      },
    );
  });

  await new Promise<void>((done, fail) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      fail(
        error.code === 'EADDRINUSE'
          ? new Error(
              `port ${port} is already in use, so the JobFill fixture server cannot start. ` +
                'Stop whatever is holding it, or set JF_E2E_PORT to a free port.',
            )
          : error,
      );
    });
    server.listen(port, '127.0.0.1', done);
  });

  const origin = `http://localhost:${port}`;

  return {
    origin,
    url: (path: string) => `${origin}${path.startsWith('/') ? path : `/${path}`}`,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  };
}
