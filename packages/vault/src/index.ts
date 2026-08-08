/**
 * @repo/vault — the end-to-end profile-vault codec shared by `apps/web` and `apps/extension`.
 *
 * One implementation, two runtimes. See `codec.ts` for the wire format and for why a raw 256-bit
 * key (format 2) replaced the passphrase (format 1) as the default.
 */

// Extensionless specifiers, deliberately. `apps/web` imports this package through Next's webpack
// build, which does not implement the NodeNext `.js`-means-`.ts` rewrite that tsc does — with
// extensions here, `next build` fails to resolve every one of these three lines while
// `check-types` passes, which is the worst possible combination.
export * from './codec';
export * from './errors';
export * from './profile';
