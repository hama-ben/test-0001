---
name: React Query duplicate instance in pnpm workspace
description: When a workspace lib lists @tanstack/react-query as a "dependency" (not peerDep), pnpm installs a local copy and Vite may resolve to two different instances, causing "No QueryClient set" at runtime.
---

## Rule
Any workspace lib that uses `@tanstack/react-query` hooks must list it as a `peerDependency`, not a `dependency`. The consuming app (artifacts/talabati) must add it to `resolve.dedupe` in `vite.config.ts`.

**Why:** pnpm installs a LOCAL copy of `dependency` packages under `lib/<pkg>/node_modules/`. When Vite resolves `@tanstack/react-query` from within that lib's source, it picks up the local copy — a DIFFERENT module instance with a DIFFERENT `QueryClientContext` than what the root app's `QueryClientProvider` uses. Result: `useQueryClient()` inside `useMutation` (and any other RQ hook) throws `"No QueryClient set, use QueryClientProvider to set one"` even though a provider IS present in the tree. The crash is caught by the ErrorBoundary and shows the "حدث خطأ غير متوقع" screen.

**How to apply:** For every workspace lib package that uses React hooks from a shared package (react-query, react, zustand, etc.):
1. Move the package from `dependencies` to `peerDependencies` in the lib's `package.json`.
2. Add the package to `resolve.dedupe` in `artifacts/talabati/vite.config.ts`.
3. Run `pnpm install` to remove the lib's local `node_modules/<package>` copy.
4. Restart Vite — it will log "Re-optimizing dependencies because lockfile has changed".

**Affected fix:** `lib/api-client-react/package.json` changed `@tanstack/react-query` from `dependency` → `peerDependency: >=5`. `vite.config.ts` dedupe extended to include `"@tanstack/react-query"`.
