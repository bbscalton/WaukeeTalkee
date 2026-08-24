/**
 * Pure helpers + content maps for registration / publicSites (no Admin SDK init).
 */

export const SOLUTIONS = [
  "taxi",
  "concrete",
  "security",
  "field",
  "truck",
  "family",
  "retail",
] as const;

export type SolutionId = (typeof SOLUTIONS)[number];

export const PLANT_BILLING_OFF: Record<string, boolean> = {
  plantQueue: false,
  billingReports: false,
  detentionBilling: false,
  podSignature: false,
  plantCheckIn: false,
  loadTicketFields: false,
  exportCsv: false,
};

export const SOLUTION_FEATURES: Record<string, Record<string, boolean>> = {
  concrete: { ...PLANT_BILLING_OFF, contacts: false, routes: false },
  security: {
    ...PLANT_BILLING_OFF,
    bookings: false,
    contacts: false,
    vehicles: false,
    manifests: false,
    family: false,
    reports: false,
    routes: false,
  },
  field: {
    ...PLANT_BILLING_OFF,
    vehicles: false,
    manifests: false,
    family: false,
    routes: false,
  },
  truck: { ...PLANT_BILLING_OFF, contacts: false, family: false, routes: true },
  family: {
    ...PLANT_BILLING_OFF,
    map: false,
    replay: false,
    geofences: false,
    routes: false,
    alerts: false,
    requestResponse: false,
    bookings: false,
    contacts: false,
    vehicles: false,
    manifests: false,
    reports: false,
    policeHazards: false,
    familyFeatures: true,
  },
  retail: {
    ...PLANT_BILLING_OFF,
    vehicles: false,
    manifests: false,
    family: false,
    routes: false,
  },
};

export const SOLUTION_SITE_CONTENT: Record<
  SolutionId,
  {
    productName: string;
    headline: string;
    promise: string;
    features: string[];
    ctaLabel: string;
    teamNoun: string;
    accentDefault: string;
  }
> = {
  taxi: {
    productName: "Waukee Talkee",
    headline: "Dispatch that feels like a radio.",
    promise: "Pair drivers, speak the job, track the fleet live.",
    features: [
      "Live radio map",
      "Push-to-talk inbox",
      "Bookings & contacts",
      "Call & confirm",
      "Map DVR replay",
      "Fleet alerts",
    ],
    ctaLabel: "Open dispatch",
    teamNoun: "drivers",
    accentDefault: "#f0b429",
  },
  concrete: {
    productName: "Concrete Dispatch",
    headline: "Plant-to-pour coordination without the chaos.",
    promise: "Orders, mixers, and job sites on one radio console.",
    features: [
      "Live mixer map",
      "Pour orders",
      "Plant & job sites",
      "Team radio",
      "Call & confirm",
      "Shift alerts",
    ],
    ctaLabel: "Open plant console",
    teamNoun: "mixers",
    accentDefault: "#f0b429",
  },
  security: {
    productName: "Guard Watch",
    headline: "Security guard dispatch & patrol coordination.",
    promise: "Posts, patrols, and radio check-ins from one console.",
    features: [
      "Live guard map",
      "Posts & patrol points",
      "Push-to-talk radio",
      "Call & confirm",
      "Geofence alerts",
      "Map DVR",
    ],
    ctaLabel: "Open Guard Watch",
    teamNoun: "guards",
    accentDefault: "#4fc3f7",
  },
  field: {
    productName: "Field Crew",
    headline: "Field workers, jobs, and sites — radio-simple.",
    promise: "Assign jobs, ping crews, see who's on site.",
    features: [
      "Live crew map",
      "Job assignments",
      "Job site geofences",
      "Radio dispatch",
      "Contacts directory",
      "Call & confirm",
    ],
    ctaLabel: "Open Field Crew",
    teamNoun: "workers",
    accentDefault: "#4caf50",
  },
  truck: {
    productName: "Truck Fleet",
    headline: "Routes, stops, and radio for the road.",
    promise: "Manifests, depots, and drivers on one dispatch desk.",
    features: [
      "Live fleet map",
      "Multi-stop manifests",
      "Depots & corridors",
      "Vehicles roster",
      "Radio dispatch",
      "Route alerts",
    ],
    ctaLabel: "Open Truck Fleet",
    teamNoun: "trucks",
    accentDefault: "#f0b429",
  },
  family: {
    productName: "Family Talk",
    headline: "Stay close. Check in. Stay safe.",
    promise: "Family radio, circle check-ins, and quiet peace of mind.",
    features: [
      "Family inbox",
      "Circle members",
      "Safe check-in",
      "Emergency broadcast",
      "Simple pairing",
      "No fleet clutter",
    ],
    ctaLabel: "Open Family Talk",
    teamNoun: "members",
    accentDefault: "#e8a87c",
  },
  retail: {
    productName: "Retail Team",
    headline: "Store staff coordination that keeps the floor moving.",
    promise: "Tasks, departments, and radio for every location.",
    features: [
      "Store map",
      "Staff roster",
      "Task board",
      "Department geofences",
      "Push-to-talk",
      "Shift alerts",
    ],
    ctaLabel: "Open Retail Team",
    teamNoun: "staff",
    accentDefault: "#ff7043",
  },
};

export type PublicSitePayload = {
  orgId: string;
  displayName: string;
  companyName: string;
  solution: SolutionId;
  tagline: string;
  brandColor: string;
  city: string;
  region: string;
  teamSize: number;
  initials: string;
  productName: string;
  headline: string;
  promise: string;
  features: string[];
  ctaLabel: string;
  teamNoun: string;
  websiteUrl?: string;
  solutionFields?: Record<string, unknown>;
};

export function isValidHexColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

export function initialsFromName(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "WT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function sanitizeOrgId(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function slugFromCompany(companyName: string): string {
  const base = sanitizeOrgId(companyName);
  return base || `org-${Date.now().toString(36)}`;
}

export function buildPublicSiteDoc(input: {
  orgId: string;
  companyName: string;
  solution: SolutionId;
  tagline?: string;
  brandColor?: string;
  city?: string;
  region?: string;
  teamSize?: number;
  websiteUrl?: string;
  solutionFields?: Record<string, unknown>;
}): PublicSitePayload {
  const content = SOLUTION_SITE_CONTENT[input.solution] || SOLUTION_SITE_CONTENT.taxi;
  const brandColor =
    input.brandColor && isValidHexColor(input.brandColor)
      ? input.brandColor
      : content.accentDefault;
  const tagline = (input.tagline || content.promise).trim().slice(0, 160);
  return {
    orgId: input.orgId,
    displayName: input.companyName,
    companyName: input.companyName,
    solution: input.solution,
    tagline,
    brandColor,
    city: (input.city || "").trim(),
    region: (input.region || "").trim(),
    teamSize: Number(input.teamSize) || 0,
    initials: initialsFromName(input.companyName),
    productName: content.productName,
    headline: content.headline,
    promise: content.promise,
    features: content.features,
    ctaLabel: content.ctaLabel,
    teamNoun: content.teamNoun,
    websiteUrl: input.websiteUrl || "",
    solutionFields: input.solutionFields || {},
  };
}
