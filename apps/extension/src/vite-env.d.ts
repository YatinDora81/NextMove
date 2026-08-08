/**
 * Ambient types for Vite's asset-query imports.
 *
 * WXT's generated `.wxt/wxt.d.ts` covers the extension APIs but not `?inline`, which
 * `content/overlay/mount.ts` uses to pull `ui/tokens.css` into a closed shadow root as text.
 */

declare module '*.css?inline' {
  const css: string;
  export default css;
}
