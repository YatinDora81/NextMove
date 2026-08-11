/**
 * content/index.ts — barrel for the in-page layer (JF-001 Rev 3.0 SEC 4.1 "OverlayUI").
 *
 *   ./overlay/mount          the closed-Shadow-DOM host every other piece renders into (SEC 4.4)
 *   ./overlay/FieldMarkers   the F-06 outlines drawn over the page without touching its layout
 *   ./overlay/ReviewPanel    F-06 review-before-submit, F-13 map-this-field, SEC 4.4 frame honesty
 *   ./overlay/SparkleButton  F-09 ✨ answers, gated by the F-17 Answer Bank (SEC 5.7)
 *   ./overlay/Toast          the SEC 5.6 failure copy with a live cooldown countdown
 *   ./pill                   F-03 floating "Fill this application" pill
 *
 * `entrypoints/content.ts` is the orchestrator that wires these to `core/`, `tracker/` and the bus.
 * Nothing in this folder holds an API key, reaches Gemini, or clicks a control (INV-1 / INV-5).
 */

export * from './overlay/mount';
export * from './overlay/FieldMarkers';
export * from './overlay/Toast';
export * from './overlay/ReviewPanel';
export * from './overlay/SparkleButton';
export * from './overlay/Suggest';
export * from './pill';
