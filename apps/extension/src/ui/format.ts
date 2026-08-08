/**
 * ui/format.ts — display helpers shared by the popup and the Options app.
 *
 * Deliberately not imported from `@/ai/errors` (which has its own `formatCountdown`): the popup
 * must not pull the whole Gemini layer into its bundle just to render "00:47".
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * SEC 5.6 countdown: "ready again in 00:47". Renders MM:SS under an hour and H:MM:SS above it, so
 * a 30-minute strike-3 cooldown never reads as an ambiguous "30:00".
 */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00';
  const total = Math.ceil(ms / 1_000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3_600);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Short absolute date: "7 Aug 2026". Empty string for null/0 so callers can render an em dash. */
export function formatDate(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined || epochMs <= 0) return '';
  return new Date(epochMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined || epochMs <= 0) return '';
  return new Date(epochMs).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "3 days ago" / "in 2 hours". Falls back to an absolute date past a month. */
export function formatRelative(epochMs: number | null | undefined, now: number = Date.now()): string {
  if (epochMs === null || epochMs === undefined || epochMs <= 0) return 'never';
  const delta = epochMs - now;
  const abs = Math.abs(delta);
  if (abs < MINUTE) return 'just now';
  if (abs > 30 * DAY) return formatDate(epochMs);

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < HOUR) return rtf.format(Math.round(delta / MINUTE), 'minute');
  if (abs < DAY) return rtf.format(Math.round(delta / HOUR), 'hour');
  return rtf.format(Math.round(delta / DAY), 'day');
}

/** `<input type="date">` value from an epoch, and back. Empty string round-trips to null. */
export function toDateInput(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined || epochMs <= 0) return '';
  const date = new Date(epochMs);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function fromDateInput(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Date.parse(`${value}T12:00:00`);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Bytes → "1.4 MB". Resume blobs are the only thing this is used for. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const label = units[unit] ?? 'B';
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${label}`;
}

export function plural(count: number, one: string, many: string = `${one}s`): string {
  return count === 1 ? one : many;
}

/** "23 of 26 fields" → 0.88. Guards the 0/0 case the tracker sees for a draft row. */
export function ratio(filled: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, filled / total));
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Host of a URL, for compact table cells. Returns the raw string if it will not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Trim to `max` characters on a word boundary and append an ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  const kept = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${kept.trimEnd()}…`;
}

/** Title Case for enum-ish values: "flash-lite" → "Flash lite", "applied" → "Applied". */
export function titleCase(value: string): string {
  const spaced = value.replace(/[-_]+/g, ' ').trim();
  if (spaced.length === 0) return '';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
