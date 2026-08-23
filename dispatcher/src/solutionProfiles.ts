export type SolutionId = "taxi" | "concrete" | "security" | "field" | "family";

export type FeatureKey =
  | "map"
  | "inbox"
  | "replay"
  | "geofences"
  | "alerts"
  | "drivers"
  | "groups"
  | "requestResponse"
  | "bookings"
  | "contacts"
  | "vehicles"
  | "sos"
  | "plantQueue"
  | "billingReports"
  | "detentionBilling"
  | "podSignature"
  | "plantCheckIn"
  | "loadTicketFields"
  | "exportCsv"
  | "guardTours"
  | "familyFeatures";

export type SolutionLabels = {
  appBrand: string;
  map: string;
  inbox: string;
  replay: string;
  geofences: string;
  alerts: string;
  drivers: string;
  groups: string;
  requestResponse: string;
  bookings: string;
  contacts: string;
  onDuty: string;
  offDuty: string;
  assignDriver: string;
  newBooking: string;
  createBooking: string;
};

export type SolutionProfile = {
  id: SolutionId;
  displayName: string;
  features: Record<FeatureKey, boolean>;
  labels: SolutionLabels;
};

export type OrgSolutionConfig = {
  solution?: SolutionId;
  displayName?: string;
  features?: Partial<Record<FeatureKey, boolean>>;
};

const ALL_FEATURES_ON: Record<FeatureKey, boolean> = {
  map: true,
  inbox: true,
  replay: true,
  geofences: true,
  alerts: true,
  drivers: true,
  groups: true,
  requestResponse: true,
  bookings: true,
  contacts: true,
  vehicles: true,
  sos: true,
  plantQueue: false,
  billingReports: false,
  detentionBilling: false,
  podSignature: false,
  plantCheckIn: false,
  loadTicketFields: false,
  exportCsv: false,
  guardTours: false,
  familyFeatures: false,
};

const TAXI_LABELS: SolutionLabels = {
  appBrand: "Waukee Talkee",
  map: "Radio map",
  inbox: "Inbox",
  replay: "Map DVR",
  geofences: "Bases",
  alerts: "Alerts",
  drivers: "Drivers",
  groups: "Groups",
  requestResponse: "Request / Response",
  bookings: "Bookings",
  contacts: "Contacts",
  onDuty: "on duty",
  offDuty: "off duty",
  assignDriver: "Assign driver",
  newBooking: "New booking",
  createBooking: "Create booking",
};

const CONCRETE_LABELS: SolutionLabels = {
  appBrand: "Rebert Construction",
  map: "Live map",
  inbox: "Inbox",
  replay: "Map DVR",
  geofences: "Plant & job sites",
  alerts: "Alerts",
  drivers: "Team",
  groups: "Groups",
  requestResponse: "Call & confirm",
  bookings: "Orders",
  contacts: "Contacts",
  onDuty: "on shift",
  offDuty: "off shift",
  assignDriver: "Assign team member",
  newBooking: "New order",
  createBooking: "Create order",
};

export const SOLUTION_PROFILES: Record<SolutionId, SolutionProfile> = {
  taxi: {
    id: "taxi",
    displayName: "Waukee Talkee",
    features: { ...ALL_FEATURES_ON },
    labels: TAXI_LABELS,
  },
  concrete: {
    id: "concrete",
    displayName: "Rebert Construction",
    features: {
      ...ALL_FEATURES_ON,
      contacts: false,
      plantQueue: false,
      billingReports: false,
      detentionBilling: false,
      podSignature: false,
      plantCheckIn: false,
      loadTicketFields: false,
      exportCsv: false,
      guardTours: false,
      familyFeatures: false,
    },
    labels: CONCRETE_LABELS,
  },
  security: {
    id: "security",
    displayName: "Security",
    features: {
      ...ALL_FEATURES_ON,
      bookings: false,
      plantQueue: false,
      billingReports: false,
      familyFeatures: false,
    },
    labels: TAXI_LABELS,
  },
  field: {
    id: "field",
    displayName: "Field crews",
    features: {
      ...ALL_FEATURES_ON,
      bookings: false,
      plantQueue: false,
      billingReports: false,
    },
    labels: {
      ...TAXI_LABELS,
      drivers: "Crew",
      geofences: "Sites",
    },
  },
  family: {
    id: "family",
    displayName: "Family",
    features: {
      ...ALL_FEATURES_ON,
      bookings: false,
      geofences: false,
      plantQueue: false,
      billingReports: false,
      guardTours: false,
      familyFeatures: true,
    },
    labels: {
      ...TAXI_LABELS,
      drivers: "Members",
    },
  },
};

export type NavRouteKey =
  | "map"
  | "inbox"
  | "replay"
  | "geofences"
  | "alerts"
  | "drivers"
  | "groups"
  | "requests"
  | "bookings"
  | "contacts"
  | "vehicles";

export const NAV_ROUTES: {
  key: NavRouteKey;
  path: string;
  feature: FeatureKey;
  labelKey: keyof SolutionLabels;
}[] = [
  { key: "map", path: "/map", feature: "map", labelKey: "map" },
  { key: "inbox", path: "/inbox", feature: "inbox", labelKey: "inbox" },
  { key: "replay", path: "/replay", feature: "replay", labelKey: "replay" },
  {
    key: "geofences",
    path: "/geofences",
    feature: "geofences",
    labelKey: "geofences",
  },
  { key: "alerts", path: "/alerts", feature: "alerts", labelKey: "alerts" },
  { key: "drivers", path: "/drivers", feature: "drivers", labelKey: "drivers" },
  { key: "groups", path: "/groups", feature: "groups", labelKey: "groups" },
  {
    key: "requests",
    path: "/requests",
    feature: "requestResponse",
    labelKey: "requestResponse",
  },
  {
    key: "bookings",
    path: "/bookings",
    feature: "bookings",
    labelKey: "bookings",
  },
  {
    key: "vehicles",
    path: "/vehicles",
    feature: "vehicles",
    labelKey: "drivers",
  },
];

export function routeFeature(path: string): FeatureKey | null {
  const route = NAV_ROUTES.find((r) => r.path === path);
  return route?.feature ?? null;
}

export function inferSolutionFromOrgId(orgId: string): SolutionId | undefined {
  if (orgId === "rebert") return "concrete";
  return undefined;
}

export function resolveSolutionProfile(
  orgConfig: OrgSolutionConfig | null | undefined,
  orgId: string
): SolutionProfile {
  const envSolution = import.meta.env.VITE_SOLUTION as SolutionId | undefined;
  const solutionId: SolutionId =
    orgConfig?.solution ||
    envSolution ||
    inferSolutionFromOrgId(orgId) ||
    "taxi";

  const base = SOLUTION_PROFILES[solutionId] ?? SOLUTION_PROFILES.taxi;
  const overrides = orgConfig?.features ?? {};

  return {
    ...base,
    displayName: orgConfig?.displayName || base.displayName,
    features: { ...base.features, ...overrides },
    labels: { ...base.labels },
  };
}

export function isFeatureEnabled(
  profile: SolutionProfile,
  feature: FeatureKey
): boolean {
  return profile.features[feature] ?? false;
}
