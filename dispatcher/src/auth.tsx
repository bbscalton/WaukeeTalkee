import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db, ORG_ID } from "./firebase";
import type { DispatcherRole } from "./types";

type AuthState = {
  user: User | null;
  loading: boolean;
  isDispatcher: boolean;
  dispatcherRole: DispatcherRole;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDispatcher, setIsDispatcher] = useState(false);
  const [dispatcherRole, setDispatcherRole] = useState<DispatcherRole>("dispatcher");

  useEffect(() => {
    return onAuthStateChanged(auth, async (next) => {
      setUser(next);
      if (!next) {
        setIsDispatcher(false);
        setDispatcherRole("dispatcher");
        setLoading(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, "orgs", ORG_ID, "dispatchers", next.uid));
        setIsDispatcher(snap.exists());
        if (snap.exists()) {
          const data = snap.data();
          const role = data?.role as DispatcherRole | undefined;
          setDispatcherRole(role && ["admin","supervisor","dispatcher"].includes(role) ? role : "dispatcher");
        }
      } catch {
        setIsDispatcher(false);
        setDispatcherRole("dispatcher");
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      isDispatcher,
      dispatcherRole,
      login: async (email, password) => {
        await signInWithEmailAndPassword(auth, email, password);
      },
      logout: async () => {
        await signOut(auth);
      },
    }),
    [user, loading, isDispatcher, dispatcherRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
