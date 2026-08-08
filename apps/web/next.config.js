/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    /**
     * `next lint` defaults to `['app', 'pages', 'components', 'lib', 'src']` — and nothing else.
     * This app keeps its React Query-ish data hooks in `hooks/`, its API URL table in `utils/`
     * and several full page bodies in `ui-pages/`, none of which are on that list. All three were
     * therefore invisible to `pnpm --filter web lint`: a file could import a non-existent symbol,
     * leave a variable dangling or violate the rules-of-hooks and the gate stayed green.
     *
     * That mattered most for the JF-001 additions, which landed almost entirely in the unlinted
     * half of the tree (`hooks/useAiKeys.tsx`, `hooks/useDevices.tsx`,
     * `hooks/useJobApplications.tsx`, `utils/url.ts`).
     *
     * `middleware.ts` is named explicitly: it is a root-level file, so no directory entry reaches
     * it, and it is the file that decides which routes require auth.
     *
     * Directories are listed rather than `.` on purpose — `.` drags `.next/` build output into
     * the lint run.
     */
    dirs: ['app', 'components', 'hooks', 'lib', 'tests', 'ui-pages', 'utils', 'middleware.ts'],
  },
};

export default nextConfig;
