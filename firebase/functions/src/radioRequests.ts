import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

const db = getFirestore();

/**
 * When a driver sends a radio clip, match it to the most recent open request
 * for that driver within the 3-minute response window.
 */
export const onDriverRadioReply = onDocumentCreated(
  {
    document: "orgs/{orgId}/radio/{clipId}",
    region: "us-central1",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    if (data.from !== "driver") return;

    const orgId = event.params.orgId;
    const clipId = event.params.clipId;
    const senderId =
      typeof data.senderDriverId === "string" && data.senderDriverId
        ? data.senderDriverId
        : typeof data.driverId === "string"
          ? data.driverId
          : null;
    if (!senderId) return;

    const createdAt = data.createdAt as Timestamp | undefined;
    if (!createdAt) return;

    const pending = await db
      .collection(`orgs/${orgId}/radioRequests`)
      .where("driverId", "==", senderId)
      .where("status", "==", "pending")
      .orderBy("createdAt", "desc")
      .limit(8)
      .get();

    for (const doc of pending.docs) {
      const req = doc.data();
      const expiresAt = req.expiresAt as Timestamp | undefined;
      const reqCreated = req.createdAt as Timestamp | undefined;
      if (!expiresAt || !reqCreated) continue;

      const clipMs = createdAt.toMillis();
      if (clipMs < reqCreated.toMillis()) continue;
      if (clipMs > expiresAt.toMillis()) continue;

      await doc.ref.update({
        status: "responded",
        replyClipId: clipId,
        respondedAt: createdAt,
      });
      return;
    }
  }
);

/** Mark pending requests expired once the 3-minute window closes. */
export const expireRadioRequests = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "America/Chicago",
    region: "us-central1",
  },
  async () => {
    const now = Timestamp.now();
    const orgs = await db.collection("orgs").listDocuments();
    let expired = 0;

    for (const orgRef of orgs) {
      const snap = await orgRef
        .collection("radioRequests")
        .where("status", "==", "pending")
        .where("expiresAt", "<", now)
        .limit(200)
        .get();

      if (snap.empty) continue;

      const batch = db.batch();
      for (const doc of snap.docs) {
        batch.update(doc.ref, { status: "expired" });
        expired += 1;
      }
      await batch.commit();
    }

    if (expired > 0) {
      console.log(`Expired ${expired} radio request(s)`);
    }
  }
);
