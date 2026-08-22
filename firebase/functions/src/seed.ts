/**
 * Seed demo org + link an existing Auth user as dispatcher.
 *
 * Usage:
 *   DISPATCHER_UID=<firebase-auth-uid> npm run seed
 */
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();

async function main() {
  const orgId = process.env.ORG_ID || "demo";
  const uid = process.env.DISPATCHER_UID;
  const email = process.env.DISPATCHER_EMAIL || "dispatcher@waukeetalkee.local";
  const solution = process.env.SOLUTION as string | undefined;

  if (!uid) {
    console.error("Set DISPATCHER_UID to the Firebase Auth uid of the dispatcher user.");
    process.exit(1);
  }

  const orgPayload: Record<string, unknown> = {
    settings: { speedUnit: "kmh" },
    createdAt: FieldValue.serverTimestamp(),
  };

  if (orgId === "rebert") {
    orgPayload.name = "Rebert Construction";
    orgPayload.displayName = "Rebert Construction";
    orgPayload.solution = "concrete";
    orgPayload.features = {
      plantQueue: false,
      billingReports: false,
      detentionBilling: false,
      podSignature: false,
      contacts: false,
    };
  } else {
    orgPayload.name = "Waukee Talkee Demo";
    if (solution) orgPayload.solution = solution;
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

  console.log(`Seeded org/${orgId} and dispatchers/${uid}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
