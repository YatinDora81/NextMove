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

const fillReport: TrackerHandlers['FILL_REPORT'] = async (payload) => {
  const settings = await getSettings();
  if (!settings.autoLogApplications) {
    log.debug('autoLogApplications is off — the fill was not logged');
    return okReply({ logged: false, applicationId: null });
  }

  const profileId = payload.profileId ?? settings.activeProfileId ?? '';

  const result = await tracker.logFill(payload.report, payload.job, profileId);
  log.info(
    `${result.created ? 'opened' : 'updated'} tracker row ${result.row.id} ` +
      `(${String(payload.report.filled)}/${String(payload.report.perField.length)} filled)`,
  );
  void markDirty('applications');
  return okReply({ logged: true, applicationId: result.row.id });
};

const trackerLog: TrackerHandlers['TRACKER_LOG'] = async (payload) => {
  const result = await tracker.logApplication(payload.entry);
  void markDirty('applications');
  return okReply({ row: result.row, created: result.created });
};

const trackerQuery: TrackerHandlers['TRACKER_QUERY'] = async (payload) => {
  const result = await tracker.query(payload);
  return okReply({ rows: result.rows, total: result.total, stats: result.stats });
};

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
