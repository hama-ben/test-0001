# Building the Mizu Android APK

## Prerequisites (on your local machine)

| Tool | Version | Download |
|------|---------|----------|
| Node.js | 18+ | https://nodejs.org |
| pnpm | 9+ | `npm i -g pnpm` |
| Java JDK | 17+ | https://adoptium.net |
| Android Studio | Latest | https://developer.android.com/studio |

After installing Android Studio, open it once so it can install the Android SDK automatically.

---

## Step 1 — Download & set up the project

1. Download the project ZIP from Replit and unzip it.
2. Inside the project root, install all dependencies:

```bash
pnpm install
```

---

## Step 2 — Configure environment variables for Android

1. Copy the example file:

```bash
cp artifacts/talabati/.env.android.example artifacts/talabati/.env.production.local
```

2. Open `.env.production.local` and fill in the real values:
   - `SUPABASE_URL` — your Supabase project URL (`https://xxxx.supabase.co`)
   - `SUPABASE_ANON_KEY` — your Supabase anon key
   - `VITE_API_BASE_URL` — the **full URL** of your deployed Render API server  
     (e.g. `https://mizu-final.onrender.com`)

> **Important:** the Android WebView cannot use relative URLs like `/api/...`.
> `VITE_API_BASE_URL` tells the app to call the real deployed server instead.

---

## Step 3 — Build the web bundle

```bash
pnpm --filter @workspace/talabati run build
```

This creates `artifacts/talabati/dist/public/` — the web files Capacitor will embed.

---

## Step 4 — Add the Android platform (first time only)

```bash
cd artifacts/talabati
npx cap add android
```

This generates the `android/` folder. You only run this once.

---

## Step 5 — Sync web assets into Android

Every time you rebuild the web bundle, run:

```bash
cd artifacts/talabati
npx cap sync android
```

---

## Step 6 — Open in Android Studio

```bash
cd artifacts/talabati
npx cap open android
```

Android Studio will open. Let it finish Gradle sync (may take a few minutes the first time).

---

## Step 7 — Build the APK

### Debug APK (for testing, no signing needed)

In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**

The APK will be at:
```
artifacts/talabati/android/app/build/outputs/apk/debug/app-debug.apk
```

### Release APK (for publishing)

1. **Build → Generate Signed Bundle / APK → APK**
2. Create or use an existing keystore
3. Choose **release** build variant
4. The signed APK will be at:
   ```
   artifacts/talabati/android/app/build/outputs/apk/release/app-release.apk
   ```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `JAVA_HOME is not set` | Set it to your JDK path, e.g. `export JAVA_HOME=/usr/lib/jvm/java-17-openjdk` |
| Gradle sync fails | In Android Studio: **File → Invalidate Caches → Restart** |
| API calls fail on device | Make sure `VITE_API_BASE_URL` points to the deployed server (not localhost) |
| White screen on launch | Check that `webDir` in `capacitor.config.ts` matches the Vite `outDir` (`dist/public`) |
| OTP emails not arriving | Check Supabase Dashboard → Authentication → Logs |
