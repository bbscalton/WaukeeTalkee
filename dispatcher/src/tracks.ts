import { httpsCallable } from "firebase/functions";
import { functions, ORG_ID } from "./firebase";
import { dayBounds } from "./radio";

type ClearResult = { deleted: number };

/** Delete Map DVR points for one driver in the browser-local day window. */
export async function clearMapDvrDay(
  driverId: string,
  dayKey: string
): Promise<number> {
  const { start, end } = dayBounds(dayKey);
  const fn = httpsCallable(functions, "clearMapDvrTracks");
  const res = await fn({
    orgId: ORG_ID,
    scope: "day",
    driverId,
    startMs: start.getTime(),
    endMs: end.getTime(),
  });
  const data = res.data as ClearResult;
  return Number(data.deleted ?? 0);
}

/** Delete all Map DVR track points for the org (every driver). */
export async function clearMapDvrAll(): Promise<number> {
  const fn = httpsCallable(functions, "clearMapDvrTracks");
  const res = await fn({
    orgId: ORG_ID,
    scope: "all",
  });
  const data = res.data as ClearResult;
  return Number(data.deleted ?? 0);
}
