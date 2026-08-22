# Rebert Construction setup

Concrete solution profile for org `rebert`.

## Firebase org document

Seed the org and link a dispatcher (requires Firebase Admin credentials):

```bash
cd firebase/functions
ORG_ID=rebert DISPATCHER_UID=<firebase-auth-uid> DISPATCHER_EMAIL=dispatch@rebert.local npm run seed
```

This creates `orgs/rebert` with:

- `solution: "concrete"`
- `displayName: "Rebert Construction"`
- `features`: plant queue and billing off by default

Org docs are admin-only write (`firestore.rules`). Adjust `features` overrides via Firebase console or Admin SDK.

## Dispatcher access

- **GitHub Pages:** https://bbscalton.github.io/WaukeeTalkee/app/?org=rebert
- **Marketing site:** https://bbscalton.github.io/WaukeeTalkee/RebertConstruction/

The `?org=rebert` query param selects the org at runtime. Sign in with a user linked under `orgs/rebert/dispatchers/{uid}`.

## Local development

```bash
cd dispatcher
# .env: VITE_ORG_ID=rebert and optionally VITE_SOLUTION=concrete
npm run dev
```

Without Firestore, env fallbacks apply: `VITE_ORG_ID=rebert` infers concrete; `VITE_SOLUTION=concrete` forces the profile.
