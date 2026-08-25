# Customer registration & branded sites

## Public URLs (GitHub Pages)

| Page | URL |
|------|-----|
| Register | https://bbscalton.github.io/WaukeeTalkee/register/ |
| Get started (YouTube / ads landing) | https://bbscalton.github.io/WaukeeTalkee/get-started/?utm_source=youtube&utm_medium=cpc&utm_campaign=yt_guyana |
| Dynamic tenant site | https://bbscalton.github.io/WaukeeTalkee/sites/?org={orgId} |
| TCD approval | https://bbscalton.github.io/WaukeeTalkee/TCD/ |
| Dispatch console | https://bbscalton.github.io/WaukeeTalkee/app/?org={orgId} |

Examples: [`sites/?org=demo`](https://bbscalton.github.io/WaukeeTalkee/sites/?org=demo), [`sites/?org=rebert`](https://bbscalton.github.io/WaukeeTalkee/sites/?org=rebert), [`sites/?org=security`](https://bbscalton.github.io/WaukeeTalkee/sites/?org=security).

## Flow

1. Customer opens **/register/** → picks one solution → fills company + solution-specific fields → tunes brand color/tagline (live preview) → submits.
2. Cloud Function `submitRegistration` writes `registrations/{id}` with `status: pending` and a unique `orgId`.
3. Admin signs into **/TCD/** → **Pending Registrations** → Approve (optionally create customer dispatcher password) or Reject.
4. `approveRegistration` provisions:
   - `orgs/{orgId}` with solution, features, branding
   - `publicSites/{orgId}` (public marketing fields only)
   - Links `neuereatecGmailDispatcher01` as platform admin dispatcher
   - Optional customer Auth user + dispatcher doc
5. Customer site is live at `/sites/?org={orgId}`; console at `/app/?org={orgId}`.

## Data model

```
registrations/{regId}
  status: pending | approved | rejected
  solution, orgId, companyName, contactName, email, phone
  city, region, teamSize, brandColor, tagline, websiteUrl?
  solutionFields: { ... }
  createdAt, reviewedAt?, reviewedBy?, notes?, customerUid?

publicSites/{orgId}   // public read
  displayName, companyName, solution, tagline, brandColor
  city, region, teamSize, initials
  productName, headline, promise, features[], ctaLabel, teamNoun

orgs/{orgId}          // existing + branding fields on approve
  displayName, solution, features, brandColor, tagline, ...
```

## Cloud Functions

| Callable | Auth | Role |
|----------|------|------|
| `submitRegistration` | Public | Create pending registration |
| `listRegistrations` | Admin email | List queue |
| `approveRegistration` | Admin email | Provision org + publicSites |
| `rejectRegistration` | Admin email | Mark rejected |

Admin gate: Firebase Auth email `neuereatec@gmail.com`.

## Seed public sites for existing orgs

```bash
cd firebase/functions
npm run build
SEED_PUBLIC_SITES=1 npm run seed
```

Backfills `publicSites` for demo, rebert, security, field, truck, family, retail.

## Deploy notes

- Website files under `website/register/`, `website/sites/`, `website/get-started/`, `website/ads/` deploy via GitHub Pages on push to `main`.
- YouTube ad paste sheet: repo root [`ADS.md`](../../ADS.md) (also [`website/ads/youtube.md`](../ads/youtube.md)).
- Deep-link a vertical: `/register/?sol=security#picker` (also `field`, `truck`, `family`, `retail`, `concrete`, `taxi`).
- Deploy functions + rules separately:

```bash
cd firebase
firebase deploy --only functions:submitRegistration,functions:listRegistrations,functions:approveRegistration,functions:rejectRegistration,firestore:rules,firestore:indexes
```

Or full: `firebase deploy --only functions,firestore`.
