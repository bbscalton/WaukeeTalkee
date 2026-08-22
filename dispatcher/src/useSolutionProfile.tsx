import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db, ORG_ID } from "./firebase";
import {
  isFeatureEnabled,
  resolveSolutionProfile,
  type FeatureKey,
  type OrgSolutionConfig,
  type SolutionProfile,
} from "./solutionProfiles";

type SolutionProfileState = {
  profile: SolutionProfile;
  loading: boolean;
  isEnabled: (feature: FeatureKey) => boolean;
  label: (key: keyof SolutionProfile["labels"]) => string;
};

const SolutionProfileContext = createContext<SolutionProfileState | null>(null);

export function SolutionProfileProvider({ children }: { children: ReactNode }) {
  const [orgConfig, setOrgConfig] = useState<OrgSolutionConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onSnapshot(
      doc(db, "orgs", ORG_ID),
      (snap) => {
        const data = snap.data();
        if (!data) {
          setOrgConfig(null);
        } else {
          setOrgConfig({
            solution: data.solution,
            displayName: data.displayName,
            features: data.features,
          });
        }
        setLoading(false);
      },
      () => {
        setOrgConfig(null);
        setLoading(false);
      }
    );
  }, []);

  const profile = useMemo(
    () => resolveSolutionProfile(orgConfig, ORG_ID),
    [orgConfig]
  );

  const value = useMemo<SolutionProfileState>(
    () => ({
      profile,
      loading,
      isEnabled: (feature) => isFeatureEnabled(profile, feature),
      label: (key) => profile.labels[key],
    }),
    [profile, loading]
  );

  return (
    <SolutionProfileContext.Provider value={value}>
      {children}
    </SolutionProfileContext.Provider>
  );
}

export function useSolutionProfile() {
  const ctx = useContext(SolutionProfileContext);
  if (!ctx) {
    throw new Error("useSolutionProfile outside SolutionProfileProvider");
  }
  return ctx;
}
