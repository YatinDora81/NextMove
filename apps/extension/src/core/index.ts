/**
 * core/index.ts — the matching pipeline's public surface.
 *
 * JF-001 Rev 3.0 SEC 4.3 Flow A, steps 3 and 4:
 *
 *   scan  →  FormScanner walks document + same-origin iframes + open shadow roots → FieldNode[]
 *   match →  FieldMatcher scores each signature against profile paths (SEC 6.3)
 *
 * ```ts
 * import { FieldMatcher, FormScanner, formatValueForField, resolveProfileValue } from '@/core';
 *
 * const { fields, unreachableFrames } = new FormScanner({ frameId }).scan();
 * const results = new FieldMatcher({ profile, userMappings, adapterFieldMap }).match(fields);
 * for (const result of results) {
 *   if (result.action !== 'fill' || result.path === null) continue;   // INV-4
 *   const raw = resolveProfileValue(profile, result.path);
 *   fillEngine.write(result.node, formatValueForField(raw, result.node.sig, result.path));
 * }
 * ```
 *
 * The FillEngine (`core/fill/**`), the PageObserver (`core/observer.ts`) and the adapter registry
 * (`core/adapters/**`) are separate entry points — they depend on this barrel, not the other way
 * round, which keeps the scan/match half of `core/` free of any DOM-writing code.
 */

export * from './hash';
export * from './similarity';
export * from './synonyms';
export * from './signature';
export * from './scanner';
export * from './matcher';
