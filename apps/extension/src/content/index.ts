/**
 * content/index.ts — barrel for the in-page layer (JF-001 Rev 3.0 SEC 4.1 "OverlayUI").
 *
 *   ./overlay/mount          the closed-Shadow-DOM host every other piece renders into (SEC 4.4)
 *   ./overlay/FieldMarkers   the F-06 outlines drawn over the page without touching its layout
 *   ./overlay/FieldControls  the per-field ✓ / ✗ / 💾 cluster and the ghost-text eligibility rules
 *   ./overlay/ReviewPanel    F-06 review-before-submit, F-13 map-this-field, SEC 4.4 frame honesty
 *   ./overlay/PanelShell     the collapsed bubble, the panel header and the on/off power switch
 *   ./overlay/SparkleButton  F-09 ✨ answers, gated by the F-17 Answer Bank (SEC 5.7)
 *   ./overlay/Toast          the SEC 5.6 failure copy with a live cooldown countdown
 *   ./dismissals             per-domain, per-field "✗ don't suggest this", pruned at 30 days
 *   ./pill                   F-03 floating "Fill this application" pill — SUPERSEDED by the bubble
 *                            in ./overlay/PanelShell, which occupies the same corner and the same
 *                            overlay layer. Kept, unmounted, because its per-domain dismissal and
 *                            drag-position helpers at `jf.pill` are still the record of what the
 *                            user did there; nothing in the content script constructs it any more.
 *   ./ui-state               whether the user last left the panel collapsed into its bubble
 *
 * `entrypoints/content.ts` is the orchestrator that wires these to `core/`, `tracker/` and the bus.
 * Nothing in this folder holds an API key, reaches Gemini, or clicks a control (INV-1 / INV-5).
 *
 * `./dismissals` and `./ui-state` are the only members that touch disk, and they do it at their
 * own `jf.*` keys outside the six-slot map — device-local chrome, never synced (see
 * `STORAGE_KEY_UI` / `STORAGE_KEY_FIELD_DISMISSALS` in `shared/constants.ts`).
 */

export * from './overlay/mount';
export * from './overlay/FieldMarkers';
export * from './overlay/FieldControls';
export * from './overlay/Toast';
export * from './overlay/ReviewPanel';
export * from './overlay/PanelShell';
export * from './overlay/SparkleButton';
export * from './overlay/Suggest';
export * from './dismissals';
export * from './pill';
export * from './ui-state';
