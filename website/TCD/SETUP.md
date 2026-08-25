# Waukee Talkee — Multi-vertical setup

Master reference for all solution orgs, URLs, and Firebase seeding.

## Customer registration & approval

| Step | Where |
|------|--------|
| Public register | [/register/](https://talk.neuereatec.org/register/) |
| YouTube / ads landing | [/get-started/](https://talk.neuereatec.org/get-started/?utm_source=youtube&utm_medium=cpc&utm_campaign=yt_guyana) (pick your world → register / WhatsApp) |
| Branded tenant site | [/sites/?org={orgId}](https://talk.neuereatec.org/sites/?org=demo) |
| Admin approve/reject | [/TCD/](https://talk.neuereatec.org/TCD/) → Pending Registrations |

On approve, Cloud Functions provision `orgs/{orgId}`, `publicSites/{orgId}`, and link the platform admin as dispatcher. Optionally create a customer dispatcher password. Full details: [`../register/README.md`](../register/README.md).

Backfill public sites for existing orgs:

```bash
cd firebase/functions && npm run build && SEED_PUBLIC_SITES=1 npm run seed
```

## Solutions directory

| Vertical | Org ID | Solution | Marketing page | Dispatch URL |
|----------|--------|----------|----------------|--------------|
| Taxi / demo (default) | `demo` | taxi | [/](https://bbscalton.github.io/WaukeeTalkee/) or [/sites/?org=demo](https://bbscalton.github.io/WaukeeTalkee/sites/?org=demo) | [/app/](https://bbscalton.github.io/WaukeeTalkee/app/) |
| Rebert Construction | `rebert` | concrete | [/RebertConstruction/](https://bbscalton.github.io/WaukeeTalkee/RebertConstruction/) | [/app/?org=rebert](https://bbscalton.github.io/WaukeeTalkee/app/?org=rebert) |
| Guard Watch | `security` | security | [/GuardWatch/](https://bbscalton.github.io/WaukeeTalkee/GuardWatch/) | [/app/?org=security](https://bbscalton.github.io/WaukeeTalkee/app/?org=security) |
| Field Crew | `field` | field | [/FieldCrew/](https://bbscalton.github.io/WaukeeTalkee/FieldCrew/) | [/app/?org=field](https://bbscalton.github.io/WaukeeTalkee/app/?org=field) |
| Truck Fleet | `truck` | truck | [/TruckFleet/](https://bbscalton.github.io/WaukeeTalkee/TruckFleet/) | [/app/?org=truck](https://bbscalton.github.io/WaukeeTalkee/app/?org=truck) |
| Family Talk | `family` | family | [/FamilyTalk/](https://bbscalton.github.io/WaukeeTalkee/FamilyTalk/) | [/app/?org=family](https://bbscalton.github.io/WaukeeTalkee/app/?org=family) |
| Retail Team | `retail` | retail | [/RetailTeam/](https://bbscalton.github.io/WaukeeTalkee/RetailTeam/) | [/app/?org=retail](https://bbscalton.github.io/WaukeeTalkee/app/?org=retail) |

**Technical Control Desk:** [/TCD/](https://bbscalton.github.io/WaukeeTalkee/TCD/)

## Firebase org seeding

From `firebase/functions`, link a dispatcher Auth UID to each org:

```bash
cd firebase/functions

# Repeat for each org ID (demo, rebert, security, field, truck, family, retail)
ORG_ID=security \
DISPATCHER_UID=<firebase-auth-uid> \
DISPATCHER_EMAIL=neuereatec@gmail.com \
npm run seed
```

Example UID for admin account: link `neuereatec@gmail.com` user `neuereatecGmailDispatcher01` (get UID from Firebase Auth console).

Each seed creates/updates `orgs/{orgId}` with the correct `solution`, `displayName`, and default `features`, plus `orgs/{orgId}/dispatchers/{uid}`, and syncs `publicSites/{orgId}`.

Or use **TCD** → Create Organization / Create Dispatcher Account (admin: `neuereatec@gmail.com`).

## Local dispatcher development

```bash
cd dispatcher
# .env example: VITE_ORG_ID=security
npm run dev
```

Without Firestore, `inferSolutionFromOrgId()` maps org IDs to solution profiles. Override with `VITE_SOLUTION=security`.

## Build & deploy

GitHub Pages deploys from `website/` on push to `main`. Dispatcher build:

```bash
cd dispatcher
VITE_BASE_PATH=/WaukeeTalkee/app/ npm run build
# Copy dist/* to website/app/ (handled by CI workflow)
```

Deploy registration Cloud Functions + rules:

```bash
cd firebase
firebase deploy --only functions,firestore
```

## Phase 2 (not yet implemented)

- **Guard Watch:** guard tours, incident reports
- Per-vertical branded driver APK builds (currently shared `WaukeeTalkee-driver.apk`)
