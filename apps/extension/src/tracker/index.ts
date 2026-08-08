/**
 * tracker/index.ts — barrel for the Application Tracker (JF-001 Rev 3.0 SEC 6.7, F-12).
 *
 *   ./capture     SEC 6.7 auto-capture priority chain (JSON-LD → adapter selectors → heuristics)
 *                 plus `extractJobDescription()`, the JD text used as AI context.
 *   ./detectors   confirmation detection. PURE OBSERVATION — nothing in it touches the page (INV-1).
 *   ./service     the tracker itself over the Dexie `applications` table: log, status transitions,
 *                 query, the SEC 6.7 stats strip, CSV/JSON export and JSON import.
 *
 * The `tracker` namespace is the ergonomic call surface for the service worker's `TRACKER_*`
 * handlers (`tracker.logFill(...)`, `tracker.query(...)`); the flat re-exports exist for callers
 * that want a single symbol.
 */

export * as tracker from './service';

export * from './capture';
export * from './detectors';
export * from './service';
