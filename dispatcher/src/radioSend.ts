import {
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";
import { db, ORG_ID } from "./firebase";
import type { RadioAudience } from "./types";

export type RadioSendPayload = {
  from: "dispatch" | "driver";
  driverId: string;
  audioBase64: string;
  contentType: string;
  durationMs: number;
  audience: RadioAudience;
  lat?: number;
  lng?: number;
  senderDriverId?: string;
  senderDisplayName?: string;
  groupId?: string;
};

async function writeClip(payload: RadioSendPayload): Promise<void> {
  const doc: Record<string, unknown> = {
    from: payload.from,
    driverId: payload.driverId,
    audioBase64: payload.audioBase64,
    contentType: payload.contentType,
    durationMs: payload.durationMs,
    audience: payload.audience,
    createdAt: serverTimestamp(),
  };
  if (typeof payload.lat === "number" && typeof payload.lng === "number") {
    doc.lat = payload.lat;
    doc.lng = payload.lng;
  }
  if (payload.senderDriverId) doc.senderDriverId = payload.senderDriverId;
  if (payload.senderDisplayName) doc.senderDisplayName = payload.senderDisplayName;
  if (payload.groupId) doc.groupId = payload.groupId;
  await addDoc(collection(db, "orgs", ORG_ID, "radio"), doc);
}

/** Dispatch → one driver (direct). */
export async function sendDirectToDriver(
  payload: Omit<RadioSendPayload, "from" | "audience" | "driverId"> & {
    driverId: string;
  }
): Promise<void> {
  await writeClip({ ...payload, from: "dispatch", audience: "direct" });
}

/** Dispatch → every paired driver in the org. */
export async function broadcastToAllDrivers(
  memberIds: string[],
  payload: Omit<RadioSendPayload, "from" | "audience" | "driverId">
): Promise<number> {
  const ids = [...new Set(memberIds.filter(Boolean))];
  await Promise.all(
    ids.map((driverId) =>
      writeClip({ ...payload, from: "dispatch", driverId, audience: "all" })
    )
  );
  return ids.length;
}

/** Dispatch → each member of a group. */
export async function broadcastToGroupMembers(
  memberIds: string[],
  groupId: string,
  payload: Omit<RadioSendPayload, "from" | "audience" | "driverId" | "groupId">
): Promise<number> {
  const ids = [...new Set(memberIds.filter(Boolean))];
  await Promise.all(
    ids.map((driverId) =>
      writeClip({
        ...payload,
        from: "dispatch",
        driverId,
        audience: "group",
        groupId,
      })
    )
  );
  return ids.length;
}
