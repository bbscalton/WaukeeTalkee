# Waukee Talkee (Slice 1)

Firebase project: **`waukee-talkee`** (CLI account `neuereatec@gmail.com`)

Firebase-backed taxi radio MVP: **pair codes**, driver **on-duty** telemetry (location + speed), and a **dispatcher live map**.

```
WaukeeTalkee/
  android/          Kotlin Compose driver app
  dispatcher/       Vite + React dispatcher console
  firebase/         Rules, indexes, Cloud Functions
  .github/workflows Deploy dispatcher → GitHub Pages
```

## Already provisioned (automated)

- Firebase project `waukee-talkee` + billing linked
- Android app `com.waukeetalkee.driver` → `android/app/google-services.json`
- Web app config → `dispatcher/.env`
- Firestore `(default)` in `nam5` + security rules deployed
- Cloud Functions deployed: `createDriver`, `createPairCode`, `createDriverWithPairCode`, `redeemPairCode`
- Org seed: `orgs/demo`

## One manual step (Auth)

Firebase Auth cannot be turned on fully from the CLI on a brand-new project. Open this link, click **Get started**, then enable **Email/Password**:

https://console.firebase.google.com/project/waukee-talkee/authentication/providers

Then tell the agent to finish seeding the dispatcher login.

## Website

Marketing site + dispatcher on GitHub Pages:

- Site: https://bbscalton.github.io/WaukeeTalkee/
- Dispatcher: https://bbscalton.github.io/WaukeeTalkee/app/

Local preview:

```bash
# static site
cd website && npx --yes serve .

# dispatcher (separate)
cd dispatcher && npm run dev
```

## Google Maps (dispatcher)

Live map (`#/map`) and Map DVR (`#/replay`) use the Google Maps JavaScript API (hybrid/satellite default + Street View).

**Required Google Cloud setup** (project `waukee-talkee`):

1. Enable **Maps JavaScript API** (`maps-backend.googleapis.com`). Billing must be on (already linked for Firebase).
2. On the **Browser key** (Firebase auto-created), allow API target `maps-backend.googleapis.com` in addition to Firebase APIs.
3. HTTP referrers on that key: `https://bbscalton.github.io/*`, `http://localhost:*`, `http://127.0.0.1:*`.
4. Local: set `VITE_GOOGLE_MAPS_API_KEY` in `dispatcher/.env` to the Browser key. Pages deploy injects the same name from GitHub Actions secrets (`VITE_GOOGLE_MAPS_API_KEY`).

If the map shows a red “Map unavailable” overlay, check the browser console for `RefererNotAllowedMapError` / `ApiNotActivatedMapError` / billing errors.


## Later slices

Booking cascade, walkie audio, speed alerts, safety kiosk lock.
