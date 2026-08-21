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

## Dispatcher (local)

```bash
cd dispatcher
npm install
npm run dev
```

## Android

Open `android/` in Android Studio (`google-services.json` is already wired to `waukee-talkee`).

## GitHub Pages

Push repo, enable Pages via Actions, add `VITE_FIREBASE_*` secrets from `dispatcher/.env`, and add `*.github.io` under Auth → Settings → Authorized domains.

## Later slices

Booking cascade, walkie audio, speed alerts, safety kiosk lock.
