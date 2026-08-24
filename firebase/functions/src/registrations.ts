/**
 * Customer registration + admin approval provisioning.
 * Creates pending registrations, provisions orgs + publicSites on approve.
 */
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  SOLUTIONS,
  SOLUTION_FEATURES,
  SOLUTION_SITE_CONTENT,
  type SolutionId,
  type PublicSitePayload,
  buildPublicSiteDoc,
  isValidHexColor,
  sanitizeOrgId,
  slugFromCompany,
} from "./registrationShared";

export {
  SOLUTION_FEATURES,
  SOLUTION_SITE_CONTENT,
  buildPublicSiteDoc,
  type PublicSitePayload,
  type SolutionId,
} from "./registrationShared";

// Safe if this module loads before index.ts calls initializeApp()
if (!getApps().length) {
  initializeApp();
}

function db() {
  return getFirestore();
}
function auth() {
  return getAuth();
}

const ADMIN_EMAIL = "neuereatec@gmail.com";
const ADMIN_DISPATCHER_UID = "neuereatecGmailDispatcher01";

function assertAdmin(requestAuth: { uid?: string; token?: { email?: string } } | undefined): void {
  if (!requestAuth?.uid || requestAuth.token?.email !== ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function ensureUniqueOrgId(preferred: string): Promise<string> {
  let candidate = preferred || `org-${Date.now().toString(36)}`;
  for (let i = 0; i < 20; i++) {
    const tryId = i === 0 ? candidate : `${candidate.slice(0, 32)}-${i + 1}`;
    const [orgSnap, regSnap, siteSnap] = await Promise.all([
      db().doc(`orgs/${tryId}`).get(),
      db().collection("registrations").where("orgId", "==", tryId).limit(1).get(),
      db().doc(`publicSites/${tryId}`).get(),
    ]);
    const pendingConflict = regSnap.docs.some((d) => {
      const status = d.data().status;
      return status === "pending" || status === "approved";
    });
    if (!orgSnap.exists && !siteSnap.exists && !pendingConflict) {
      return tryId;
    }
  }
  return `${candidate.slice(0, 28)}-${Date.now().toString(36)}`;
}

/** Public write helper used by seed + approve. */
export async function writePublicSite(
  orgId: string,
  input: Omit<Parameters<typeof buildPublicSiteDoc>[0], "orgId"> & { orgId?: string }
): Promise<PublicSitePayload> {
  const payload = buildPublicSiteDoc({ ...input, orgId });
  await db().doc(`publicSites/${orgId}`).set(
    {
      ...payload,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return payload;
}

/**
 * Public registration submit — no auth required.
 * Validates, allocates unique orgId, writes registrations/{id} as pending.
 */
export const submitRegistration = onCall(
  { invoker: "public" },
  async (request) => {
    const data = request.data || {};
    const solution = String(data.solution || "").trim().toLowerCase() as SolutionId;
    if (!SOLUTIONS.includes(solution)) {
      throw new HttpsError("invalid-argument", "Pick a valid solution vertical.");
    }

    const companyName = String(data.companyName || "").trim().slice(0, 80);
    const contactName = String(data.contactName || "").trim().slice(0, 80);
    const email = String(data.email || "").trim().toLowerCase().slice(0, 120);
    const phone = String(data.phone || "").trim().slice(0, 40);
    const city = String(data.city || "").trim().slice(0, 80);
    const region = String(data.region || "").trim().slice(0, 80);
    const teamSize = Math.max(1, Math.min(10000, Number(data.teamSize) || 1));
    const brandColorRaw = String(data.brandColor || "").trim();
    const brandColor = isValidHexColor(brandColorRaw)
      ? brandColorRaw
      : SOLUTION_SITE_CONTENT[solution].accentDefault;
    const tagline = String(data.tagline || "").trim().slice(0, 160);
    const websiteUrl = String(data.websiteUrl || "").trim().slice(0, 200);
    const requestedOrgId = sanitizeOrgId(String(data.orgId || data.orgSlug || companyName));
    const solutionFields =
      data.solutionFields && typeof data.solutionFields === "object"
        ? (data.solutionFields as Record<string, unknown>)
        : {};

    if (!companyName || !contactName) {
      throw new HttpsError("invalid-argument", "Company/family name and contact name are required.");
    }
    if (!isValidEmail(email)) {
      throw new HttpsError("invalid-argument", "A valid email is required.");
    }
    if (!city) {
      throw new HttpsError("invalid-argument", "City / region is required.");
    }

    const orgId = await ensureUniqueOrgId(requestedOrgId || slugFromCompany(companyName));

    const regRef = db().collection("registrations").doc();
    const payload = {
      status: "pending",
      solution,
      orgId,
      companyName,
      contactName,
      email,
      phone,
      city,
      region,
      teamSize,
      brandColor,
      tagline,
      websiteUrl: websiteUrl || null,
      solutionFields,
      createdAt: FieldValue.serverTimestamp(),
      reviewedAt: null,
      reviewedBy: null,
      notes: null,
    };

    await regRef.set(payload);

    return {
      registrationId: regRef.id,
      orgId,
      status: "pending",
      message: "We'll review and activate your console.",
    };
  }
);

/** Admin: list registrations, optionally filter by status. */
export const listRegistrations = onCall(async (request) => {
  assertAdmin(request.auth);
  const statusFilter = String(request.data?.status || "").trim().toLowerCase();

  let snap;
  if (statusFilter && ["pending", "approved", "rejected"].includes(statusFilter)) {
    snap = await db()
      .collection("registrations")
      .where("status", "==", statusFilter)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
  } else {
    snap = await db().collection("registrations").orderBy("createdAt", "desc").limit(100).get();
  }

  const registrations = snap.docs.map((docSnap) => {
    const d = docSnap.data();
    return {
      id: docSnap.id,
      status: d.status || "pending",
      solution: d.solution || "taxi",
      orgId: d.orgId || "",
      companyName: d.companyName || "",
      contactName: d.contactName || "",
      email: d.email || "",
      phone: d.phone || "",
      city: d.city || "",
      region: d.region || "",
      teamSize: d.teamSize || 0,
      brandColor: d.brandColor || "#f0b429",
      tagline: d.tagline || "",
      websiteUrl: d.websiteUrl || "",
      solutionFields: d.solutionFields || {},
      notes: d.notes || null,
      createdAt: d.createdAt ? (d.createdAt as Timestamp).toDate().toISOString() : null,
      reviewedAt: d.reviewedAt ? (d.reviewedAt as Timestamp).toDate().toISOString() : null,
      reviewedBy: d.reviewedBy || null,
    };
  });

  return { registrations };
});

/**
 * Admin approve: provision org + publicSites, link admin as initial dispatcher,
 * optionally create customer dispatcher Auth account.
 */
export const approveRegistration = onCall(async (request) => {
  assertAdmin(request.auth);
  const registrationId = String(request.data?.registrationId || "").trim();
  if (!registrationId) {
    throw new HttpsError("invalid-argument", "registrationId is required.");
  }

  const createCustomerAccount = Boolean(request.data?.createCustomerAccount);
  const customerPassword = String(request.data?.customerPassword || "");
  const notes = String(request.data?.notes || "").trim().slice(0, 500);

  const regRef = db().doc(`registrations/${registrationId}`);
  const regSnap = await regRef.get();
  if (!regSnap.exists) {
    throw new HttpsError("not-found", "Registration not found.");
  }

  const reg = regSnap.data()!;
  if (reg.status !== "pending") {
    throw new HttpsError("failed-precondition", `Registration is already ${reg.status}.`);
  }

  const solution = String(reg.solution || "taxi").toLowerCase() as SolutionId;
  if (!SOLUTIONS.includes(solution)) {
    throw new HttpsError("failed-precondition", "Invalid solution on registration.");
  }

  let orgId = sanitizeOrgId(String(reg.orgId || ""));
  if (!orgId) {
    orgId = await ensureUniqueOrgId(slugFromCompany(String(reg.companyName || "org")));
  }

  const orgRef = db().doc(`orgs/${orgId}`);
  const orgSnap = await orgRef.get();
  if (orgSnap.exists) {
    orgId = await ensureUniqueOrgId(`${orgId}-new`);
  }

  const companyName = String(reg.companyName || orgId).trim();
  const brandColor = String(reg.brandColor || SOLUTION_SITE_CONTENT[solution].accentDefault);
  const tagline = String(reg.tagline || SOLUTION_SITE_CONTENT[solution].promise);

  const orgPayload: Record<string, unknown> = {
    name: companyName,
    displayName: companyName,
    solution,
    brandColor,
    tagline,
    city: reg.city || "",
    region: reg.region || "",
    teamSize: reg.teamSize || 0,
    registrationId,
    settings: { speedUnit: "kmh" },
    createdAt: FieldValue.serverTimestamp(),
  };
  if (SOLUTION_FEATURES[solution]) {
    orgPayload.features = SOLUTION_FEATURES[solution];
  }

  await orgRef.set(orgPayload, { merge: true });

  const publicSite = await writePublicSite(orgId, {
    companyName,
    solution,
    tagline,
    brandColor,
    city: String(reg.city || ""),
    region: String(reg.region || ""),
    teamSize: Number(reg.teamSize) || 0,
    websiteUrl: String(reg.websiteUrl || ""),
    solutionFields: (reg.solutionFields as Record<string, unknown>) || {},
  });

  await db().doc(`orgs/${orgId}/dispatchers/${ADMIN_DISPATCHER_UID}`).set(
    {
      email: ADMIN_EMAIL,
      displayName: "Platform Admin",
      role: "admin",
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  let customerUid: string | null = null;
  const customerEmail = String(reg.email || "").trim().toLowerCase();
  if (createCustomerAccount && customerEmail && customerPassword.length >= 6) {
    try {
      let userRecord;
      try {
        userRecord = await auth().getUserByEmail(customerEmail);
        await auth().updateUser(userRecord.uid, {
          password: customerPassword,
          displayName: String(reg.contactName || companyName),
        });
      } catch {
        userRecord = await auth().createUser({
          email: customerEmail,
          password: customerPassword,
          displayName: String(reg.contactName || companyName),
        });
      }
      customerUid = userRecord.uid;
      await db().doc(`orgs/${orgId}/dispatchers/${customerUid}`).set(
        {
          email: customerEmail,
          displayName: String(reg.contactName || "Dispatcher"),
          role: "admin",
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.error("Customer account creation failed:", err);
      throw new HttpsError(
        "internal",
        err instanceof Error ? err.message : "Failed to create customer dispatcher account."
      );
    }
  }

  await regRef.update({
    status: "approved",
    orgId,
    reviewedAt: FieldValue.serverTimestamp(),
    reviewedBy: request.auth!.uid,
    notes: notes || null,
    customerUid,
  });

  return {
    registrationId,
    orgId,
    solution,
    siteUrl: `sites/?org=${orgId}`,
    appUrl: `app/?org=${orgId}`,
    publicSite,
    customerUid,
    message: `Approved — ${companyName} is live.`,
  };
});

/** Admin reject registration. */
export const rejectRegistration = onCall(async (request) => {
  assertAdmin(request.auth);
  const registrationId = String(request.data?.registrationId || "").trim();
  const notes = String(request.data?.notes || "").trim().slice(0, 500);
  if (!registrationId) {
    throw new HttpsError("invalid-argument", "registrationId is required.");
  }

  const regRef = db().doc(`registrations/${registrationId}`);
  const regSnap = await regRef.get();
  if (!regSnap.exists) {
    throw new HttpsError("not-found", "Registration not found.");
  }
  if (regSnap.data()?.status !== "pending") {
    throw new HttpsError("failed-precondition", `Registration is already ${regSnap.data()?.status}.`);
  }

  await regRef.update({
    status: "rejected",
    reviewedAt: FieldValue.serverTimestamp(),
    reviewedBy: request.auth!.uid,
    notes: notes || null,
  });

  return { registrationId, status: "rejected" };
});

/** Admin: backfill publicSites for known preset orgs (demo, rebert, …). */
export const backfillPublicSites = onCall(async (request) => {
  assertAdmin(request.auth);

  const presets: Array<{
    orgId: string;
    companyName: string;
    solution: SolutionId;
    city: string;
    region: string;
    brandColor: string;
    tagline: string;
  }> = [
    {
      orgId: "demo",
      companyName: "Waukee Talkee",
      solution: "taxi",
      city: "Waukee",
      region: "IA",
      brandColor: "#f0b429",
      tagline: "Dispatch that feels like a radio.",
    },
    {
      orgId: "rebert",
      companyName: "Rebert Construction",
      solution: "concrete",
      city: "Des Moines",
      region: "IA",
      brandColor: "#f0b429",
      tagline: "Plant-to-pour coordination without the chaos.",
    },
    {
      orgId: "security",
      companyName: "Guard Watch",
      solution: "security",
      city: "Des Moines",
      region: "IA",
      brandColor: "#4fc3f7",
      tagline: "Security guard dispatch & patrol coordination.",
    },
    {
      orgId: "field",
      companyName: "Field Crew",
      solution: "field",
      city: "Des Moines",
      region: "IA",
      brandColor: "#4caf50",
      tagline: "Field workers, jobs, and sites — radio-simple.",
    },
    {
      orgId: "truck",
      companyName: "Truck Fleet",
      solution: "truck",
      city: "Des Moines",
      region: "IA",
      brandColor: "#f0b429",
      tagline: "Routes, stops, and radio for the road.",
    },
    {
      orgId: "family",
      companyName: "Family Talk",
      solution: "family",
      city: "Waukee",
      region: "IA",
      brandColor: "#e8a87c",
      tagline: "Stay close. Check in. Stay safe.",
    },
    {
      orgId: "retail",
      companyName: "Retail Team",
      solution: "retail",
      city: "Des Moines",
      region: "IA",
      brandColor: "#ff7043",
      tagline: "Store staff coordination that keeps the floor moving.",
    },
  ];

  const written: string[] = [];
  for (const p of presets) {
    await writePublicSite(p.orgId, {
      companyName: p.companyName,
      solution: p.solution,
      tagline: p.tagline,
      brandColor: p.brandColor,
      city: p.city,
      region: p.region,
      teamSize: 12,
    });
    written.push(p.orgId);
  }

  return { written, count: written.length };
});
