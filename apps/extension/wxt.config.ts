import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

/**
 * WXT configuration — JF-001 Rev 3.0 SEC 10 (Manifest V3) and SEC 14.2 (workspace wiring).
 *
 * The generated manifest must match SEC 10 exactly. Notes on what is *not* here:
 *
 *  - `content_scripts` are NOT declared as a raw manifest key. WXT generates them from the
 *    entrypoints, which is the only way HMR and per-script `world` handling work:
 *      src/entrypoints/content.ts      → matches <all_urls>, all_frames, document_idle, ISOLATED
 *      src/entrypoints/main-world.ts   → same matches, but `world: 'MAIN'` — it exists solely for
 *                                        native-setter fills (SEC 6.4) and exposes nothing else.
 *  - `web_accessible_resources`: none. Nothing in this extension is reachable from a page. The
 *    web handshake runs over `externally_connectable` + `onMessageExternal`, which needs no
 *    web-accessible resource and exposes no file — the page can send a message and read the reply,
 *    and that is the entire surface.
 *  - `background`: generated from src/entrypoints/background.ts as a `type: module` service worker.
 *  - `version` is taken from package.json (1.0.0) — release isolation per SEC 14.1 R-4.
 *  - No `activeTab`: content scripts are declarative, so it buys nothing and costs store review.
 *  - No env secrets. BYOK means there is nothing to leak; CONFIG_URL / API_BASE_URL are plain
 *    build-time constants in src/shared/constants.ts (SEC 14.2).
 */
export default defineConfig({
  srcDir: 'src',
  /**
   * Build output. WXT defaults to `.output`; a dotted directory is easy to miss in a file browser
   * and easy to forget when pointing Chrome's "Load unpacked" at it, so this project uses `build`.
   *
   * The per-target subdirectory is WXT's and stays: the loadable extension is `build/chrome-mv3`,
   * which is also exactly what `wxt zip` packs. Keeping that level means a future
   * `wxt build -b firefox` lands in `build/firefox-mv2` instead of overwriting the Chrome build.
   */
  outDir: 'build',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'NextMove Autofill',
    description:
      'Fill any job application in one click. Your data stays on your device. AI answers with your own free Gemini keys.',
    minimum_chrome_version: '116',
    /**
     * Pins the extension ID. Chrome derives the ID from this public key, so an unpacked dev load,
     * a CI build and the published store item all resolve to the same
     * `ddfhfgdabjplhoddibcngfiblpdoakbe` — which matters because `apps/web` has to hardcode that ID
     * to call `chrome.runtime.sendMessage` for the connect handshake, and a per-machine random ID
     * would make the handshake untestable locally.
     *
     * This is a *public* key. It is not a secret and there is nothing to leak by committing it.
     * (Chrome Web Store re-signs on upload; keeping `key` here is what stops the ID from changing.)
     */
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvlk+TGntT5uCn0LTk1Q8IXYIlmnIUm3ODTJcv/hwD6N2BpJ/g+Qjo1Pw6enBTdyEVc41SqpF74yh0a5egrYcuqA4K9Sb3BFmbECDUcwPyevxhQ6r0JwEryERbNxRrmOrVtdTFEmqx+KT0EKUfBjFQhBwdxRjF8LajZ4nPM8pF6bVwlRXovo0zxQDwGpTAvGy4ge4aiTnB0mOBYG4rg/yyz8dY2rhg7zoiwD43Y/zTUov2B0r/nis5aQtKqA0MpNt6WRs6tsgatCubzOvbCeYENca+ptTIr5+wFspOZoI9Zdm+04cyacpKiqVqDlUW9zZzClliiSOWcnpJusHEXZYMwIDAQAB',
    permissions: ['storage', 'scripting', 'alarms', 'contextMenus'],
    /**
     * SEC 8.2 — the only way `nextmoveapp` can hand this extension a pairing code and an E2E vault
     * key without the user retyping an 8-character string.
     *
     * This key is the actual security boundary for the handshake: a page whose origin is not
     * listed here cannot open a port to the service worker at all, and Chrome enforces that before
     * any of our code runs. `background/handoff.ts` re-checks `sender.origin` against the same list
     * and requires the top frame, but those are belt to this manifest's braces.
     *
     * Match-pattern rules worth knowing before editing: a wildcard is allowed only as a leading
     * `*.` subdomain label and never over an effective TLD, so `*://*.vercel.app/*` would be
     * rejected outright. `http://localhost/*` matches every port, and it is here so `pnpm dev`
     * works — strip it from the store build.
     */
    externally_connectable: {
      matches: [
        'https://nextmove-yatin.vercel.app/*',
        'http://localhost/*',
        'http://127.0.0.1/*',
      ],
    },
    host_permissions: [
      // Lane 1 only: the service worker talks to Google directly with the user's own key (INV-6).
      'https://generativelanguage.googleapis.com/*',
      // Covers the CDN-hosted adapters.json (F-14). Vercel static files send no CORS headers,
      // so the service-worker fetch needs the grant. Swap in the custom domain at launch.
      'https://nextmove-yatin.vercel.app/*',
    ],
    action: {
      default_popup: 'popup.html',
      default_title: 'NextMove Autofill (Alt+J)',
    },
    options_page: 'options.html',
    commands: {
      'fill-page': {
        suggested_key: { default: 'Alt+J' },
        description: 'Fill this application',
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    icons: {
      16: 'icons/16.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },
  },
});
