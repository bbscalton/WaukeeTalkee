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

export { onDriverTelemetryWritten } from "./fleetCompliance";
export { onDriverRadioReply, expireRadioRequests } from "./radioRequests";

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
    speedLimitKmh: null,
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
    speedLimitKmh: null,
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
  let orgId = String(request.data?.orgId || DEFAULT_ORG);
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

  let codeSnap = await db.doc(`orgs/${orgId}/pairCodes/${code}`).get();

  // If code is not found in requested orgId, search across all orgs
  if (!codeSnap.exists) {
    const orgsSnap = await db.collection("orgs").get();
    for (const orgDoc of orgsSnap.docs) {
      if (orgDoc.id === orgId) continue;
      const testSnap = await db.doc(`orgs/${orgDoc.id}/pairCodes/${code}`).get();
      if (testSnap.exists) {
        codeSnap = testSnap;
        orgId = orgDoc.id;
        break;
      }
    }
  }

  if (!codeSnap.exists) {
    throw new HttpsError("not-found", "Invalid pair code.");
  }

  const codeRef = db.doc(`orgs/${orgId}/pairCodes/${code}`);

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
 * Dispatcher clear: delete every fleetEvent (alerts) for the org.
 */
export const clearFleetEvents = onCall(
  {
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async (request) => {
    assertAuth(request.auth);
    const orgId = String(request.data?.orgId || DEFAULT_ORG);
    await assertDispatcher(orgId, request.auth.uid);

    const deleted = await deleteQueryBatch(
      db.collection(`orgs/${orgId}/fleetEvents`),
      `clear fleetEvents ${orgId}`
    );
    return { deleted, orgId };
  }
);

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
 * Daily job: drop radio clips, map track points, and fleet events older than 7 days
 * so archive + DVR + alerts stay a rolling window.
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
    let eventTotal = 0;

    for (const orgRef of orgs) {
      radioTotal += await deleteQueryBatch(
        orgRef.collection("radio").where("createdAt", "<", cutoff),
        `radio clips in ${orgRef.id}`
      );

      await deleteQueryBatch(
        orgRef.collection("radioRequests").where("createdAt", "<", cutoff),
        `radio requests in ${orgRef.id}`
      );

      eventTotal += await deleteQueryBatch(
        orgRef.collection("fleetEvents").where("at", "<", cutoff),
        `fleet events in ${orgRef.id}`
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
      `Retention purge done (${RETENTION_DAYS}d). radio=${radioTotal} tracks=${trackTotal} events=${eventTotal}`
    );
  }
);

function assertAdmin(requestAuth: any): asserts requestAuth is { uid: string; token: { email: string } } {
  if (!requestAuth?.uid || requestAuth.token?.email !== "neuereatec@gmail.com") {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
}

export const adminListDispatchers = onCall(async (request) => {
  assertAdmin(request.auth);
  
  const snapshot = await db.collectionGroup("dispatchers").get();
  const list = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const orgId = doc.ref.parent.parent?.id || "";
    list.push({
      uid: doc.id,
      orgId,
      email: data.email || "",
      displayName: data.displayName || "",
      role: data.role || "dispatcher",
      createdAt: data.createdAt ? (data.createdAt as Timestamp).toDate().toISOString() : null,
    });
  }
  return { dispatchers: list };
});

export const adminCreateDispatcher = onCall(async (request) => {
  assertAdmin(request.auth);
  
  const email = String(request.data?.email || "").trim().toLowerCase();
  const password = String(request.data?.password || "");
  const orgId = String(request.data?.orgId || "").trim().toLowerCase();
  const displayName = String(request.data?.displayName || "Dispatcher").trim();
  const role = String(request.data?.role || "dispatcher").trim();
  
  if (!email || !password || !orgId) {
    throw new HttpsError("invalid-argument", "email, password, and orgId are required.");
  }
  
  const orgSnap = await db.doc(`orgs/${orgId}`).get();
  if (!orgSnap.exists) {
    throw new HttpsError("not-found", `Organization ${orgId} not found.`);
  }
  
  let userRecord;
  try {
    userRecord = await auth.createUser({
      email,
      password,
      displayName,
    });
  } catch (err) {
    console.error("Error creating auth user:", err);
    throw new HttpsError("already-exists", err instanceof Error ? err.message : "User creation failed");
  }
  
  try {
    await db.doc(`orgs/${orgId}/dispatchers/${userRecord.uid}`).set({
      email,
      displayName,
      role: ["admin", "supervisor", "dispatcher"].includes(role) ? role : "dispatcher",
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    await auth.deleteUser(userRecord.uid);
    throw new HttpsError("internal", "Failed to write dispatcher document to Firestore. Auth user cleaned up.");
  }
  
  return { uid: userRecord.uid, email, orgId, role };
});


export const adminDeleteDispatcher = onCall(async (request) => {
  assertAdmin(request.auth);
  
  const uid = String(request.data?.uid || "").trim();
  const orgId = String(request.data?.orgId || "").trim();
  
  if (!uid || !orgId) {
    throw new HttpsError("invalid-argument", "uid and orgId are required.");
  }
  
  try {
    await auth.deleteUser(uid);
  } catch (err) {
    console.warn(`Auth user ${uid} not found or already deleted:`, err);
  }
  
  await db.doc(`orgs/${orgId}/dispatchers/${uid}`).delete();
  return { success: true };
});

export const adminResetDispatcherPassword = onCall(async (request) => {
  assertAdmin(request.auth);
  
  const uid = String(request.data?.uid || "").trim();
  const newPassword = String(request.data?.newPassword || "");
  
  if (!uid || !newPassword) {
    throw new HttpsError("invalid-argument", "uid and newPassword are required.");
  }
  
  if (newPassword.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }
  
  try {
    await auth.updateUser(uid, { password: newPassword });
  } catch (err) {
    throw new HttpsError("internal", err instanceof Error ? err.message : "Failed to reset password.");
  }
  
  return { success: true };
});

export const adminListOrgs = onCall(async (request) => {
  assertAdmin(request.auth);
  
  const orgsSnap = await db.collection("orgs").get();
  const list = [];
  for (const doc of orgsSnap.docs) {
    const data = doc.data();
    list.push({
      id: doc.id,
      name: data.name || data.displayName || doc.id,
      displayName: data.displayName || data.name || doc.id,
      solution: data.solution || "taxi",
      features: data.features || {},
      driverFeatures: data.driverFeatures || {},
      createdAt: data.createdAt ? (data.createdAt as Timestamp).toDate().toISOString() : null,
    });
  }
  return { orgs: list };
});

export const adminUpdateOrgFeatures = onCall(async (request) => {
  assertAdmin(request.auth);
  
  const orgId = String(request.data?.orgId || "").trim().toLowerCase();
  const features = request.data?.features;
  const driverFeatures = request.data?.driverFeatures;
  
  if (!orgId) {
    throw new HttpsError("invalid-argument", "orgId is required.");
  }
  
  const payload: Record<string, unknown> = {};
  if (features && typeof features === "object") payload.features = features;
  if (driverFeatures && typeof driverFeatures === "object") payload.driverFeatures = driverFeatures;
  
  const docRef = db.doc(`orgs/${orgId}`);
  await docRef.set(payload, { merge: true });
  return { success: true, orgId, features, driverFeatures };
});

export const adminCreateOrg = onCall(async (request) => {
  assertAdmin(request.auth);
  
  const orgId = String(request.data?.orgId || "").trim().toLowerCase();
  const displayName = String(request.data?.displayName || "").trim();
  const solution = String(request.data?.solution || "taxi").trim().toLowerCase();
  
  if (!orgId || !displayName) {
    throw new HttpsError("invalid-argument", "orgId and displayName are required.");
  }
  
  if (!/^[a-z0-9_-]+$/i.test(orgId)) {
    throw new HttpsError("invalid-argument", "orgId must contain only letters, numbers, hyphens, and underscores.");
  }
  
  const docRef = db.doc(`orgs/${orgId}`);
  const snap = await docRef.get();
  if (snap.exists) {
    throw new HttpsError("already-exists", `Organization ${orgId} already exists.`);
  }
  
  const orgPayload: Record<string, unknown> = {
    name: displayName,
    displayName: displayName,
    solution: solution,
    settings: { speedUnit: "kmh" },
    createdAt: FieldValue.serverTimestamp(),
  };

  const plantBillingOff = {
    plantQueue: false,
    billingReports: false,
    detentionBilling: false,
    podSignature: false,
    plantCheckIn: false,
    loadTicketFields: false,
    exportCsv: false,
  };

  const solutionFeatures: Record<string, Record<string, boolean>> = {
    concrete: { ...plantBillingOff, contacts: false, routes: false },
    security: {
      ...plantBillingOff,
      bookings: false,
      contacts: false,
      vehicles: false,
      manifests: false,
      family: false,
      reports: false,
      routes: false,
    },
    field: {
      ...plantBillingOff,
      vehicles: false,
      manifests: false,
      family: false,
      routes: false,
    },
    truck: { ...plantBillingOff, contacts: false, family: false, routes: true },
    family: {
      ...plantBillingOff,
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
    retail: {
      ...plantBillingOff,
      vehicles: false,
      manifests: false,
      family: false,
      routes: false,
    },
  };

  if (solutionFeatures[solution]) {
    orgPayload.features = solutionFeatures[solution];
  } else if (orgId === "rebert" || solution === "concrete") {
    orgPayload.features = solutionFeatures.concrete;
  }
  
  await docRef.set(orgPayload);
  return { orgId, displayName, solution };
});
