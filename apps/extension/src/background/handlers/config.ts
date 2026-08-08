/**
 * background/handlers/config.ts — `CONFIG_GET` / `CONFIG_REFRESH` (F-14 / SEC 6.6 / SEC 8.3).
 *
 * `CONFIG_GET` is the content script's one call per fill run: "give me everything needed to drive
 * this ATS". The answer is the shipped seed ⊕ the CDN document, already folded together by
 * `core/adapters/registry.ts` — selectors, quirks, synonyms, capture hints and confirmation cues.
 *
 * The page URL comes from the SENDER, not from the payload. That is what makes Workday's per-tenant
 * config layers (`workday:<tenant>`, SEC 6.5) work: the content script does not have to know that
 * tenant layering exists, and a caller cannot ask for another site's overrides by lying about a URL
 * it is not actually on.
 *
 * INV-3: this handler never needs the network. With no cached CDN document — first run, offline,
 * CDN down — `resolveAdapterConfig` returns the shipped seed and the fill engine is fully
 * functional. `source: 'seed' | 'remote'` tells the caller which it got.
 *
 * MV3: the remote document is DATA. See the header of `background/config-sync.ts` for why that is
 * the whole compliance argument behind F-14.
 */

import { resolveAdapterConfig } from '@/core/adapters/registry';
import { okReply } from '@/shared/messages';
import type { MessageHandlers } from '@/shared/messages';

import { getRemoteConfig, refreshRemoteConfig } from '@/background/config-sync';

type ConfigHandlers = Pick<MessageHandlers, 'CONFIG_GET' | 'CONFIG_REFRESH'>;

/** Seed ⊕ remote, resolved for one ATS on one URL. */
const configGet: ConfigHandlers['CONFIG_GET'] = async (payload, ctx) => {
  const remote = await getRemoteConfig();
  return okReply(
    resolveAdapterConfig(payload.atsId, {
      remote,
      // `ctx.url` is the sender's own frame/tab URL, resolved by the bus from the runtime sender.
      url: ctx.url,
    }),
  );
};

/**
 * Manual "Check for updates" from Options, and the path the 24 h alarm shares.
 *
 * `force` skips the minimum-poll-interval throttle AND the `remoteConfigEnabled` setting, because
 * an explicit click is the user overriding both. A failure is never an error here: the reply says
 * `updated: false` and the previous config stays in force (INV-3).
 */
const configRefresh: ConfigHandlers['CONFIG_REFRESH'] = async (payload) => {
  const result = await refreshRemoteConfig({
    force: payload.force,
    ignoreSetting: payload.force,
  });
  return okReply(result);
};

export const configHandlers: ConfigHandlers = {
  CONFIG_GET: configGet,
  CONFIG_REFRESH: configRefresh,
};
