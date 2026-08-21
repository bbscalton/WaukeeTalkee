import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();
setGlobalOptions({ region: "us-central1" });

const db = getFirestore();
const auth = getAuth();
const DEFAULT_ORG = "demo";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;
const CODE_TTL_MS = 30 * 60 * 1000;

function assertAuth(requestAuth: { uid: string } | undefined): asserts requestAuth is { uid: string } {
  if (!requestAuth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
}

async function assertDispatcher(orgId: string, uid: string): Promise<void> {
  const snap = await db.doc(`orgs/${orgId}/dispatchers/${uid}`).get();
  if (!snap.exists) {
    throw new HttpsError("permission-denied", "Dispatcher access required.");
  }
}

function randomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

async function allocateUniqueCode(orgId: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomCode();
    const ref = db.doc(`orgs/${orgId}/pairCodes/${code}`);
    const existing = await ref.get();
    if (!existing.exists) {
      return code;
    }
  }
  throw new HttpsError("resource-exhausted", "Could not allocate a pair code.");
}

/** Create a driver profile (unpaired). */
export const createDriver = onCall(async (request) => {
  assertAuth(request.auth);
  const orgId = String(request.data?.orgId || DEFAULT_ORG);
  await assertDispatcher(orgId, request.auth.uid);

  const displayName = String(request.data?.displayName || "").trim();
  if (!displayName) {
    throw new HttpsError("invalid-argument", "displayName is required.");
  }
  const plate = request.data?.plate ? String(request.data.plate).trim() : null;

  const driverRef = db.collection(`orgs/${orgId}/drivers`).doc();
  await driverRef.set({
    displayName,
    plate,
    pairStatus: "unpaired",
    deviceId: null,
    authUid: null,
    onDuty: false,
    lastLat: null,
    lastLng: null,
    lastSpeed: null,
    lastHeading: null,
    lastTelemetryAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { orgId, driverId: driverRef.id, displayName };
});

/** Generate a one-time pair code for a driver (30 min). */
export const createPairCode = onCall(async (request) => {
  assertAuth(request.auth);
  const orgId = String(request.data?.orgId || DEFAULT_ORG);
  await assertDispatcher(orgId, request.auth.uid);

  const driverId = String(request.data?.driverId || "").trim();
  if (!driverId) {
    throw new HttpsError("invalid-argument", "driverId is required.");
  }

  const driverRef = db.doc(`orgs/${orgId}/drivers/${driverId}`);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists) {
    throw new HttpsError("not-found", "Driver not found.");
  }

  const code = await allocateUniqueCode(orgId);
  const expiresAt = Timestamp.fromMillis(Date.now() + CODE_TTL_MS);

  await db.doc(`orgs/${orgId}/pairCodes/${code}`).set({
    driverId,
    expiresAt,
    usedAt: null,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: request.auth.uid,
  });

  return {
    orgId,
    driverId,
    code,
    expiresAt: expiresAt.toDate().toISOString(),
  };
});

/** Create driver + pair code in one call (dispatcher UX). */
export const createDriverWithPairCode = onCall(async (request) => {
  assertAuth(request.auth);
  const orgId = String(request.data?.orgId || DEFAULT_ORG);
  await assertDispatcher(orgId, request.auth.uid);

  const displayName = String(request.data?.displayName || "").trim();
  if (!displayName) {
    throw new HttpsError("invalid-argument", "displayName is required.");
  }
  const plate = request.data?.plate ? String(request.data.plate).trim() : null;

  const driverRef = db.collection(`orgs/${orgId}/drivers`).doc();
  const code = await allocateUniqueCode(orgId);
  const expiresAt = Timestamp.fromMillis(Date.now() + CODE_TTL_MS);

  const batch = db.batch();
  batch.set(driverRef, {
    displayName,
    plate,
    pairStatus: "unpaired",
    deviceId: null,
    authUid: null,
    onDuty: false,
    lastLat: null,
    lastLng: null,
    lastSpeed: null,
    lastHeading: null,
    lastTelemetryAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`orgs/${orgId}/pairCodes/${code}`), {
    driverId: driverRef.id,
    expiresAt,
    usedAt: null,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: request.auth.uid,
  });
  await batch.commit();

  return {
    orgId,
    driverId: driverRef.id,
    displayName,
    code,
    expiresAt: expiresAt.toDate().toISOString(),
  };
});

/**
 * Driver redeems pair code. Returns custom token with claims
 * { role: "driver", orgId, driverId }.
 */
export const redeemPairCode = onCall(async (request) => {
  const orgId = String(request.data?.orgId || DEFAULT_ORG);
  const code = String(request.data?.code || "")
    .trim()
    .toUpperCase();
  const deviceId = String(request.data?.deviceId || "").trim();

  if (!code || code.length !== CODE_LEN) {
    throw new HttpsError("invalid-argument", "Enter a valid 6-character pair code.");
  }
  if (!deviceId) {
    throw new HttpsError("invalid-argument", "deviceId is required.");
  }

  const codeRef = db.doc(`orgs/${orgId}/pairCodes/${code}`);

  const result = await db.runTransaction(async (tx: Transaction) => {
    const codeSnap = await tx.get(codeRef);
    if (!codeSnap.exists) {
      throw new HttpsError("not-found", "Invalid pair code.");
    }
    const data = codeSnap.data()!;
    if (data.usedAt) {
      throw new HttpsError("failed-precondition", "This pair code was already used.");
    }
    const expiresAt = data.expiresAt as Timestamp;
    if (expiresAt.toMillis() < Date.now()) {
      throw new HttpsError("failed-precondition", "This pair code has expired.");
    }

    const driverId = String(data.driverId);
    const driverRef = db.doc(`orgs/${orgId}/drivers/${driverId}`);
    const driverSnap = await tx.get(driverRef);
    if (!driverSnap.exists) {
      throw new HttpsError("not-found", "Driver profile missing.");
    }

    const driver = driverSnap.data()!;
    const authUid = `driver_${orgId}_${driverId}`;

    tx.update(codeRef, { usedAt: FieldValue.serverTimestamp(), deviceId });
    tx.update(driverRef, {
      pairStatus: "paired",
      deviceId,
      authUid,
      onDuty: false,
    });

    return {
      driverId,
      displayName: String(driver.displayName || "Driver"),
      authUid,
    };
  });

  try {
    await auth.getUser(result.authUid);
  } catch {
    await auth.createUser({
      uid: result.authUid,
      displayName: result.displayName,
      disabled: false,
    });
  }

  const customToken = await auth.createCustomToken(result.authUid, {
    role: "driver",
    orgId,
    driverId: result.driverId,
  });

  return {
    orgId,
    driverId: result.driverId,
    displayName: result.displayName,
    customToken,
  };
});
