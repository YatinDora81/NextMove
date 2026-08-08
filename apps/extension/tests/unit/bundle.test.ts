/**
 * tests/unit/bundle.test.ts — JF-001 Rev 3.0 SEC 11 "bundle-size budget", made real (finding D6).
 *
 * ── The regression this file exists to stop ─────────────────────────────────────────────────────
 * The MV3 service worker once shipped at **2,463,415 B**. Not because anything imported pdfjs-dist
 * eagerly, but because `src/ai/index.ts` re-exported the resume *file* reader, which `await`s
 * `import('pdfjs-dist')` and `import('mammoth')`. In a normal Vite app that dynamic import is a
 * split point and costs nothing until it runs. In an MV3 background entry it is not: WXT/rolldown
 * emits the background as a SINGLE file, because a classic-script service worker cannot load
 * sibling chunks at runtime. So every dynamic `import()` reachable from the worker's module graph
 * is **inlined**, and Chrome re-parses all of it on every worker wake-up — which, for an
 * event-driven worker, is constantly.
 *
 * The fix (SEC 4.3 Flow C) moved extraction to where it belongs: the Options page opens the PDF or
 * DOCX locally, shows the user the extracted text, and `RESUME_PARSE` carries **text** across the
 * bus. `src/ai/resume-extract.ts` — the heavy half — is imported by `src/ui/panels/ResumesPanel.tsx`
 * and by nothing else. background.js came down to 342,967 B.
 *
 * Nothing protected that. The only defence was a prose comment at the bottom of `ai/index.ts`, and
 * a single `import { extractResumeText } from '@/ai/resume-extract'` added anywhere under
 * `src/background/**` would silently put ~1.6 MB back into the worker with a green build. This file
 * plus the `no-restricted-imports` block in `eslint.config.js` are the three independent guards:
 *
 *   Layer 1  static module graph  — this file, runs in the normal unit suite, needs no build.
 *   Layer 2  byte budget          — this file, needs `build/`, skips cleanly without it.
 *   Layer 3  lint                 — `eslint.config.js`, catches the bad import at authoring time.
 *
 * They overlap on purpose. Layer 3 is the fastest and most legible but ESLint's
 * `no-restricted-imports` does not see a *transitive* reach (background → `@/ai` → resume-extract),
 * so it can only ever forbid the direct edge. Layer 1 sees the whole graph, including dynamic
 * `import()`, but reasons about source rather than about what rolldown actually emitted. Layer 2
 * measures the artifact itself and so cannot be argued with — but it needs a build, and a ceiling
 * is a blunt instrument that says "something got big" rather than "here is who did it". All three,
 * or the budget stops meaning anything.
 *
 * ── Layer 1 over-approximates, deliberately ─────────────────────────────────────────────────────
 * The source graph is a superset of what rolldown emits, and that was confirmed by experiment while
 * writing this file: a `export { extractResumeText } from '@/ai/resume-extract'` reached from the
 * entry by a side-effect-only `import '@/background/probe'` trips layer 1, but tree-shakes away
 * completely and leaves background.js at 345 kB. Change that probe to an actual reachable *call*
 * and the same build produces 2,466,041 B.
 *
 * So a layer-1 failure means "the worker's source graph can now see a PDF parser", not always "the
 * bundle grew". That is the correct direction for a guard — it can raise a false alarm, it can
 * never give a false all-clear — and the fix for a false alarm is to delete the import rather than
 * to weaken the rule, because an import that tree-shakes today starts shipping the moment someone
 * calls it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');

/** The MV3 service-worker entry. Everything rolldown puts in background.js starts here. */
const ENTRY = join(SRC, 'entrypoints', 'background.ts');

/* ================================================================================================
 * LAYER 1 — the static module graph
 * ============================================================================================== */

/**
 * A node id: an absolute path for a local source file, or the raw specifier for a bare package
 * (`pdfjs-dist`, `pdfjs-dist/build/pdf.worker.mjs`, `zod`, …). Packages are leaves — the walk stops
 * at the `node_modules` boundary, which is why the forbidden set is expressed as package names
 * rather than as "any file that transitively pulls a PDF parser".
 */
type NodeId = string;

/** How a node was first reached, so a failure can print the chain rather than just the verdict. */
interface Edge {
  from: NodeId;
  specifier: string;
}

interface Graph {
  /** Local source files reachable from the entry, including the entry itself. */
  local: Set<string>;
  /** Bare specifiers reachable from the entry, verbatim as written. */
  external: Set<string>;
  origin: Map<NodeId, Edge>;
  /** Local-looking specifiers the resolver could not place — a hole in the guard, asserted empty. */
  unresolved: Array<{ from: string; specifier: string }>;
}

/**
 * Every specifier this file contributes to the runtime bundle.
 *
 * Parsed with the real TypeScript scanner rather than a regex, because the distinctions that
 * matter here are exactly the ones regexes get wrong:
 *
 *   `import type { X } from 'y'`      erased at build time    → not followed
 *   `export type { X } from 'y'`      erased at build time    → not followed
 *   `typeof import('pdfjs-dist')`     an ImportTypeNode, a type position → not followed
 *   `export * from './prompts'`       real                    → followed
 *   `import './side-effect'`          real                    → followed
 *   `await import('mammoth')`         real, and INLINED here  → followed
 *
 * A value import of a module that happens to export only types is still followed, per the D6 brief:
 * the import survives to the bundler, and what the bundler does with it is not this test's guess to
 * make. Over-approximating the graph is the safe direction for a guard — it can produce a false
 * alarm, never a false all-clear.
 */
function readSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const found: string[] = [];
  const push = (node: ts.Expression | undefined): void => {
    if (node !== undefined && ts.isStringLiteralLike(node)) found.push(node.text);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      // A bare `import './x'` has no clause at all, and it is a real value import.
      if (node.importClause?.isTypeOnly !== true) push(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly) push(node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      push(node.arguments[0]);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      push(node.moduleReference.expression);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

type Resolution =
  | { kind: 'local'; file: string }
  | { kind: 'external' }
  | { kind: 'unresolved' };

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs'] as const;
/** Importable but not parseable — they end the walk without ending the guard. */
const ASSET_EXTENSIONS = ['.json', '.css', '.svg', '.png', '.txt'] as const;

/**
 * `@/` → `src/`, plus Vite's extensionless relative resolution. Deliberately does NOT consult
 * `node_modules`: anything that is not `@/`-aliased or relative is a package, and packages are the
 * leaves this guard is written in terms of.
 */
function resolveSpecifier(specifier: string, from: string): Resolution {
  let base: string;
  if (specifier === '@' || specifier === '~') base = SRC;
  else if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('~/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
  else return { kind: 'external' };

  const candidates: string[] = [base];
  // `./foo.js` under bundler resolution is `./foo.ts` on disk. Not the house style here, but a
  // resolver that silently gives up on one is a resolver that silently stops guarding.
  if (/\.m?js$/.test(base)) {
    candidates.push(base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'));
  }
  for (const extension of SOURCE_EXTENSIONS) candidates.push(base + extension);
  for (const extension of ASSET_EXTENSIONS) candidates.push(base + extension);
  for (const name of ['index.ts', 'index.tsx', 'index.js']) candidates.push(join(base, name));

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return { kind: 'local', file: candidate };
    }
  }
  return { kind: 'unresolved' };
}

const isParseable = (file: string): boolean => /\.[mc]?[tj]sx?$/.test(file);

/** Breadth-first, so `origin` records the SHORTEST chain to every node — the one worth printing. */
function buildGraph(entry: string): Graph {
  const local = new Set<string>([entry]);
  const external = new Set<string>();
  const origin = new Map<NodeId, Edge>();
  const unresolved: Array<{ from: string; specifier: string }> = [];

  const queue: string[] = [entry];
  for (let head = 0; head < queue.length; head += 1) {
    const file = queue[head];
    if (file === undefined) continue;

    for (const specifier of readSpecifiers(file)) {
      const resolution = resolveSpecifier(specifier, file);

      if (resolution.kind === 'external') {
        if (!external.has(specifier)) {
          external.add(specifier);
          origin.set(specifier, { from: file, specifier });
        }
        continue;
      }

      if (resolution.kind === 'unresolved') {
        unresolved.push({ from: file, specifier });
        continue;
      }

      if (local.has(resolution.file)) continue;
      local.add(resolution.file);
      origin.set(resolution.file, { from: file, specifier });
      if (isParseable(resolution.file)) queue.push(resolution.file);
    }
  }

  return { local, external, origin, unresolved };
}

const label = (node: NodeId): string =>
  isAbsolute(node) ? relative(ROOT, node) : `${node}  (package)`;

/**
 * `src/entrypoints/background.ts`
 * `  → '@/ai'                src/ai/index.ts`
 * `  → './resume-extract'    src/ai/resume-extract.ts`
 * `  → 'pdfjs-dist'          (package)`
 *
 * "background.js got big" is a useless failure. The chain names the exact edge to delete.
 */
function importChain(graph: Graph, target: NodeId): string {
  const hops: Array<{ specifier: string; node: NodeId }> = [];
  const seen = new Set<NodeId>();
  let current: NodeId | undefined = target;

  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const edge = graph.origin.get(current);
    if (edge === undefined) break;
    hops.unshift({ specifier: edge.specifier, node: current });
    current = edge.from;
  }

  const lines = [label(ENTRY)];
  for (const hop of hops) lines.push(`  → '${hop.specifier}'  ${label(hop.node)}`);
  return lines.join('\n');
}

const graph = buildGraph(ENTRY);

/** Reachable, by package name or by any subpath of it. */
function findPackage(name: string): string | undefined {
  return [...graph.external].find(
    (specifier) => specifier === name || specifier.startsWith(`${name}/`),
  );
}

const RESUME_EXTRACT = join(SRC, 'ai', 'resume-extract.ts');
const AI_PROMPTS = join(SRC, 'ai', 'prompts', 'index.ts');
const AI_RESUME_TEXT = join(SRC, 'ai', 'resume-text.ts');

const WHY =
  '\n\nThe MV3 worker is emitted as ONE file — a dynamic import() reachable from it is inlined, ' +
  'not split. Extraction belongs in the Options page (SEC 4.3 Flow C): RESUME_PARSE carries ' +
  'already-extracted TEXT. Break the edge printed above rather than raising the budget.';

describe('SEC 11 · service-worker module graph (layer 1 — no build required)', () => {
  it('the walker actually walked something (guards against a vacuously green run)', () => {
    expect(existsSync(ENTRY), `${relative(ROOT, ENTRY)} is missing`).toBe(true);
    // 60-ish today. A collapse to single digits means the resolver broke, not that the worker
    // got lean, and a guard that silently stops looking is worse than no guard.
    expect(graph.local.size).toBeGreaterThan(30);
    expect([...graph.local]).toContain(join(SRC, 'background', 'router.ts'));
    expect([...graph.local]).toContain(join(SRC, 'ai', 'index.ts'));
    expect(graph.external.size).toBeGreaterThan(0);
  });

  it('every local specifier in the graph resolved', () => {
    // An unresolved `@/`-or-relative specifier is a branch of the graph nobody walked, which is
    // precisely where a re-inlined pdfjs would hide.
    expect(
      graph.unresolved.map((miss) => `${relative(ROOT, miss.from)} → '${miss.specifier}'`),
    ).toEqual([]);
  });

  for (const pkg of ['pdfjs-dist', 'mammoth'] as const) {
    it(`never reaches ${pkg}`, () => {
      const hit = findPackage(pkg);
      expect(
        hit === undefined ? null : `${pkg} is reachable:\n${importChain(graph, hit)}${WHY}`,
      ).toBeNull();
    });
  }

  it('never reaches @/ai/resume-extract', () => {
    const hit = graph.local.has(RESUME_EXTRACT) ? RESUME_EXTRACT : undefined;
    expect(
      hit === undefined
        ? null
        : `@/ai/resume-extract is reachable:\n${importChain(graph, hit)}${WHY}`,
    ).toBeNull();
  });

  // The positive half. A future "fix" that deletes the AI layer, or rips out the F-02 regex
  // parser, would satisfy every assertion above — and would also break the product. These two
  // stop the guard from being satisfiable by amputation.
  it('still reaches @/ai/prompts — the worker is what talks to Gemini', () => {
    expect([...graph.local]).toContain(AI_PROMPTS);
  });

  it('still reaches the F-02 regex fallback in @/ai/resume-text', () => {
    expect([...graph.local]).toContain(AI_RESUME_TEXT);
    // Reachability is not enough: the fallback has to still be in there. F-02 / SEC 5.6 — a user
    // with no Gemini key builds their profile with this function and nothing else (INV-3).
    expect(readFileSync(AI_RESUME_TEXT, 'utf8')).toMatch(
      /export function parseProfileFromText\b/,
    );
  });
});

/* ================================================================================================
 * LAYER 2 — the byte budget on the built artifact
 * ============================================================================================== */

const OUT = join(ROOT, 'build', 'chrome-mv3');
const BACKGROUND_JS = join(OUT, 'background.js');
const CONTENT_JS = join(OUT, 'content-scripts', 'content.js');

/**
 * ── Baseline, measured 2026-08-07 on the JF-001 Rev 3.0 build ───────────────────────────────────
 *   background.js                    345,244 B   ← the budgeted artifact
 *   content-scripts/content.js       484,207 B   ← the budgeted artifact
 *   content-scripts/main-world.js      6,957 B
 *   chunks/pdf.worker-*.js         1,186,993 B   ┐ options page only, loaded on demand,
 *   chunks/lib-*.js (mammoth)        497,023 B   │ never parsed by the service worker
 *   chunks/pdf-*.js                  427,307 B   ┘
 *   chunks/useNow-*.js               285,552 B
 *   chunks/options-*.js              186,660 B
 *
 *   background.js BEFORE the SEC 4.3 Flow C fix:                         2,463,415 B.
 *   background.js with the fix reverted as a probe while writing this:   2,466,041 B.
 *
 * These are documentation; the ceilings below are what is enforced. Expect the baseline to drift by
 * a few kB as ordinary feature work lands — that is the point of the gap between the two.
 *
 * The ceilings sit ~1.75x above today and ~4x below the regression. That gap is intentional: a
 * budget that trips on ordinary feature work gets raised until it means nothing, and a budget that
 * only trips at 2.4 MB would have let the worker double first. If a legitimate change pushes past
 * a ceiling, raise it in the same commit and move the baseline above — but check the diff for a
 * vendor library first, because that is what these numbers are actually watching for.
 */
const BACKGROUND_BUDGET_BYTES = 600_000;
const CONTENT_BUDGET_BYTES = 700_000;

const BUILD_PRESENT = existsSync(BACKGROUND_JS) && existsSync(CONTENT_JS);
const SKIP_NOTE = BUILD_PRESENT
  ? ''
  : ' [SKIPPED — no build/chrome-mv3; run `pnpm --filter extension build`]';

if (!BUILD_PRESENT) {
  // Skipping is right for a fresh checkout — failing here would make `pnpm test` depend on a build
  // that CI runs in a separate task. But it must say so out loud, because a budget that quietly
  // stops being checked is the same as not having one.
  console.info(
    '[bundle.test] build/chrome-mv3 not found — the byte-budget assertions are SKIPPED. ' +
      'Run `pnpm --filter extension build` first to enforce them.',
  );
}

const kb = (bytes: number): string => `${(bytes / 1000).toFixed(1)} kB (${bytes} B)`;

function jsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('SEC 11 · bundle-size budget (layer 2 — measures the built artifact)', () => {
  it.skipIf(!BUILD_PRESENT)(`background.js stays under ${kb(BACKGROUND_BUDGET_BYTES)}${SKIP_NOTE}`, () => {
    const size = statSync(BACKGROUND_JS).size;
    expect(
      size,
      `background.js is ${kb(size)}, over the ${kb(BACKGROUND_BUDGET_BYTES)} ceiling. Baseline is ` +
        `345,244 B. Chrome re-parses this whole file on every worker wake-up.${WHY}`,
    ).toBeLessThan(BACKGROUND_BUDGET_BYTES);
  });

  it.skipIf(!BUILD_PRESENT)(`content.js stays under ${kb(CONTENT_BUDGET_BYTES)}${SKIP_NOTE}`, () => {
    const size = statSync(CONTENT_JS).size;
    expect(
      size,
      `content.js is ${kb(size)}, over the ${kb(CONTENT_BUDGET_BYTES)} ceiling. Baseline is ` +
        '484,207 B. This runs in every page the user visits.',
    ).toBeLessThan(CONTENT_BUDGET_BYTES);
  });

  it.skipIf(!BUILD_PRESENT)(`background.js carries no PDF/DOCX vendor code${SKIP_NOTE}`, () => {
    const code = readFileSync(BACKGROUND_JS, 'utf8');
    // Marker strings, not sizes: this catches the case where a vendor library lands in the worker
    // but something else shrank, so the ceiling above still passes.
    for (const marker of [/pdfjs/i, /mammoth/i, /pdf\.worker/i]) {
      const match = marker.exec(code);
      expect(
        match === null
          ? null
          : `background.js contains ${String(marker)} at offset ${match.index}: ` +
            `…${code.slice(Math.max(0, match.index - 60), match.index + 60)}…${WHY}`,
      ).toBeNull();
    }
  });

  it.skipIf(!BUILD_PRESENT)(`the PDF/DOCX readers still ship elsewhere${SKIP_NOTE}`, () => {
    // The other half of the claim. Deleting resume-extract.ts would satisfy every assertion above
    // and would also break F-02 file upload — so prove the libraries MOVED rather than vanished.
    const others = jsFilesUnder(OUT).filter((file) => file !== BACKGROUND_JS);
    const sized = (pattern: RegExp): number[] =>
      others
        .filter((file) => pattern.test(readFileSync(file, 'utf8')))
        .map((file) => statSync(file).size);

    const pdf = sized(/pdfjs/i);
    expect(pdf.length, 'no output chunk contains pdfjs — did resume extraction get deleted?').
      toBeGreaterThan(0);
    expect(Math.max(...pdf), 'the pdfjs chunk is too small to be the real library').toBeGreaterThan(
      200_000,
    );

    const docx = sized(/mammoth/i);
    expect(docx.length, 'no output chunk contains mammoth — did DOCX extraction get deleted?').
      toBeGreaterThan(0);
    expect(Math.max(...docx), 'the mammoth chunk is too small to be the real library').
      toBeGreaterThan(100_000);
  });
});
