/**
 * entrypoints/background.ts — the MV3 service worker (JF-001 Rev 3.0 SEC 4.1 / 4.2 / 10).
 *
 * SEC 4.2 defines this component in two lines:
 *
 *   OWNS         all network I/O (Gemini, the config CDN, Phase-2 API), the key pool, routing, alarms.
 *   MUST NEVER   touch page DOM; assume it stays alive (it is event-driven and dies).
 *
 * Both are honoured structurally. Nothing under `src/background/**` imports `src/content/**` or any
 * DOM-driving module, and nothing holds state in module scope that matters: every handler reads
 * what it needs back from `chrome.storage` / IndexedDB, because Chrome recycles this worker
 * whenever it feels like it and a variable that survived the last event is a lie.
 *
 * This file is deliberately thin. It does exactly four things, all of them synchronous listener
 * registration plus one async bootstrap:
 *
 *   1. installs the MessageRouter          → `src/background/router.ts`
 *   2. registers the two alarms            → `src/background/alarms.ts`  (SEC 5.4, F-14)
 *   3. registers the Alt+J command          → SEC 10 `commands["fill-page"]`
 *   4. registers the context menu           → SEC 10 `contextMenus`
 *
 * ── Why every listener is registered at the top level, synchronously ────────────────────────────
 * MV3 wakes the worker by starting the script and then delivering the event that woke it. A
 * listener added after an `await` can miss that event entirely — the classic MV3 bug where the
 * first Alt+J after a period of idleness does nothing. So: listeners first, `await` later.
 *
 * INV-1: nothing here — or anywhere downstream of it — clicks a submit or "next step" control. The
 * command and the menu item both resolve to a `FILL_REQUEST`, which locates and highlights.
 * INV-2: no code path in this file starts a Gemini request. The alarms cannot; they exist to poll
 * static JSON and to roll a local ledger.
 */

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

/**
 * Warm the worker back up. Everything here is idempotent and re-runs on every resurrection, because
 * the worker keeps nothing between events.
 *
 *   runMigrations       brings stored data up to `SCHEMA_VERSION` (SEC 7.1); forward-only and a
 *                       no-op once current, so it is cheap to call on every wake.
 *   primeRuntimeConfig  re-applies the cached model budgets and the user's fallback chain into the
 *                       rotation store, whose overrides live in module scope and die with the worker.
 *   registerAlarms      re-arms anything missing (fresh install, update, alarms cleared).
 *   refreshKeyBadge     re-derives the SEC 5.6 dead-key badge from `jf.keys`.
 */
async function bootstrap(): Promise<void> {
  try {
    await runMigrations();
    await primeRuntimeConfig();
    await registerAlarms();
    await refreshKeyBadge();
    log.info('service worker ready');
  } catch (error) {
    // A failed bootstrap must not take the router down with it — a user with a corrupt settings
    // blob still needs their profile vault and their tracker (INV-3).
    log.error('bootstrap failed; the router is still serving', error);
  }
}

/** SEC 10 `contextMenus`. Created in `onInstalled`, which is where Chrome persists them from. */
async function createContextMenus(): Promise<void> {
  try {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: MENU_FILL_PAGE,
      title: 'Fill this application',
      // `editable` as well as `page`: right-clicking inside a form field is the most natural place
      // to reach for this, and it is where users land after spotting a field JobFill missed.
      contexts: ['page', 'editable'],
    });
    log.debug('context menu created');
  } catch (error) {
    log.warn('could not create the context menu', error);
  }
}

/**
 * Send a brand-new install to the web onboarding, once.
 *
 * The trigger is deliberately **not** `details.reason === 'install'`. Chrome reports `install` for
 * a reinstall and for a profile that syncs the extension onto a second machine, and MetaMask learnt
 * the hard way that trusting it means greeting returning users with a setup wizard over data they
 * already have. What actually answers "is this person new here" is whether any local state exists,
 * so that is what gets asked: no profiles and no pairing ⇒ genuinely new.
 *
 * Failing to open the tab is not fatal to anything. The extension is fully usable offline and
 * unpaired (INV-3); onboarding is an invitation, not a gate, and the Options page still has a
 * Connect button if this never runs.
 */
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

/**
 * Start a fill run in a tab. Shared by Alt+J and the context menu; `dispatchLocal` routes it through
 * the same guarded handler table as a message from the popup, and the `FILL_REQUEST` handler relays
 * it into the page's top frame.
 *
 * `profileId: null` means "use the active profile" (SEC 6.6).
 */
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
  // 1. Routing. First, and synchronously — everything else in the extension talks through it.
  installRouter();

  // 2. Alarms: the 24 h remote-config poll (F-14) and the Pacific-midnight RPD reset (SEC 5.4).
  installAlarmListener();

  // 3. SEC 10 — `commands["fill-page"]`, suggested key Alt+J.
  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== COMMAND_FILL_PAGE) return;
    void triggerFill('shortcut', tab?.id ?? null, tab?.url ?? null);
  });

  // 4. SEC 10 — the context menu.
  //
  // Only "Fill this application" ships in v1. A second item for "generate an answer here" is
  // deliberately absent: the SEC 6.6 protocol has no service-worker → content message that could
  // open the answer composer on a specific field, and inventing one would change a fixed
  // cross-context contract. The ✨ affordance the content script renders next to each long-text
  // question is that entry point, and it is already a real user gesture (INV-2).
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_FILL_PAGE) return;
    void triggerFill('context-menu', tab?.id ?? null, info.pageUrl ?? tab?.url ?? null);
  });

  // 5. SEC 8.2 — the web handshake. Registered synchronously and before any `await`, because a
  //    listener added later misses the very message that woke the worker: the classic MV3 bug where
  //    the first Connect click after an idle period silently does nothing.
  browser.runtime.onMessageExternal.addListener(handleExternalMessage);

  browser.runtime.onInstalled.addListener((details) => {
    log.info(`onInstalled (${details.reason})`);
    void createContextMenus();
    void bootstrap();
    void maybeOpenOnboarding(details.reason);

    // Where an uninstall lands. `http(s)` only, and it carries nothing identifying — the point is
    // to offer a way back and a place to say why, not to track anyone.
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

  // Every other resurrection: Chrome starts the worker to deliver an event, and neither
  // `onInstalled` nor `onStartup` fires. The bootstrap has to run here too, and it is written to be
  // safe to run any number of times.
  void bootstrap();
});
