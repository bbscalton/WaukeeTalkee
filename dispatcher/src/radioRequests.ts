import {
  addDoc,
  collection,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db, ORG_ID } from "./firebase";
import type { RadioRequestKind } from "./types";

/** Dispatcher request → driver must reply within this window. */
export const REQUEST_RESPONSE_WINDOW_MS = 3 * 60 * 1000;

export async function createRadioRequest(params: {
  kind: RadioRequestKind;
  driverId: string;
  driverName: string;
  outboundClipId: string;
  broadcastBatchId?: string | null;
  groupId?: string | null;
}): Promise<string> {
  const ref = await addDoc(collection(db, "orgs", ORG_ID, "radioRequests"), {
    kind: params.kind,
    driverId: params.driverId,
    driverName: params.driverName,
    outboundClipId: params.outboundClipId,
    replyClipId: null,
    status: "pending",
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + REQUEST_RESPONSE_WINDOW_MS),
    respondedAt: null,
    broadcastBatchId: params.broadcastBatchId ?? null,
    groupId: params.groupId ?? null,
  });
  return ref.id;
}

export async function createDirectRadioRequest(
  driverId: string,
  driverName: string,
  outboundClipId: string
): Promise<string> {
  return createRadioRequest({
    kind: "direct",
    driverId,
    driverName,
    outboundClipId,
  });
}

export async function createBroadcastRadioRequests(
  clips: Array<{ driverId: string; clipId: string }>,
  driverNames: Map<string, string>,
  broadcastBatchId: string,
  groupId?: string | null
): Promise<number> {
  let created = 0;
  await Promise.all(
    clips.map(async ({ driverId, clipId }) => {
      const driverName = driverNames.get(driverId) || "Driver";
      await createRadioRequest({
        kind: "broadcast",
        driverId,
        driverName,
        outboundClipId: clipId,
        broadcastBatchId,
        groupId: groupId ?? null,
      });
      created += 1;
    })
  );
  return created;
}
