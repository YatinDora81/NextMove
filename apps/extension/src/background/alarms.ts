import { pacificMidnightAfter } from '@repo/rotation';
import type { Browser } from 'wxt/browser';

import { resetDailyLedgers } from '@/ai/rotation-store';
import { createLogger } from '@/platform/logger';
import {
  ALARM_CONFIG_POLL,
  ALARM_QUOTA_RESET,
  ALARM_SYNC_PUSH,
  CONFIG_POLL_PERIOD_MINUTES,
} from '@/shared/constants';

import { refreshKeyBadge } from '@/background/badge';
import { runConfigPoll } from '@/background/config-sync';
import { armSyncAlarm, drainSync } from '@/background/sync-scheduler';

const log = createLogger('bg:alarms');

const QUOTA_ALARM_TOLERANCE_MS = 60_000;

const QUOTA_ALARM_MAX_HORIZON_MS = 25 * 60 * 60 * 1_000;

async function getAlarm(name: string): Promise<Browser.alarms.Alarm | undefined> {
  try {
    return await browser.alarms.get(name);
  } catch (error) {
    log.debug(`could not read alarm ${name}`, error);
    return undefined;
  }
}

async function armConfigAlarm(): Promise<boolean> {
  if ((await getAlarm(ALARM_CONFIG_POLL)) !== undefined) return false;
  await browser.alarms.create(ALARM_CONFIG_POLL, {
    delayInMinutes: 1,
    periodInMinutes: CONFIG_POLL_PERIOD_MINUTES,
  });
  log.info(`armed ${ALARM_CONFIG_POLL} (every ${String(CONFIG_POLL_PERIOD_MINUTES)} minutes)`);
  return true;
}

export async function armQuotaAlarm(now: number = Date.now()): Promise<number> {
  const target = pacificMidnightAfter(now);
  const existing = await getAlarm(ALARM_QUOTA_RESET);

  if (existing !== undefined) {
    const delta = Math.abs(existing.scheduledTime - target);
    const horizon = existing.scheduledTime - now;
    if (delta <= QUOTA_ALARM_TOLERANCE_MS && horizon > 0 && horizon <= QUOTA_ALARM_MAX_HORIZON_MS) {
      return existing.scheduledTime;
    }
    await browser.alarms.clear(ALARM_QUOTA_RESET);
  }

  await browser.alarms.create(ALARM_QUOTA_RESET, { when: target });
  log.info(`armed ${ALARM_QUOTA_RESET} for ${new Date(target).toISOString()} (00:00 America/Los_Angeles)`);
  return target;
}

export async function registerAlarms(now: number = Date.now()): Promise<void> {
  try {
    await armConfigAlarm();
    await armQuotaAlarm(now);
    await armSyncAlarm();
  } catch (error) {
    log.warn('could not register alarms', error);
  }
}

export async function clearAlarms(): Promise<void> {
  try {
    await browser.alarms.clear(ALARM_CONFIG_POLL);
    await browser.alarms.clear(ALARM_QUOTA_RESET);
    await browser.alarms.clear(ALARM_SYNC_PUSH);
  } catch (error) {
    log.debug('could not clear alarms', error);
  }
}

export async function runQuotaReset(now: number = Date.now()): Promise<void> {
  await resetDailyLedgers(now);
  await refreshKeyBadge();
  await armQuotaAlarm(now + 1);
  log.info('daily RPD ledgers reset at Pacific midnight');
}

export async function handleAlarm(alarm: { name: string }, now: number = Date.now()): Promise<void> {
  try {
    switch (alarm.name) {
      case ALARM_CONFIG_POLL:
        await runConfigPoll(now);
        return;
      case ALARM_QUOTA_RESET:
        await runQuotaReset(now);
        return;
      case ALARM_SYNC_PUSH:
        await drainSync();
        return;
      default:
        log.debug(`ignoring an unknown alarm: ${alarm.name}`);
        return;
    }
  } catch (error) {
    log.warn(`alarm ${alarm.name} failed`, error);
  }
}

let listenerInstalled = false;

export function installAlarmListener(): void {
  if (listenerInstalled) return;
  browser.alarms.onAlarm.addListener((alarm) => {
    void handleAlarm(alarm);
  });
  listenerInstalled = true;
}
