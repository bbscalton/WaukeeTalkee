/**
 * Seed org + link an existing Auth user as dispatcher.
 * Also backfills publicSites/{orgId} for marketing tenant pages.
 *
 * Usage:
 *   ORG_ID=security DISPATCHER_UID=<firebase-auth-uid> DISPATCHER_EMAIL=dispatch@example.com npm run seed
 *
 * Backfill all known public sites (no dispatcher required):
 *   SEED_PUBLIC_SITES=1 npm run seed
 */
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  SOLUTION_SITE_CONTENT,
  buildPublicSiteDoc,
  type SolutionId,
} from "./registrationShared";

initializeApp();
const db = getFirestore();

type OrgPreset = {
  name: string;
  displayName: string;
  solution: string;
  features?: Record<string, boolean>;
  city?: string;
  region?: string;
  brandColor?: string;
  tagline?: string;
};

const PLANT_BILLING_OFF = {
  plantQueue: false,
  billingReports: false,
  detentionBilling: false,
  podSignature: false,
  plantCheckIn: false,
  loadTicketFields: false,
  exportCsv: false,
};

const ORG_PRESETS: Record<string, OrgPreset> = {
  demo: {
    name: "Waukee Talkee Demo",
    displayName: "Waukee Talkee",
    solution: "taxi",
    city: "Waukee",
    region: "IA",
    brandColor: "#f0b429",
    tagline: "Dispatch that feels like a radio.",
  },
  rebert: {
    name: "Rebert Construction",
    displayName: "Rebert Construction",
    solution: "concrete",
    city: "Des Moines",
    region: "IA",
    brandColor: "#f0b429",
    tagline: "Plant-to-pour coordination without the chaos.",
    features: {
      ...PLANT_BILLING_OFF,
      contacts: false,
      routes: false,
    },
  },
  security: {
    name: "Guard Watch",
    displayName: "Guard Watch",
    solution: "security",
    city: "Des Moines",
    region: "IA",
    brandColor: "#4fc3f7",
    tagline: "Security guard dispatch & patrol coordination.",
    features: {
      ...PLANT_BILLING_OFF,
      bookings: false,
      contacts: false,
      vehicles: false,
      manifests: false,
      family: false,
      reports: false,
      routes: false,
    },
  },
  field: {
    name: "Field Crew",
    displayName: "Field Crew",
    solution: "field",
    city: "Des Moines",
    region: "IA",
    brandColor: "#4caf50",
    tagline: "Field workers, jobs, and sites — radio-simple.",
    features: {
      ...PLANT_BILLING_OFF,
      vehicles: false,
      manifests: false,
      family: false,
      routes: false,
    },
  },
  truck: {
    name: "Truck Fleet",
    displayName: "Truck Fleet",
    solution: "truck",
    city: "Des Moines",
    region: "IA",
    brandColor: "#f0b429",
    tagline: "Routes, stops, and radio for the road.",
    features: {
      ...PLANT_BILLING_OFF,
      contacts: false,
      family: false,
      routes: true,
    },
  },
  family: {
    name: "Family Talk",
    displayName: "Family Talk",
    solution: "family",
    city: "Waukee",
    region: "IA",
    brandColor: "#e8a87c",
    tagline: "Stay close. Check in. Stay safe.",
    features: {
      ...PLANT_BILLING_OFF,
      map: false,
      replay: false,
      geofences: false,
      floorplan: false,
      routes: false,
      alerts: false,
      requestResponse: false,
      bookings: false,
      contacts: false,
      vehicles: false,
      manifests: false,
      reports: false,
      policeHazards: false,
      familyFeatures: true,
    },
  },
  retail: {
    name: "Retail Team",
    displayName: "Retail Team",
    solution: "retail",
    city: "Des Moines",
    region: "IA",
    brandColor: "#ff7043",
    tagline: "Store staff coordination that keeps the floor moving.",
    features: {
      ...PLANT_BILLING_OFF,
      vehicles: false,
      manifests: false,
      family: false,
      routes: false,
    },
  },
};

async function writePublicSiteLocal(
  orgId: string,
  preset: OrgPreset
): Promise<void> {
  const solution = preset.solution as SolutionId;
  const payload = buildPublicSiteDoc({
    orgId,
    companyName: preset.displayName,
    solution,
    tagline: preset.tagline,
    brandColor: preset.brandColor,
    city: preset.city || "",
    region: preset.region || "",
    teamSize: 12,
  });
  await db.doc(`publicSites/${orgId}`).set(
    {
      ...payload,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  console.log(`publicSites/${orgId} → ${payload.displayName} (${payload.solution})`);
}

async function seedPublicSites(): Promise<void> {
  for (const [orgId, preset] of Object.entries(ORG_PRESETS)) {
    await writePublicSiteLocal(orgId, preset);
  }
}

async function main() {
  if (process.env.SEED_PUBLIC_SITES === "1") {
    await seedPublicSites();
    console.log("Backfilled publicSites for all preset orgs.");
    return;
  }

  const orgId = (process.env.ORG_ID || "demo").trim().toLowerCase();
  const uid = process.env.DISPATCHER_UID;
  const email = process.env.DISPATCHER_EMAIL || "dispatcher@waukeetalkee.local";
  const solutionOverride = process.env.SOLUTION?.trim().toLowerCase();

  if (!uid) {
    console.error("Set DISPATCHER_UID to the Firebase Auth uid of the dispatcher user.");
    console.error("Or run SEED_PUBLIC_SITES=1 npm run seed to backfill marketing sites only.");
    process.exit(1);
  }

  const preset = ORG_PRESETS[orgId];
  const orgPayload: Record<string, unknown> = {
    settings: { speedUnit: "kmh" },
    createdAt: FieldValue.serverTimestamp(),
  };

  if (preset) {
    orgPayload.name = preset.name;
    orgPayload.displayName = preset.displayName;
    orgPayload.solution = preset.solution;
    if (preset.features) orgPayload.features = preset.features;
    if (preset.brandColor) orgPayload.brandColor = preset.brandColor;
    if (preset.tagline) orgPayload.tagline = preset.tagline;
    if (preset.city) orgPayload.city = preset.city;
    if (preset.region) orgPayload.region = preset.region;
  } else {
    orgPayload.name = orgId;
    orgPayload.displayName = orgId;
    if (solutionOverride) orgPayload.solution = solutionOverride;
  }

  await db.doc(`orgs/${orgId}`).set(orgPayload, { merge: true });

  await db.doc(`orgs/${orgId}/dispatchers/${uid}`).set(
    {
      email,
      displayName: "Dispatcher",
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const solution = String(orgPayload.solution || "taxi") as SolutionId;
  if (SOLUTION_SITE_CONTENT[solution]) {
    await writePublicSiteLocal(orgId, {
      name: String(orgPayload.name),
      displayName: String(orgPayload.displayName),
      solution,
      brandColor: String(orgPayload.brandColor || ""),
      tagline: String(orgPayload.tagline || ""),
      city: String(orgPayload.city || ""),
      region: String(orgPayload.region || ""),
    });
  }

  console.log(`Seeded org/${orgId} (${orgPayload.solution}) and dispatchers/${uid}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
