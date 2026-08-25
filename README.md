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

## Auth (Email/Password + Google)

Enable providers in Firebase Auth:

https://console.firebase.google.com/project/waukee-talkee/authentication/providers

Authorized domains must include `bbscalton.github.io` (and the default `*.firebaseapp.com` / `*.web.app` hosts).

### Google sign-in / Auth handler API key referrers

TCD and other web apps use Firebase Auth redirect (`signInWithRedirect`), which loads:

`https://waukee-talkee.firebaseapp.com/__/auth/handler`

That handler calls Identity Toolkit with the **Browser key** (auto-created by Firebase). If HTTP referrer restrictions on that key omit the Auth domain, Google sign-in shows **"The requested action is invalid."**

Required Browser key HTTP referrers (APIs & Services → Credentials):

- `https://bbscalton.github.io/*`
- `https://waukee-talkee.firebaseapp.com/*`
- `https://waukee-talkee.web.app/*`
- `http://localhost:*`
- `http://127.0.0.1:*`

Console: https://console.cloud.google.com/apis/credentials?project=waukee-talkee

TCD admin UI: https://bbscalton.github.io/WaukeeTalkee/TCD/

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
3. HTTP referrers on that key (and on the Firebase Browser key used for Auth): `https://bbscalton.github.io/*`, `https://waukee-talkee.firebaseapp.com/*`, `https://waukee-talkee.web.app/*`, `http://localhost:*`, `http://127.0.0.1:*`.
4. Local: set `VITE_GOOGLE_MAPS_API_KEY` in `dispatcher/.env` to the Browser key. Pages deploy injects the same name from GitHub Actions secrets (`VITE_GOOGLE_MAPS_API_KEY`).

If the map shows a red “Map unavailable” overlay, check the browser console for `RefererNotAllowedMapError` / `ApiNotActivatedMapError` / billing errors.


## Later slices

Booking cascade, walkie audio, speed alerts, safety kiosk lock.
