# Mizu طلباتي — Water Delivery App

A mobile-first water delivery platform ("Mizu") for Algeria.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/talabati run dev` — run the frontend (port 19283)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Stack

- pnpm workspaces, Node.js 20, TypeScript 5.9
- Frontend: React + Vite (port 19283), Radix UI, Tailwind CSS, shadcn/ui
- API: Express 5 (port 8080), esbuild CJS bundle
- DB: PostgreSQL (Supabase) + Drizzle ORM
- Auth: Supabase Auth (OTP via email, JWT session tokens)
- Real-time: Socket.io + Supabase Realtime (dual-layer)
- Push notifications: Web Push + VAPID
- Email: nodemailer (SMTP)

## Where things live

- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/` — server-side utilities (mailer, supabase, socket, storage)
- `artifacts/talabati/src/pages/` — page components (dashboard, driver-dashboard, admin, etc.)
- `artifacts/talabati/src/hooks/` — React hooks (auth, realtime, socket, etc.)
- `lib/db/src/schema/` — Drizzle ORM schema (source of truth for DB shape)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contract)
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit manually)
- `lib/api-zod/src/generated/` — generated Zod schemas (do not edit manually)

## Architecture decisions

- **API base URL**: In dev on Replit, `VITE_API_BASE_URL` is not set, so `main.tsx` falls back to `https://mizu-nyv1.onrender.com` (production Render backend). The Vite proxy (`/api → localhost:8080`) is bypassed. Set `VITE_API_BASE_URL` to empty/unset is not enough — `main.tsx` must be patched or the env var must be set to a relative value to use the local server.
- **Auth**: JWT stored in localStorage (`sessionToken`). Every `customFetch` call attaches it as `Authorization: Bearer`.
- **Real-time**: Two layers — Socket.io (primary) + Supabase Realtime broadcast (fallback). All errors are isolated and non-fatal.
- **ErrorBoundary**: Wraps the entire `<Router>` in `App.tsx`. Logs `[ErrorBoundary] Caught error:` to console. A known bug causes this to fire on consumer dashboard → 'طلب جديد' click (root cause not yet identified through static analysis — needs live browser console capture).

## Product

- **Consumers**: Place water orders, track status in real-time, manage saved locations, rate drivers.
- **Drivers**: Receive order notifications, accept/deliver orders, manage subscription, upload documents.
- **Admin**: Approve/reject driver accounts and subscription payments, send announcements, manage support chat.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **`.migration-backup/` artifacts**: Duplicate of the main artifacts — do NOT start these workflows.
- **orders.ts syntax**: Had a stray `});` at line 291 (after the `/orders/active` handler) that broke the esbuild compile. Was removed.
- **SMTP**: If `SMTP_HOST` is not set in dev, OTPs print to server console instead of being emailed.
- **VAPID keys**: Optional — web push silently disabled if not configured.
- **Drizzle schema**: `lib/db/src/schema/index.ts` is the single source of truth. Run `pnpm --filter @workspace/db run push` after schema changes.
- **React Query duplicate instance (fixed)**: `lib/api-client-react` previously listed `@tanstack/react-query` as a `dependency` — pnpm installed a LOCAL copy there; Vite resolved the lib's `useMutation` import to that copy (different `QueryClientContext` than the root app), causing `useCreateOrder()` to throw `"No QueryClient set"` whenever `NewOrderView` was mounted. Fixed by: (1) moving it to `peerDependencies: "^5"` in `lib/api-client-react/package.json`, (2) adding `"@tanstack/react-query"` to `resolve.dedupe` in `vite.config.ts`. **Rule: any workspace lib that uses React hooks from a shared singleton package must declare it as a peerDependency, not a dependency.**
- **API base URL fallback (fixed)**: `main.tsx` used `|| PRODUCTION_API_URL` to read `VITE_API_BASE_URL`. Since `vite.config.ts` correctly defaults the injected value to `""` when no env var is present, the `||` operator treated `""` as falsy and fell through to `https://mizu-nyv1.onrender.com` — an external Render host unreachable from Replit dev. Fixed by changing to `?? ""`: an empty base makes `customFetch` use same-origin relative paths, which in dev go through the Vite proxy (`/api → localhost:8080`) and in production are handled directly by the API server on the same origin.
- **`capacitor.config.ts` `server.url`**: Still points to `https://mizu-nyv1.onrender.com`. This is intentional for mobile — it tells the Android WebView to load web content from the remote host rather than the local bundle. Do not remove without understanding the mobile build strategy.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
