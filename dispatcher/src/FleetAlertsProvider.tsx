import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import { Link } from "react-router-dom";
import { db, ORG_ID } from "./firebase";
import {
  formatFleetEventType,
  type FleetEvent,
  type FleetEventType,
  type PlaceType,
} from "./types";

type FleetAlertsContextValue = {
  events: FleetEvent[];
  unread: number;
  markSeen: () => void;
};

const FleetAlertsContext = createContext<FleetAlertsContextValue | null>(null);

export function useFleetAlerts(): FleetAlertsContextValue {
  const ctx = useContext(FleetAlertsContext);
  if (!ctx) {
    throw new Error("useFleetAlerts must be used within FleetAlertsProvider");
  }
  return ctx;
}

function parseEvent(
  id: string,
  data: Record<string, unknown>
): FleetEvent {
  const type = String(data.type || "") as FleetEventType;
  return {
    id,
    type,
    driverId: String(data.driverId || ""),
    driverName: String(data.driverName || "Driver"),
    placeId: typeof data.placeId === "string" ? data.placeId : null,
    placeName: typeof data.placeName === "string" ? data.placeName : null,
    placeType:
      data.placeType === "home_base" || data.placeType === "checkpoint"
        ? (data.placeType as PlaceType)
        : null,
    dwellMs: typeof data.dwellMs === "number" ? data.dwellMs : null,
    at: (data.at as Timestamp | null) ?? null,
    meta:
      data.meta && typeof data.meta === "object"
        ? (data.meta as Record<string, unknown>)
        : null,
  };
}

function eventMessage(ev: FleetEvent): string {
  const metaMsg =
    ev.meta && typeof ev.meta.message === "string" ? ev.meta.message : null;
  if (metaMsg) return metaMsg;
  return `${ev.driverName}: ${formatFleetEventType(ev.type)}`;
}

/**
 * Live fleetEvents listener + toast for arrive/leave/off-route/speed.
 * Seeds seen ids on first snapshot so history does not spam toasts.
 */
export function FleetAlertsProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<FleetEvent[]>([]);
  const [toast, setToast] = useState<FleetEvent | null>(null);
  const [seenCount, setSeenCount] = useState(0);
  const seenIds = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "orgs", ORG_ID, "fleetEvents"),
      orderBy("at", "desc"),
      limit(80)
    );
    return onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) =>
        parseEvent(d.id, d.data() as Record<string, unknown>)
      );
      setEvents(rows);

      if (!seeded.current) {
        seeded.current = true;
        snap.docs.forEach((d) => seenIds.current.add(d.id));
        setSeenCount(snap.size);
        return;
      }

      const additions = snap
        .docChanges()
        .filter((c) => c.type === "added")
        .map((c) => c.doc)
        .filter((d) => !seenIds.current.has(d.id));

      for (const docSnap of additions) {
        seenIds.current.add(docSnap.id);
        const ev = parseEvent(
          docSnap.id,
          docSnap.data() as Record<string, unknown>
        );
        // Skip quiet dwell refresh spam in toast (still in list)
        if (ev.type === "place_dwell") continue;
        if (toastTimer.current != null) {
          window.clearTimeout(toastTimer.current);
        }
        setToast(ev);
        toastTimer.current = window.setTimeout(() => setToast(null), 6500);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const unread = Math.max(0, events.length - seenCount);

  const value = useMemo(
    () => ({
      events,
      unread,
      markSeen: () => setSeenCount(events.length),
    }),
    [events, unread]
  );

  return (
    <FleetAlertsContext.Provider value={value}>
      {children}
      {toast && (
        <Link
          to="/alerts"
          className={`fleet-alert-toast fleet-alert-toast-${toast.type}`}
          role="status"
          aria-live="polite"
        >
          <span className="fleet-alert-toast-kind">
            {formatFleetEventType(toast.type)}
          </span>
          <span>{eventMessage(toast)}</span>
        </Link>
      )}
    </FleetAlertsContext.Provider>
  );
}

export { parseEvent, eventMessage };
