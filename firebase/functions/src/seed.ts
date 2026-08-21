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

  if (!uid) {
    console.error("Set DISPATCHER_UID to the Firebase Auth uid of the dispatcher user.");
    process.exit(1);
  }

  await db.doc(`orgs/${orgId}`).set(
    {
      name: "Waukee Talkee Demo",
      settings: { speedUnit: "kmh" },
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

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
