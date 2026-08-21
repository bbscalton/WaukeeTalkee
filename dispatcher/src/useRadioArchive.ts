import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db, ORG_ID } from "./firebase";
import { isUnreadForDispatch, parseRadioClip } from "./radio";
import type { RadioClip } from "./types";

/** Live radio archive + per-driver unread counts for dispatch. */
export function useRadioArchive() {
  const [clips, setClips] = useState<RadioClip[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "orgs", ORG_ID, "radio"),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(
      q,
      (snap) => {
        setClips(
          snap.docs.map((d) => parseRadioClip(d.id, d.data() as Record<string, unknown>))
        );
        setError(null);
      },
      (err) => setError(err.message)
    );
  }, []);

  const unreadByDriver = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of clips) {
      if (!isUnreadForDispatch(c)) continue;
      map.set(c.driverId, (map.get(c.driverId) ?? 0) + 1);
    }
    return map;
  }, [clips]);

  const totalUnread = useMemo(() => {
    let n = 0;
    unreadByDriver.forEach((v) => {
      n += v;
    });
    return n;
  }, [unreadByDriver]);

  return { clips, unreadByDriver, totalUnread, error };
}
