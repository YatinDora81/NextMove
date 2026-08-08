/**
 * ui/components/cx.ts — the two-line class-name joiner every primitive uses.
 *
 * SEC 14.1 R-3: `apps/extension` may not import `@repo/ui`, so the extension's UI kit is its own,
 * deliberately tiny thing. That includes not pulling `clsx` in for eight lines of code.
 */

export type ClassValue = string | false | null | undefined;

/** Join the truthy class names, collapsing whitespace. */
export function cx(...values: ClassValue[]): string {
  const parts: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) parts.push(trimmed);
  }
  return parts.join(' ');
}
