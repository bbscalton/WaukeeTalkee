import { deleteDoc, doc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions, ORG_ID } from "./firebase";

/** Hard-delete one fleet alert (dispatcher-only per rules). */
export async function deleteFleetEvent(eventId: string): Promise<void> {
  await deleteDoc(doc(db, "orgs", ORG_ID, "fleetEvents", eventId));
}

type ClearResult = { deleted: number };

/** Delete every fleetEvent for the org (server-side batch). */
export async function clearAllFleetEvents(): Promise<number> {
  const fn = httpsCallable(functions, "clearFleetEvents");
  const res = await fn({ orgId: ORG_ID });
  const data = res.data as ClearResult;
  return Number(data.deleted ?? 0);
}
