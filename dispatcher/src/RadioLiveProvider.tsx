import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { audioQueue, type AudioQueueState, type QueuedAudio } from "./audioQueue";
import { db, ORG_ID } from "./firebase";
import { clipTimeMs, parseRadioClip } from "./radio";
import type { RadioClip } from "./types";

type RadioLiveContextValue = {
  queue: AudioQueueState;
  enqueueManual: (clip: RadioClip, driverName: string) => void;
};

const RadioLiveContext = createContext<RadioLiveContextValue | null>(null);

export function useRadioLive(): RadioLiveContextValue {
  const ctx = useContext(RadioLiveContext);
  if (!ctx) {
    throw new Error("useRadioLive must be used within RadioLiveProvider");
  }
  return ctx;
}

/**
 * App-level listener + shared FIFO player for driver→dispatch radio.
 * Seeds seen ids on first snapshot (no backlog dump); only new clips play.
 */
export function RadioLiveProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<AudioQueueState>(() =>
    audioQueue.snapshot()
  );
  const driverNamesRef = useRef<Map<string, string>>(new Map());

  useEffect(() => audioQueue.subscribe(setQueue), []);

  useEffect(() => {
    return onSnapshot(collection(db, "orgs", ORG_ID, "drivers"), (snap) => {
      const map = new Map<string, string>();
      snap.docs.forEach((d) => {
        const data = d.data();
        map.set(d.id, String(data.displayName || "Driver"));
      });
      driverNamesRef.current = map;
    });
  }, []);

  useEffect(() => {
    const readyAt = Date.now();
    const seen = new Set<string>();
    let seeded = false;

    const q = query(
      collection(db, "orgs", ORG_ID, "radio"),
      orderBy("createdAt", "desc")
    );

    return onSnapshot(
      q,
      (snap) => {
        if (!seeded) {
          seeded = true;
          snap.docs.forEach((d) => seen.add(d.id));
          return;
        }

        // Chronological order so simultaneous TX stays FIFO by createdAt.
        const additions = snap
          .docChanges()
          .filter((c) => c.type === "added")
          .map((c) => c.doc)
          .filter((d) => !seen.has(d.id));

        additions.sort((a, b) => {
          const aMs = a.data().createdAt?.toMillis?.() ?? 0;
          const bMs = b.data().createdAt?.toMillis?.() ?? 0;
          return aMs - bMs;
        });

        for (const docSnap of additions) {
          seen.add(docSnap.id);
          const clip = parseRadioClip(
            docSnap.id,
            docSnap.data() as Record<string, unknown>
          );
          if (clip.from !== "driver") continue;
          if (clip.audience === "peer") continue;
          if (!clip.audioBase64) continue;
          const created = clipTimeMs(clip);
          if (created && created < readyAt - 2000) continue;

          const item: QueuedAudio = {
            id: clip.id,
            driverId: clip.driverId,
            driverName: driverNamesRef.current.get(clip.driverId) || "Driver",
            audioBase64: clip.audioBase64,
            contentType: clip.contentType,
            source: "live",
            markHeard: true,
          };
          audioQueue.enqueue(item);
        }
      },
      () => {
        /* archive hook surfaces query errors */
      }
    );
  }, []);

  const enqueueManual = useCallback((clip: RadioClip, driverName: string) => {
    if (!clip.audioBase64) return;
    audioQueue.enqueue({
      id: clip.id,
      driverId: clip.driverId,
      driverName,
      audioBase64: clip.audioBase64,
      contentType: clip.contentType,
      source: "manual",
      markHeard: clip.from === "driver" && !clip.dispatchHeardAt,
    });
  }, []);

  const value = useMemo(
    () => ({ queue, enqueueManual }),
    [queue, enqueueManual]
  );

  const toast =
    queue.current?.source === "live" ? queue.current : null;

  return (
    <RadioLiveContext.Provider value={value}>
      {children}
      {toast && (
        <div className="radio-live-toast" role="status" aria-live="polite">
          <span className="radio-live-toast-dot" aria-hidden />
          Radio from {toast.driverName}
          {queue.pending > 0 ? (
            <span className="radio-live-toast-queue">
              · {queue.pending} waiting
            </span>
          ) : null}
        </div>
      )}
      {queue.error && (
        <div className="radio-live-toast radio-live-toast-warn" role="status">
          {queue.error}
        </div>
      )}
    </RadioLiveContext.Provider>
  );
}
