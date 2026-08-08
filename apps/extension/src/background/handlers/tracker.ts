/**
 * background/handlers/tracker.ts — the Application Tracker bus surface (F-12 / SEC 6.7).
 *
 * `TRACKER_LOG` · `TRACKER_QUERY` · `TRACKER_UPDATE`, plus `FILL_REPORT` — the message the content
 * script sends when a fill run finishes, which is what actually opens a tracker row.
 *
 * ── INV-1, in the one place it is easiest to get wrong ──────────────────────────────────────────
 * A finished fill is NOT an application. `FILL_REPORT` arriving means "JobFill wrote 23 of 26
 * fields and stopped" — the human has not pressed Submit yet, and JobFill never will. So the row
 * opens as `draft`. Only an OBSERVED confirmation state (thank-you URL or DOM cue, SEC 6.7 step 4)
 * or the user's own statement in the dashboard can promote it to `applied`. `tracker/service.ts`
 * enforces that; this file never sets a status on the fill path.
 *
 * ── Why the service worker owns the writes ──────────────────────────────────────────────────────
 * SEC 4.2: the worker owns storage writes and never touches page DOM. The content script observes
 * and reports; Dexie lives here. That also means a tab closing mid-report cannot corrupt a row.
 */

import { getSettings } from '@/platform/storage';
import { createLogger } from '@/platform/logger';
import { markDirty } from '@/background/sync-scheduler';
import { errReply, okReply } from '@/shared/messages';
import type { MessageHandlers } from '@/shared/messages';
import { tracker } from '@/tracker';

const log = createLogger('bg:tracker');

type TrackerHandlers = Pick<
  MessageHandlers,
  'TRACKER_LOG' | 'TRACKER_QUERY' | 'TRACKER_UPDATE' | 'FILL_REPORT'
>;

/**
 * Flow A step 6: "Fill stats sent to TrackerService".
 *
 * Honours `settings.autoLogApplications` — a user who does not want a local record of every form
 * they touched gets `{logged: false}` and nothing is written. That is a privacy control, not a
 * feature flag (SEC 9): the tracker is the only thing in JobFill that remembers where you applied.
 */
const fillReport: TrackerHandlers['FILL_REPORT'] = async (payload) => {
  const settings = await getSettings();
  if (!settings.autoLogApplications) {
    log.debug('autoLogApplications is off — the fill was not logged');
    return okReply({ logged: false, applicationId: null });
  }

  // A report can arrive for a profile that was deleted between the fill and the report; an empty
  // string is what `ApplicationRow.profileId` uses for "unknown profile" and keeps the row usable.
  const profileId = payload.profileId ?? settings.activeProfileId ?? '';

  // INV-1: `logFill` opens the row as `draft`. Nothing here can promote it.
  const result = await tracker.logFill(payload.report, payload.job, profileId);
  log.info(
    `${result.created ? 'opened' : 'updated'} tracker row ${result.row.id} ` +
      `(${String(payload.report.filled)}/${String(payload.report.perField.length)} filled)`,
  );
  void markDirty('applications');
  return okReply({ logged: true, applicationId: result.row.id });
};

/** Explicit log from the dashboard / an adapter's confirmation path. Idempotent per (url, profile). */
const trackerLog: TrackerHandlers['TRACKER_LOG'] = async (payload) => {
  const result = await tracker.logApplication(payload.entry);
  void markDirty('applications');
  return okReply({ row: result.row, created: result.created });
};

/**
 * The dashboard read: filtered + paginated rows, the total BEFORE pagination, and the SEC 6.7 stats
 * strip. The stats are computed over the profile-scoped set rather than the filtered one on
 * purpose — a strip reading "applied this week: 0" merely because the user clicked the "Interview"
 * filter would be actively misleading.
 */
const trackerQuery: TrackerHandlers['TRACKER_QUERY'] = async (payload) => {
  const result = await tracker.query(payload);
  return okReply({ rows: result.rows, total: result.total, stats: result.stats });
};

/**
 * Row edits and kanban drags. A `status` change inside the patch is routed through the same
 * transition path as a lane drag, so `history[]` can never be bypassed by an editor screen.
 */
const trackerUpdate: TrackerHandlers['TRACKER_UPDATE'] = async (payload) => {
  const row = await tracker.update(payload.id, payload.patch);
  if (row === null) {
    return errReply('NOT_FOUND', 'That application row no longer exists.');
  }
  void markDirty('applications');
  return okReply({ row });
};

export const trackerHandlers: TrackerHandlers = {
  FILL_REPORT: fillReport,
  TRACKER_LOG: trackerLog,
  TRACKER_QUERY: trackerQuery,
  TRACKER_UPDATE: trackerUpdate,
};
