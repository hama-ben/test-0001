---
name: Account freeze enforcement
description: How suspended/banned accounts are blocked on the backend and shown blocking overlays on the frontend.
---

# Account Freeze Enforcement

## Backend: blockFrozenAccounts middleware
- File: `artifacts/api-server/src/middlewares/block-frozen-accounts.ts`
- Runs after `requireAuth` in `routes/index.ts`
- Uses a 10 s TTL in-memory Map for account status (same pattern as session-store.ts)
- Returns 403 with `code: "ACCOUNT_SUSPENDED"` or `code: "ACCOUNT_BANNED"`
- Fails **open** on DB error (intentional availability tradeoff — reviewable)
- Allowlisted paths: `/account/:userId/status`, `/appeal`, `/support/thread`, `/support/thread/send`

## Backend: Admin suspend/ban endpoints
- `PATCH /admin/users/:userId/{suspend,ban,unsuspend,unban}` in `artifacts/api-server/src/routes/admin.ts`
- After DB update: call `invalidateAccountStatusCache(userId)` + `emitToUser(userId, "account_status_changed", {...})`
- Protected by `requireAdmin` (X-Admin-Key header)

## Backend: Appeals route
- `GET /appeal`, `POST /appeal` in `artifacts/api-server/src/routes/appeals.ts`
- Replaced old `/driver/appeal` (now 307 redirect for backward compat)
- `reason` column on `driver_appeals` table stores "rejected" | "banned" at submit time
- Table name kept as `driver_appeals` / `driver_id` to avoid migration risk (stores any user id)
- Status must be `rejected` or `banned` to appeal; one pending appeal at a time

## Frontend: AccountStatusGate (App.tsx)
- Polls `GET /api/account/:userId/status` every 10 s (refetchIntervalInBackground: false)
- Listens to `account_status_changed` Socket.io event → instant freeze
- Listens to `api-error` window event (code ACCOUNT_SUSPENDED/ACCOUNT_BANNED) → invalidates query
- Renders at `z-[210]` — above page-level overlays (`z-[200]`)
- Does NOT force logout

## Frontend: Shared AppealOverlay component
- `artifacts/talabati/src/components/appeal-overlay.tsx`
- Parameterized: `title`, `idleDescription`, `icon`, `zClass`
- Used by `RejectedAccountOverlay` (driver-dashboard, z-[200]) and `BannedAccountOverlay` (App.tsx, z-[210])
- Calls `GET /api/appeal` + `POST /api/appeal`

**Why:** The separate admin panel project does NOT have these suspend/ban endpoints — it hits the Mizu API server. The admin panel project may need updating to call the new PATCH endpoints.
