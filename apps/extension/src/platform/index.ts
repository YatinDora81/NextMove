/**
 * platform/index.ts — barrel for the extension's platform layer (JF-001 Rev 3.0).
 *
 * Everything below the features: the message bus (SEC 6.6), the typed storage map (SEC 7.1), the
 * Dexie database (SEC 7.1/7.3), the WebCrypto vault (SEC 5.3 / SEC 9.2), the INV-2 gesture gate,
 * and the redacting logger (INV-5).
 *
 * Import from `@/platform` for the common surface, or from `@/platform/<module>` when you want to
 * be explicit about which layer you are touching.
 *
 * Dependency direction inside this folder (no cycles):
 *   logger  ←  crypto  ←  storage
 *   logger  ←  gesture ←  bus
 *   logger  ←  db
 */

export * from '@/platform/logger';
export * from '@/platform/crypto';
export * from '@/platform/gesture';
export * from '@/platform/storage';
export * from '@/platform/db';
export * from '@/platform/bus';
