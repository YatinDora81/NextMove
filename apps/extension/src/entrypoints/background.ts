import { createLogger } from '@/platform/logger';
import { runMigrations } from '@/platform/storage';
import { COMMAND_FILL_PAGE, MENU_FILL_PAGE } from '@/shared/constants';

import { installAlarmListener, registerAlarms } from '@/background/alarms';
import { refreshKeyBadge } from '@/background/badge';
import { primeRuntimeConfig } from '@/background/config-sync';
import { connectUrl, handleExternalMessage } from '@/background/handoff';
import { dispatchLocal, installRouter } from '@/background/router';
import { getSlot } from '@/platform/storage';
import { WEB_UNINSTALL_URL } from '@/shared/constants';

const log = createLogger('bg');

async function bootstrap(): Promise<void> {
  try {
    await runMigrations();
    await primeRuntimeConfig();
    await registerAlarms();
    await refreshKeyBadge();
    log.info('service worker ready');
  } catch (error) {
    log.error('bootstrap failed; the router is still serving', error);
  }
}

async function createContextMenus(): Promise<void> {
  try {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: MENU_FILL_PAGE,
      title: 'Fill this application',
      contexts: ['page', 'editable'],
    });
    log.debug('context menu created');
  } catch (error) {
    log.warn('could not create the context menu', error);
  }
}

async function maybeOpenOnboarding(reason: string): Promise<void> {
  if (reason !== 'install') return;
  try {
    const [profiles, sync] = await Promise.all([getSlot('profiles'), getSlot('sync')]);
    if (profiles.length > 0 || sync.paired) {
      log.info('install with existing data — skipping onboarding');
      return;
    }
    const url = await connectUrl();
    await browser.tabs.create({ url });
    log.info('opened web onboarding for a fresh install');
  } catch (error) {
    log.warn('could not open the onboarding tab; the extension works without it', error);
  }
}

async function triggerFill(
  trigger: 'shortcut' | 'context-menu',
  tabId: number | null,
  url: string | null,
): Promise<void> {
  const reply = await dispatchLocal(
    'FILL_REQUEST',
    { profileId: null, trigger },
    { tabId, url },
  );
  if (!reply.ok) {
    log.warn(`${trigger} fill did not run: ${reply.error.code} — ${reply.error.message}`);
    return;
  }
  log.info(
    `${trigger} fill: ${String(reply.data.filled)} filled, ${String(reply.data.suggested)} suggested, ` +
      `${String(reply.data.skipped)} skipped`,
  );
}

export default defineBackground(() => {
  installRouter();

  installAlarmListener();

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== COMMAND_FILL_PAGE) return;
    void triggerFill('shortcut', tab?.id ?? null, tab?.url ?? null);
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_FILL_PAGE) return;
    void triggerFill('context-menu', tab?.id ?? null, info.pageUrl ?? tab?.url ?? null);
  });

  browser.runtime.onMessageExternal.addListener(handleExternalMessage);

  browser.runtime.onInstalled.addListener((details) => {
    log.info(`onInstalled (${details.reason})`);
    void createContextMenus();
    void bootstrap();
    void maybeOpenOnboarding(details.reason);

    try {
      browser.runtime.setUninstallURL(WEB_UNINSTALL_URL);
    } catch (error) {
      log.debug('setUninstallURL is unavailable in this browser', error);
    }
  });

  browser.runtime.onStartup.addListener(() => {
    log.info('onStartup');
    void bootstrap();
  });

  void bootstrap();
});
