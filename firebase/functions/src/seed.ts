/**
 * Seed org + link an existing Auth user as dispatcher.
 *
 * Usage:
 *   ORG_ID=security DISPATCHER_UID=<firebase-auth-uid> DISPATCHER_EMAIL=dispatch@example.com npm run seed
 */
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();

type OrgPreset = {
  name: string;
  displayName: string;
  solution: string;
  features?: Record<string, boolean>;
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
  },
  rebert: {
    name: "Rebert Construction",
    displayName: "Rebert Construction",
    solution: "concrete",
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
    features: {
      ...PLANT_BILLING_OFF,
      map: false,
      replay: false,
      geofences: false,
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
    features: {
      ...PLANT_BILLING_OFF,
      vehicles: false,
      manifests: false,
      family: false,
      routes: false,
    },
  },
};

async function main() {
  const orgId = (process.env.ORG_ID || "demo").trim().toLowerCase();
  const uid = process.env.DISPATCHER_UID;
  const email = process.env.DISPATCHER_EMAIL || "dispatcher@waukeetalkee.local";
  const solutionOverride = process.env.SOLUTION?.trim().toLowerCase();

  if (!uid) {
    console.error("Set DISPATCHER_UID to the Firebase Auth uid of the dispatcher user.");
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

  console.log(`Seeded org/${orgId} (${orgPayload.solution}) and dispatchers/${uid}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
