import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
  type Timestamp,
} from "firebase/firestore";
import { db, ORG_ID } from "./firebase";
import type { SosEvent } from "./types";
import { useAuth } from "./auth";

type SosContextState = {
  activeSosEvents: SosEvent[];
  resolveSos: (eventId: string) => Promise<void>;
};

const SosContext = createContext<SosContextState | null>(null);

export function SosProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [activeSosEvents, setActiveSosEvents] = useState<SosEvent[]>([]);

  useEffect(() => {
    if (!user) {
      setActiveSosEvents([]);
      return;
    }

    const q = query(
      collection(db, "orgs", ORG_ID, "sosEvents"),
      where("resolvedAt", "==", null)
    );

    return onSnapshot(
      q,
      (snap) => {
        const events: SosEvent[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            driverId: String(data.driverId || ""),
            driverName: String(data.driverName || "Driver"),
            lat: typeof data.lat === "number" ? data.lat : null,
            lng: typeof data.lng === "number" ? data.lng : null,
            message: String(data.message || "PANIC / SOS ALERT"),
            createdAt: (data.createdAt as Timestamp | null) ?? null,
            resolvedAt: null,
            resolvedBy: null,
          };
        });
        setActiveSosEvents(events);
      },
      () => {
        setActiveSosEvents([]);
      }
    );
  }, [user]);

  async function resolveSos(eventId: string) {
    await updateDoc(doc(db, "orgs", ORG_ID, "sosEvents", eventId), {
      resolvedAt: new Date(),
      resolvedBy: user?.email || "Dispatcher",
    });
  }

  return (
    <SosContext.Provider value={{ activeSosEvents, resolveSos }}>
      {children}
    </SosContext.Provider>
  );
}

export function useSos() {
  const ctx = useContext(SosContext);
  if (!ctx) throw new Error("useSos outside SosProvider");
  return ctx;
}
