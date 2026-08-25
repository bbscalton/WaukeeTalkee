export type SolutionId =
  | "taxi"
  | "concrete"
  | "security"
  | "field"
  | "truck"
  | "family"
  | "retail";

export type FeatureKey =
  | "map"
  | "inbox"
  | "replay"
  | "geofences"
  | "floorplan"
  | "routes"
  | "alerts"
  | "drivers"
  | "groups"
  | "requestResponse"
  | "bookings"
  | "contacts"
  | "vehicles"
  | "manifests"
  | "family"
  | "reports"
  | "sos"
  | "policeHazards"
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
  floorplan: string;
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
  floorplan: true,
  routes: true,
  alerts: true,
  drivers: true,
  groups: true,
  requestResponse: true,
  bookings: true,
  contacts: true,
  vehicles: true,
  manifests: true,
  family: true,
  reports: true,
  sos: true,
  policeHazards: true,
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

const PLANT_BILLING_OFF: Partial<Record<FeatureKey, boolean>> = {
  plantQueue: false,
  billingReports: false,
  detentionBilling: false,
  podSignature: false,
  plantCheckIn: false,
  loadTicketFields: false,
  exportCsv: false,
};

const TAXI_LABELS: SolutionLabels = {
  appBrand: "Waukee Talkee",
  map: "Radio map",
  inbox: "Inbox",
  replay: "Map DVR",
  geofences: "Bases",
  floorplan: "Floor plan",
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
  floorplan: "Plant floor plan",
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

const SECURITY_LABELS: SolutionLabels = {
  appBrand: "Guard Watch",
  map: "Live map",
  inbox: "Inbox",
  replay: "Map DVR",
  geofences: "Posts & patrol points",
  floorplan: "Floor plan",
  alerts: "Alerts",
  drivers: "Guards",
  groups: "Groups",
  requestResponse: "Call & confirm",
  bookings: "Patrols",
  contacts: "Contacts",
  onDuty: "on shift",
  offDuty: "off shift",
  assignDriver: "Assign guard",
  newBooking: "New patrol",
  createBooking: "Create patrol",
};

const FIELD_LABELS: SolutionLabels = {
  appBrand: "Field Crew",
  map: "Live map",
  inbox: "Inbox",
  replay: "Map DVR",
  geofences: "Job sites",
  floorplan: "Site plan",
  alerts: "Alerts",
  drivers: "Workers",
  groups: "Groups",
  requestResponse: "Call & confirm",
  bookings: "Jobs",
  contacts: "Contacts",
  onDuty: "working",
  offDuty: "off duty",
  assignDriver: "Assign worker",
  newBooking: "New job",
  createBooking: "Create job",
};

const TRUCK_LABELS: SolutionLabels = {
  appBrand: "Truck Fleet",
  map: "Live map",
  inbox: "Inbox",
  replay: "Map DVR",
  geofences: "Depots & stops",
  floorplan: "Yard plan",
  alerts: "Alerts",
  drivers: "Drivers",
  groups: "Groups",
  requestResponse: "Call & confirm",
  bookings: "Stops",
  contacts: "Contacts",
  onDuty: "on route",
  offDuty: "off route",
  assignDriver: "Assign driver",
  newBooking: "New stop",
  createBooking: "Create stop",
};

const FAMILY_LABELS: SolutionLabels = {
  appBrand: "Family Talk",
  map: "Map",
  inbox: "Messages",
  replay: "History",
  geofences: "Places",
  floorplan: "Home plan",
  alerts: "Alerts",
  drivers: "Family members",
  groups: "Circle",
  requestResponse: "Check-in",
  bookings: "Plans",
  contacts: "Contacts",
  onDuty: "checked in",
  offDuty: "away",
  assignDriver: "Notify member",
  newBooking: "New plan",
  createBooking: "Create plan",
};

const RETAIL_LABELS: SolutionLabels = {
  appBrand: "Retail Team",
  map: "Store map",
  inbox: "Inbox",
  replay: "Map DVR",
  geofences: "Stores & departments",
  floorplan: "Store floor plan",
  alerts: "Alerts",
  drivers: "Staff",
  groups: "Groups",
  requestResponse: "Call & confirm",
  bookings: "Tasks",
  contacts: "Contacts",
  onDuty: "on shift",
  offDuty: "off shift",
  assignDriver: "Assign staff",
  newBooking: "New task",
  createBooking: "Create task",
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
      routes: false,
      guardTours: false,
      familyFeatures: false,
      ...PLANT_BILLING_OFF,
    },
    labels: CONCRETE_LABELS,
  },
  security: {
    id: "security",
    displayName: "Guard Watch",
    features: {
      ...ALL_FEATURES_ON,
      bookings: false,
      contacts: false,
      vehicles: false,
      manifests: false,
      family: false,
      reports: false,
      routes: false,
      guardTours: false,
      familyFeatures: false,
      ...PLANT_BILLING_OFF,
    },
    labels: SECURITY_LABELS,
  },
  field: {
    id: "field",
    displayName: "Field Crew",
    features: {
      ...ALL_FEATURES_ON,
      vehicles: false,
      manifests: false,
      family: false,
      routes: false,
      guardTours: false,
      familyFeatures: false,
      ...PLANT_BILLING_OFF,
    },
    labels: FIELD_LABELS,
  },
  truck: {
    id: "truck",
    displayName: "Truck Fleet",
    features: {
      ...ALL_FEATURES_ON,
      contacts: false,
      family: false,
      guardTours: false,
      familyFeatures: false,
      routes: true,
      ...PLANT_BILLING_OFF,
    },
    labels: TRUCK_LABELS,
  },
  family: {
    id: "family",
    displayName: "Family Talk",
    features: {
      ...ALL_FEATURES_ON,
      map: false,
      replay: false,
      geofences: false,
      floorplan: false,
      routes: false,
      alerts: false,
      requestResponse: false,
      bookings: false,
      contacts: false,
      vehicles: false,
      manifests: false,
      reports: false,
      policeHazards: false,
      guardTours: false,
      familyFeatures: true,
      ...PLANT_BILLING_OFF,
    },
    labels: FAMILY_LABELS,
  },
  retail: {
    id: "retail",
    displayName: "Retail Team",
    features: {
      ...ALL_FEATURES_ON,
      vehicles: false,
      manifests: false,
      family: false,
      routes: false,
      guardTours: false,
      familyFeatures: false,
      ...PLANT_BILLING_OFF,
    },
    labels: RETAIL_LABELS,
  },
};

export type NavRouteKey =
  | "map"
  | "inbox"
  | "replay"
  | "geofences"
  | "floorplan"
  | "alerts"
  | "drivers"
  | "groups"
  | "requests"
  | "bookings"
  | "contacts"
  | "vehicles"
  | "manifests"
  | "family"
  | "reports"
  | "hazards";

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
  {
    key: "floorplan",
    path: "/floorplan",
    feature: "floorplan",
    labelKey: "floorplan",
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
    key: "contacts",
    path: "/contacts",
    feature: "contacts",
    labelKey: "contacts",
  },
  {
    key: "vehicles",
    path: "/vehicles",
    feature: "vehicles",
    labelKey: "drivers",
  },
  {
    key: "manifests",
    path: "/manifests",
    feature: "manifests",
    labelKey: "bookings",
  },
  {
    key: "family",
    path: "/family",
    feature: "family",
    labelKey: "groups",
  },
  {
    key: "reports",
    path: "/reports",
    feature: "reports",
    labelKey: "alerts",
  },
  {
    key: "hazards",
    path: "/hazards",
    feature: "policeHazards",
    labelKey: "alerts",
  },
];

const ORG_SOLUTION_MAP: Record<string, SolutionId> = {
  demo: "taxi",
  rebert: "concrete",
  security: "security",
  field: "field",
  truck: "truck",
  family: "family",
  retail: "retail",
};

export function routeFeature(path: string): FeatureKey | null {
  const route = NAV_ROUTES.find((r) => r.path === path);
  return route?.feature ?? null;
}

export function inferSolutionFromOrgId(orgId: string): SolutionId | undefined {
  return ORG_SOLUTION_MAP[orgId];
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

export function getDefaultRoute(profile: SolutionProfile): string {
  const route = NAV_ROUTES.find((r) => isFeatureEnabled(profile, r.feature));
  return route?.path ?? "/inbox";
}
