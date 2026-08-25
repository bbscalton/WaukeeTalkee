# Waukee Talkee — YouTube Ads (Guyana)

Paste-ready campaign notes for Google Ads / YouTube.  
Business: **Neuereatec Enterprise** · WhatsApp: **+592 7129487**

**Pause the campaign until a payment profile is added.** Start at **$5 USD/day** — do not raise budget until you have conversions.

---

## Final URL (use this everywhere)

```
https://talk.neuereatec.org/get-started/?utm_source=youtube&utm_medium=cpc&utm_campaign=yt_guyana
```

| Piece | Value |
|-------|--------|
| Landing | `/get-started/` — first screen = **pick your world** (7 verticals, not taxi-only) |
| Primary CTA on page | Get started → `/register/#picker` (UTMs preserved) |
| Secondary CTA | [WhatsApp](https://wa.me/5927129487) |
| Register (same UTMs) | `https://talk.neuereatec.org/register/?utm_source=youtube&utm_medium=cpc&utm_campaign=yt_guyana#picker` |
| Thank-you | Existing register confirmation (“You’re in the queue”) after submit — no new CRM |
| Custom domain | `talk.neuereatec.org` (GitHub Pages; replaces `bbscalton.github.io/WaukeeTalkee`) |

Optional per-vertical deep links (same UTMs):

```
…/register/?sol=security&utm_source=youtube&utm_medium=cpc&utm_campaign=yt_guyana#picker
…/register/?sol=field&utm_source=youtube&utm_medium=cpc&utm_campaign=yt_guyana#picker
…/register/?sol=truck&utm_source=youtube&utm_medium=cpc&utm_campaign=yt_guyana#picker
…/register/?sol=family&utm_source=youtube&utm_medium=cpc&utm_campaign=yt_guyana#picker
…/register/?sol=retail&utm_source=youtube&utm_medium=cpc&utm_campaign=yt_guyana#picker
…/register/?sol=concrete&utm_source=youtube&utm_medium=cpc&utm_campaign=yt_guyana#picker
…/register/?sol=taxi&utm_source=youtube&utm_medium=cpc&utm_campaign=yt_guyana#picker
```
---

## Campaign settings

| Field | Value |
|-------|--------|
| Campaign name | `Waukee Talkee YouTube Guyana` |
| Objective | **Website traffic** (or Video views → click to site / contact). Goal: land on get-started or WhatsApp. |
| Daily budget | **$5 USD** (do not go higher at start) |
| Location | **Guyana only** (Presence: people in or regularly in Guyana) |
| Age | **25–55** |
| Language | English (add others only if you intentionally target them) |
| Placements | **YouTube only** — in-stream skippable + in-feed. **Turn off** Display Network / “optimized” expansion to random sites. |
| Devices | Mobile preferred (landing is mobile-first); leave desktop on unless waste shows up |
| Business name | Neuereatec Enterprise |

---

## Ad copy (paste)

**Headline**  
Dispatch that feels like a radio

**Long headline**  
One radio for guards, drivers, plants, and crews

**Description 1**  
Pair a phone with a code. See them live. Pick your world.

**Description 2**  
Security, field, truck, family, retail, concrete, taxi.

**Call to action**  
Learn more (or **Contact** / message if Google Ads offers WhatsApp-compatible CTA for your account)

**Display path** (optional)  
`bbscalton.github.io` / `get-started`

**WhatsApp (secondary — site + comments / pinned if allowed)**  
`https://wa.me/5927129487`

Suggested prefilled message (already on landing secondary button):  
`Hi — I saw Waukee Talkee on YouTube. I want to get started.`

---

## Video

**Repo status:** No 15–18s square night/radio ad file (`.mp4` / `.webm`) is in this repo.  
There is only a still: `website/assets/hero-taxi-night.png` (taxi-leaning night shot — **do not** make the whole ad taxi-only).

### What to cut (≈15s, square 1:1 or 4:5 for in-feed; 16:9 also upload for in-stream)

Use **live site** frames — platform story, not taxi-only:

1. **0–3s** — Homepage hero atmosphere + brand **Waukee Talkee** + line: “One radio. Seven worlds.”  
   Live: https://bbscalton.github.io/WaukeeTalkee/
2. **3–8s** — Quick flash of the seven worlds (Security → Field → Truck → Family → Retail → Concrete → Taxi) or the `/get-started/` picker grid.
3. **8–12s** — On-duty / radio UI still (homepage “ON DUTY” panel) or dispatch map from `/app/?org=demo` — “Pair a phone with a code. See them live.”
4. **12–15s** — End card: **Pick your world** + URL/path `get-started` + WhatsApp `+592 7129487`

**Audio:** No copyrighted music. Use silence, a short radio squelch/beep you own, or voiceover you record.  
**Upload:** YouTube channel owned by Neuereatec → unlisted or public → attach that video in Google Ads.

---

## Tracking (no new CRM)

1. **UTMs on every YouTube URL** — always use the Final URL above (`utm_source=youtube&utm_medium=cpc&utm_campaign=yt_guyana`). Landing and register keep UTMs in the query string (and `sessionStorage` key `wt_utm` when users click through).
2. **Google Ads** — use auto-tagging (`gclid`) in addition to UTMs; Final URL must stay on get-started.
3. **Conversion (keep simple)**  
   - Primary: clicks to Final URL / engaged sessions on get-started  
   - Secondary: WhatsApp clicks (optional Google click conversion or just count chats manually)  
   - Register submit already shows confirmation (“You’re in the queue”) — treat that as the thank-you; do not build a new CRM.
4. **Do not** expand to broad Display placements for “more volume” at $5/day.

---

## Google Ads steps (create → pause until payment)

1. Open [Google Ads](https://ads.google.com) → sign in as Neuereatec.
2. **Add a payment profile** when ready — leave campaign **Paused** until billing works.
3. **+ New campaign** → objective **Website traffic** (or Video) → skip goals tips if prompted.
4. Campaign type: **Video** → **Video views** or **Traffic** (whichever still offers YouTube in-stream + in-feed without forcing Display).
5. **Budget:** $5/day · Standard delivery.
6. **Locations:** Guyana only · **Age:** 25–55 · exclude ages outside that when the UI allows.
7. **Placements / Networks:** YouTube only. Disable Search/Display partners and any “optimized targeting” that pulls non-YouTube sites.
8. **Create ad group** → upload or select your YouTube video.
9. **Final URL:** paste  
   `https://talk.neuereatec.org/get-started/?utm_source=youtube&utm_medium=cpc&utm_campaign=yt_guyana`
10. Paste headline / long headline / descriptions from above. CTA: Learn more or Contact.
11. Review → **Save as paused** (or pause immediately after create).
12. After payment profile is active → enable campaign → watch first 48h for Guyana traffic only and waste placements.

---

## Checklist before spend

- [ ] Payment profile added; campaign still paused until you intentionally enable it  
- [ ] Final URL opens get-started and shows **seven worlds** (not taxi-only)  
- [ ] WhatsApp opens to +592 7129487  
- [ ] Register + TCD still work  
- [ ] Video is platform-wide (guards/drivers/plants/crews), not taxi-only  
- [ ] Daily budget = $5 USD  
- [ ] Geo = Guyana only  

Live landing after Pages deploy:  
https://talk.neuereatec.org/get-started/?utm_source=youtube&utm_medium=cpc&utm_campaign=yt_guyana
