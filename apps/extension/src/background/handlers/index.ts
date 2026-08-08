/**
 * background/handlers/index.ts — the registration barrel (JF-001 Rev 3.0 SEC 6.6).
 *
 * Assembles the ONE exhaustive handler table the router dispatches from. `MessageHandlers` is
 * `{ [T in MessageType]: MessageHandler<T> }`, so adding a message type to `shared/messages.ts`
 * without implementing it here is a compile error, not a runtime `UNKNOWN_TYPE` in production.
 *
 * Two transport-level handlers live here rather than in a domain module, because they belong to the
 * bus itself rather than to any feature:
 *
 *   FILL_REQUEST   the SEC 6.6 table routes this popup → content. The popup, the Alt+J command and
 *                  the context menu all reach the worker first, so the worker relays it to the tab.
 *   GESTURE_MINT   INV-2's permission slip. Minting is refused for untrusted origins by
 *                  `platform/bus.ts` before this handler is ever reached.
 */

import { mintGesture } from '@/platform/gesture';
import { createLogger } from '@/platform/logger';
import { sendToTab } from '@/platform/bus';
import { errReply, okReply } from '@/shared/messages';
import type { MessageHandlers } from '@/shared/messages';

import { aiHandlers, installAiGestureBridge } from '@/background/handlers/ai';
import { answerHandlers } from '@/background/handlers/answers';
import { configHandlers } from '@/background/handlers/config';
import { keyHandlers } from '@/background/handlers/keys';
import { profileHandlers } from '@/background/handlers/profile';
import { resumeHandlers } from '@/background/handlers/resume';
import { syncHandlers } from '@/background/handlers/sync';
import { trackerHandlers } from '@/background/handlers/tracker';

const log = createLogger('bg:handlers');

/**
 * The top frame of a tab. SEC 4.4: *"each frame runs its own scanner; results merge in top frame"* —
 * so a fill run is addressed to frame 0, which coordinates the sub-frames itself. Broadcasting to
 * every frame would race N independent runs against each other on an iframe-heavy ATS.
 */
const TOP_FRAME_ID = 0;

/** The tab a relayed `FILL_REQUEST` should land in. */
async function resolveTargetTab(preferred: number | null): Promise<number | null> {
  if (preferred !== null) return preferred;
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const first = tabs[0];
    return first?.id ?? null;
  } catch (error) {
    log.warn('could not resolve the active tab', error);
    return null;
  }
}

/**
 * Relay a fill request into the page.
 *
 * `runtime.sendMessage` reaches the service worker and other extension pages but NEVER a content
 * script, so the popup/command/menu paths cannot address a tab directly without knowing its id.
 * They send `FILL_REQUEST` to the worker and the worker forwards it with `tabs.sendMessage`. There
 * is no loop risk: `tabs.sendMessage` is delivered only to content scripts, which is where the real
 * `FILL_REQUEST` handler lives.
 *
 * INV-1 is not this file's to break or keep — the relay carries no submit authority whatsoever, and
 * the fill engine on the other side is the thing that refuses to touch submit controls.
 */
const fillRequest: MessageHandlers['FILL_REQUEST'] = async (payload, ctx) => {
  const tabId = await resolveTargetTab(ctx.tabId);
  if (tabId === null) {
    return errReply('NOT_FOUND', 'There is no active tab to fill.');
  }

  const reply = await sendToTab(tabId, 'FILL_REQUEST', payload, { frameId: TOP_FRAME_ID });
  if (!reply.ok) {
    log.debug(`FILL_REQUEST relay to tab ${String(tabId)} failed: ${reply.error.code}`);
  }
  return reply;
};

/**
 * INV-2 — mint a single-use, 5-second gesture nonce.
 *
 * Called by trusted extension UI (popup, options, the shadow-DOM overlay) from INSIDE a real user
 * gesture handler. `platform/bus.ts` refuses this message from any origin it cannot positively
 * identify as ours, and `platform/gesture.ts` keeps the token in worker memory only, so it cannot
 * survive a worker restart and cannot be replayed off disk.
 */
const gestureMint: MessageHandlers['GESTURE_MINT'] = (payload) => {
  const reason = payload.reason.trim();
  if (reason.length === 0) {
    return errReply('BAD_REQUEST', 'A gesture must say what it is for.');
  }
  const grant = mintGesture(reason);
  return okReply({ gesture: grant.gesture, expiresAt: grant.expiresAt });
};

/**
 * Build the complete table. Exhaustive by construction: the return type forces every member of
 * `MessageType` to be present.
 */
export function buildHandlerTable(): MessageHandlers {
  return {
    FILL_REQUEST: fillRequest,
    GESTURE_MINT: gestureMint,

    ...trackerHandlers,
    ...profileHandlers,
    ...resumeHandlers,
    ...aiHandlers,
    ...keyHandlers,
    ...answerHandlers,
    ...configHandlers,
    ...syncHandlers,
  };
}

/**
 * Wire up everything the handlers need before the first message can arrive.
 *
 * Today that is the INV-2 bridge between the router's gesture gate and the AI layer's own gate.
 * Idempotent, because an MV3 worker re-runs its bootstrap every time Chrome resurrects it.
 */
export function prepareHandlers(): void {
  installAiGestureBridge();
}

export {
  aiHandlers,
  answerHandlers,
  configHandlers,
  keyHandlers,
  profileHandlers,
  resumeHandlers,
  syncHandlers,
  trackerHandlers,
};
