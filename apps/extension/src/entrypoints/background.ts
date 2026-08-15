import { createLogger } from '@/platform/logger';
import { runMigrations, subscribeSlot, toggleEnabled } from '@/platform/storage';
import { COMMAND_FILL_PAGE, COMMAND_TOGGLE_ENABLED, MENU_FILL_PAGE } from '@/shared/constants';


import { installAlarmListener, registerAlarms } from '@/background/alarms';
import { refreshKeyBadge } from '@/background/badge';
import { primeRuntimeConfig } from '@/background/config-sync';
import { handleExternalMessage } from '@/background/handoff';
import { dispatchLocal, installRouter } from '@/background/router';
import { getSlot } from '@/platform/storage';
import { ONBOARDED_KEY, ONBOARDING_PAGE, WEB_UNINSTALL_URL } from '@/shared/constants';


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

async function alreadyOnboarded(): Promise<boolean> {
  const bag = await browser.storage.local.get(ONBOARDED_KEY);
  return (bag as Record<string, unknown>)[ONBOARDED_KEY] === true;
}

async function markOnboarded(): Promise<void> {
  await browser.storage.local.set({ [ONBOARDED_KEY]: true });
}

async function maybeOpenOnboarding(reason: string): Promise<void> {
  if (reason !== 'install') return;
  try {
    if (await alreadyOnboarded()) {
      log.info('nm:onboarded is set — skipping onboarding');
      return;
    }
    const [profiles, sync] = await Promise.all([getSlot('profiles'), getSlot('sync')]);
    if (profiles.length > 0 || sync.paired) {
      await markOnboarded();
      log.info('install with existing data — skipping onboarding');
      return;
    }
    await browser.tabs.create({ url: browser.runtime.getURL(ONBOARDING_PAGE) });
    log.info('opened the first-run fork for a fresh install');
  } catch (error) {
    log.warn('could not open the onboarding tab; the extension works without it', error);
  }
}

/**
 * Alt+Shift+N. The flip itself belongs to `platform/storage`, which every other surface writes
 * through too, so this is only the shortcut's half: ask for the flip and say what happened.
 *
 * Nothing else has to be told. The in-page layer in every tab, the popup, the options page and the
 * badge below all watch the settings slot through `storage.onChanged`, so one write is the whole
 * fan-out — including the badge, which used to be repainted here and only here, and therefore went
 * stale the moment the user flipped the switch from the popup instead.
 */
async function flipPowerSwitch(): Promise<boolean> {
  const next = await toggleEnabled();
  log.info(`power switch → ${next.enabled ? 'on' : 'off'}`);
  return next.enabled;
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

  // The badge is a surface like any other: it reads `enabled` and it must not lag behind whichever
  // surface flipped it. One subscription here replaces the repaint each writer used to remember.
  subscribeSlot('settings', () => {
    void refreshKeyBadge();
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command === COMMAND_TOGGLE_ENABLED) {
      void flipPowerSwitch();
      return;
    }
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
