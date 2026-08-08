import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');

const ENTRY = join(SRC, 'entrypoints', 'background.ts');

type NodeId = string;

interface Edge {
  from: NodeId;
  specifier: string;
}

interface Graph {
  local: Set<string>;
  external: Set<string>;
  origin: Map<NodeId, Edge>;
  unresolved: Array<{ from: string; specifier: string }>;
}

function readSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.ESNext,
    false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const found: string[] = [];
  const push = (node: ts.Expression | undefined): void => {
    if (node !== undefined && ts.isStringLiteralLike(node)) found.push(node.text);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
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
const ASSET_EXTENSIONS = ['.json', '.css', '.svg', '.png', '.txt'] as const;

function resolveSpecifier(specifier: string, from: string): Resolution {
  let base: string;
  if (specifier === '@' || specifier === '~') base = SRC;
  else if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('~/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
  else return { kind: 'external' };

  const candidates: string[] = [base];
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
    expect(graph.local.size).toBeGreaterThan(30);
    expect([...graph.local]).toContain(join(SRC, 'background', 'router.ts'));
    expect([...graph.local]).toContain(join(SRC, 'ai', 'index.ts'));
    expect(graph.external.size).toBeGreaterThan(0);
  });

  it('every local specifier in the graph resolved', () => {
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

  it('still reaches @/ai/prompts — the worker is what talks to Gemini', () => {
    expect([...graph.local]).toContain(AI_PROMPTS);
  });

  it('still reaches the F-02 regex fallback in @/ai/resume-text', () => {
    expect([...graph.local]).toContain(AI_RESUME_TEXT);
    expect(readFileSync(AI_RESUME_TEXT, 'utf8')).toMatch(
      /export function parseProfileFromText\b/,
    );
  });
});

const OUT = join(ROOT, 'build', 'chrome-mv3');
const BACKGROUND_JS = join(OUT, 'background.js');
const CONTENT_JS = join(OUT, 'content-scripts', 'content.js');

const BACKGROUND_BUDGET_BYTES = 600_000;
const CONTENT_BUDGET_BYTES = 700_000;

const BUILD_PRESENT = existsSync(BACKGROUND_JS) && existsSync(CONTENT_JS);
const SKIP_NOTE = BUILD_PRESENT
  ? ''
  : ' [SKIPPED — no build/chrome-mv3; run `pnpm --filter extension build`]';

if (!BUILD_PRESENT) {
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
