import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type Query,
  type Transaction,
} from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

initializeApp();
setGlobalOptions({ region: "us-central1" });

const db = getFirestore();
const auth = getAuth();
const DEFAULT_ORG = "demo";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;
const CODE_TTL_MS = 30 * 60 * 1000;
/** Rolling retention for radio archive + map DVR tracks. */
const RETENTION_DAYS = 7;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const PURGE_BATCH = 400;

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
 *
 * If a previous attempt marked the code used but token creation failed,
 * the same code can still finish pairing for that driver.
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
  const codeSnap = await codeRef.get();
  if (!codeSnap.exists) {
    throw new HttpsError("not-found", "Invalid pair code.");
  }

  const codeData = codeSnap.data()!;
  const expiresAt = codeData.expiresAt as Timestamp;
  if (expiresAt.toMillis() < Date.now()) {
    throw new HttpsError("failed-precondition", "This pair code has expired. Ask dispatch for a new one.");
  }

  const driverId = String(codeData.driverId);
  const driverRef = db.doc(`orgs/${orgId}/drivers/${driverId}`);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists) {
    throw new HttpsError("not-found", "Driver profile missing.");
  }

  const driver = driverSnap.data()!;
  const authUid = `driver_${orgId}_${driverId}`;
  const displayName = String(driver.displayName || "Driver");

  // Create/ensure Auth user + custom token BEFORE finalizing pair,
  // so a permission failure does not leave the phone stuck.
  try {
    await auth.getUser(authUid);
  } catch {
    await auth.createUser({
      uid: authUid,
      displayName,
      disabled: false,
    });
  }

  let customToken: string;
  try {
    customToken = await auth.createCustomToken(authUid, {
      role: "driver",
      orgId,
      driverId,
    });
  } catch (err) {
    console.error("createCustomToken failed", err);
    throw new HttpsError(
      "internal",
      "Could not create driver login. Try again in a minute, or ask dispatch for a new code."
    );
  }

  await db.runTransaction(async (tx: Transaction) => {
    const freshCode = await tx.get(codeRef);
    if (!freshCode.exists) {
      throw new HttpsError("not-found", "Invalid pair code.");
    }
    const fresh = freshCode.data()!;
    // Allow retry if already marked used (failed client after server success).
    if (fresh.usedAt && fresh.deviceId && fresh.deviceId !== deviceId) {
      throw new HttpsError(
        "failed-precondition",
        "This pair code was already used on another phone. Ask dispatch for a new one."
      );
    }

    tx.set(
      codeRef,
      {
        usedAt: FieldValue.serverTimestamp(),
        deviceId,
      },
      { merge: true }
    );
    tx.update(driverRef, {
      pairStatus: "paired",
      deviceId,
      authUid,
      onDuty: false,
    });
  });

  return {
    orgId,
    driverId,
    displayName,
    customToken,
  };
});

async function deleteQueryBatch(query: Query, label: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snap = await query.limit(PURGE_BATCH).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < PURGE_BATCH) break;
  }
  if (deleted > 0) {
    console.log(`Purged ${deleted} ${label}`);
  }
  return deleted;
}

/**
 * Dispatcher Map DVR clear: one driver's local calendar day, or all org tracks.
 * Day window (startMs/endMs) comes from the browser so it matches Replay filters.
 */
export const clearMapDvrTracks = onCall(
  {
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async (request) => {
    assertAuth(request.auth);
    const orgId = String(request.data?.orgId || DEFAULT_ORG);
    await assertDispatcher(orgId, request.auth.uid);

    const scope = String(request.data?.scope || "").trim();

    if (scope === "day") {
      const driverId = String(request.data?.driverId || "").trim();
      const startMs = Number(request.data?.startMs);
      const endMs = Number(request.data?.endMs);
      if (!driverId) {
        throw new HttpsError("invalid-argument", "driverId is required.");
      }
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        throw new HttpsError("invalid-argument", "Valid startMs/endMs required.");
      }
      // Browser day window should be ~24h; reject absurd ranges.
      if (endMs - startMs > 48 * 60 * 60 * 1000) {
        throw new HttpsError("invalid-argument", "Day window too large.");
      }

      const deleted = await deleteQueryBatch(
        db
          .collection(`orgs/${orgId}/tracks/${driverId}/points`)
          .where("t", ">=", Timestamp.fromMillis(startMs))
          .where("t", "<", Timestamp.fromMillis(endMs)),
        `clear day ${orgId}/${driverId}`
      );
      return { deleted, scope: "day", driverId, orgId };
    }

    if (scope === "all") {
      const trackDrivers = await db
        .collection(`orgs/${orgId}/tracks`)
        .listDocuments();
      let deleted = 0;
      for (const driverTrack of trackDrivers) {
        deleted += await deleteQueryBatch(
          driverTrack.collection("points"),
          `clear all ${orgId}/${driverTrack.id}`
        );
      }
      return { deleted, scope: "all", orgId };
    }

    throw new HttpsError("invalid-argument", "scope must be 'day' or 'all'.");
  }
);

/**
 * Daily job: drop radio clips and map track points older than 7 days
 * so archive + DVR stay a rolling window.
 */
export const purgeExpiredArchive = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/Chicago",
  },
  async () => {
    const cutoff = Timestamp.fromMillis(Date.now() - RETENTION_MS);
    const orgs = await db.collection("orgs").listDocuments();
    let radioTotal = 0;
    let trackTotal = 0;

    for (const orgRef of orgs) {
      radioTotal += await deleteQueryBatch(
        orgRef.collection("radio").where("createdAt", "<", cutoff),
        `radio clips in ${orgRef.id}`
      );

      const trackDrivers = await orgRef.collection("tracks").listDocuments();
      for (const driverTrack of trackDrivers) {
        trackTotal += await deleteQueryBatch(
          driverTrack.collection("points").where("t", "<", cutoff),
          `track points ${orgRef.id}/${driverTrack.id}`
        );
      }
    }

    console.log(
      `Retention purge done (${RETENTION_DAYS}d). radio=${radioTotal} tracks=${trackTotal}`
    );
  }
);
