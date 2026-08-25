/**
 * Multi-step customer registration with live branded preview.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";

const firebaseConfig = {
  projectId: "waukee-talkee",
  appId: "1:646612669697:web:c52e13f2537b37dea5f700",
  storageBucket: "waukee-talkee.firebasestorage.app",
  apiKey: "AIzaSyDMCwYgXmgeUxES9Fz92FambCsCZi9X1EI",
  authDomain: "waukee-talkee.firebaseapp.com",
  messagingSenderId: "646612669697",
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app, "us-central1");
const submitRegistration = httpsCallable(functions, "submitRegistration");

const SOLUTIONS = [
  {
    id: "security",
    name: "Security",
    icon: "◎",
    promise: "Guards, posts, and patrol radio.",
    accent: "#4fc3f7",
    glow: "rgba(79, 195, 247, 0.25)",
    teamLabel: "Number of guards",
    nameLabel: "Company name",
    headline: "Security guard dispatch & patrol coordination.",
    features: ["Live guard map", "Posts & patrol points", "Push-to-talk", "Call & confirm", "Geofence alerts", "Map DVR"],
    cta: "Open Guard Watch",
    teamNoun: "guards",
    fields: [
      { key: "posts", label: "Number of posts / sites", type: "number", min: 1, placeholder: "8" },
      { key: "guards", label: "Number of guards", type: "number", min: 1, placeholder: "24" },
      { key: "patrolNeeds", label: "Patrol needs", type: "text", placeholder: "Night foot patrols, gate checks…" },
    ],
  },
  {
    id: "field",
    name: "Field",
    icon: "▴",
    promise: "Workers, jobs, and sites.",
    accent: "#4caf50",
    glow: "rgba(76, 175, 80, 0.25)",
    teamLabel: "Number of workers",
    nameLabel: "Company name",
    headline: "Field workers, jobs, and sites — radio-simple.",
    features: ["Live crew map", "Job assignments", "Job site geofences", "Radio dispatch", "Contacts", "Call & confirm"],
    cta: "Open Field Crew",
    teamNoun: "workers",
    fields: [
      { key: "industry", label: "Industry", type: "text", placeholder: "Utilities, landscaping, HVAC…" },
      { key: "workers", label: "Number of workers", type: "number", min: 1, placeholder: "30" },
      { key: "jobTypes", label: "Job types", type: "text", placeholder: "Installs, service calls, inspections…" },
    ],
  },
  {
    id: "truck",
    name: "Truck",
    icon: "▣",
    promise: "Fleet routes and manifests.",
    accent: "#f0b429",
    glow: "rgba(240, 180, 41, 0.25)",
    teamLabel: "Number of trucks",
    nameLabel: "Company name",
    headline: "Routes, stops, and radio for the road.",
    features: ["Live fleet map", "Multi-stop manifests", "Depots & corridors", "Vehicles", "Radio", "Route alerts"],
    cta: "Open Truck Fleet",
    teamNoun: "trucks",
    fields: [
      { key: "trucks", label: "Number of trucks", type: "number", min: 1, placeholder: "18" },
      { key: "deliveryRadius", label: "Delivery radius", type: "text", placeholder: "120 miles" },
      { key: "fleetType", label: "Fleet type", type: "text", placeholder: "Dry van, flatbed, LTL…" },
    ],
  },
  {
    id: "family",
    name: "Family",
    icon: "◇",
    promise: "Check-ins and stay safe.",
    accent: "#e8a87c",
    glow: "rgba(232, 168, 124, 0.28)",
    teamLabel: "Family size",
    nameLabel: "Family name",
    headline: "Stay close. Check in. Stay safe.",
    features: ["Family inbox", "Circle members", "Safe check-in", "Emergency broadcast", "Simple pairing", "No fleet clutter"],
    cta: "Open Family Talk",
    teamNoun: "members",
    fields: [
      { key: "familySize", label: "Family size", type: "number", min: 2, placeholder: "5" },
      {
        key: "primaryUse",
        label: "Primary use",
        type: "select",
        options: [
          { value: "safety", label: "Safety & location" },
          { value: "checkin", label: "Daily check-in" },
          { value: "both", label: "Both" },
        ],
      },
    ],
  },
  {
    id: "retail",
    name: "Retail",
    icon: "▢",
    promise: "Stores, staff, and tasks.",
    accent: "#ff7043",
    glow: "rgba(255, 112, 67, 0.25)",
    teamLabel: "Number of staff",
    nameLabel: "Company name",
    headline: "Store staff coordination that keeps the floor moving.",
    features: ["Store map", "Staff roster", "Task board", "Department geofences", "Push-to-talk", "Shift alerts"],
    cta: "Open Retail Team",
    teamNoun: "staff",
    fields: [
      {
        key: "storeType",
        label: "Store type",
        type: "select",
        options: [
          { value: "hardware", label: "Hardware" },
          { value: "supermarket", label: "Supermarket" },
          { value: "other", label: "Other" },
        ],
      },
      { key: "locations", label: "Number of locations", type: "number", min: 1, placeholder: "3" },
      { key: "staff", label: "Number of staff", type: "number", min: 1, placeholder: "40" },
    ],
  },
  {
    id: "concrete",
    name: "Concrete",
    icon: "⬡",
    promise: "Plant-to-pour dispatch.",
    accent: "#c4a574",
    glow: "rgba(196, 165, 116, 0.28)",
    teamLabel: "Number of mixers",
    nameLabel: "Plant / company name",
    headline: "Plant-to-pour coordination without the chaos.",
    features: ["Live mixer map", "Pour orders", "Plant & job sites", "Team radio", "Call & confirm", "Shift alerts"],
    cta: "Open plant console",
    teamNoun: "mixers",
    fields: [
      { key: "plantName", label: "Plant name", type: "text", placeholder: "North Plant" },
      { key: "mixers", label: "Number of mixers", type: "number", min: 1, placeholder: "10" },
      { key: "pourFocus", label: "Pour focus", type: "text", placeholder: "Residential slabs, commercial…" },
    ],
  },
  {
    id: "taxi",
    name: "Taxi / Fleet",
    icon: "◈",
    promise: "Radio dispatch for drivers.",
    accent: "#f0b429",
    glow: "rgba(240, 180, 41, 0.28)",
    teamLabel: "Number of drivers",
    nameLabel: "Company name",
    headline: "Dispatch that feels like a radio.",
    features: ["Live radio map", "Push-to-talk inbox", "Bookings & contacts", "Call & confirm", "Map DVR", "Fleet alerts"],
    cta: "Open dispatch",
    teamNoun: "drivers",
    fields: [
      { key: "drivers", label: "Number of drivers", type: "number", min: 1, placeholder: "25" },
      { key: "serviceCity", label: "Primary city", type: "text", placeholder: "Waukee" },
    ],
  },
];

const SWATCHES = ["#f0b429", "#4fc3f7", "#4caf50", "#ff7043", "#e8a87c", "#c4a574", "#90a4ae", "#ef5350"];

const state = {
  step: 0,
  solution: null,
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  city: "",
  region: "",
  teamSize: 12,
  websiteUrl: "",
  brandColor: "#f0b429",
  tagline: "",
  orgSlug: "",
  solutionFields: {},
  submitting: false,
};

const el = {
  flow: document.getElementById("flow"),
  startBtn: document.getElementById("start-btn"),
  solGrid: document.getElementById("sol-grid"),
  solutionFields: document.getElementById("solution-fields"),
  progressFill: document.getElementById("progress-fill"),
  backBtn: document.getElementById("back-btn"),
  nextBtn: document.getElementById("next-btn"),
  regNav: document.getElementById("reg-nav"),
  nameLabel: document.getElementById("name-label"),
  teamLabel: document.getElementById("team-label"),
  step2Sub: document.getElementById("step2-sub"),
  review: document.getElementById("review-summary"),
  submitError: document.getElementById("submit-error"),
  confirmRef: document.getElementById("confirm-ref"),
  confirmOrg: document.getElementById("confirm-org"),
  brandColor: document.getElementById("brandColor"),
  brandColorPicker: document.getElementById("brandColorPicker"),
  tagline: document.getElementById("tagline"),
  orgSlug: document.getElementById("orgSlug"),
  swatches: document.getElementById("swatches"),
  previewUrl: document.getElementById("preview-url"),
  pvMark: document.getElementById("pv-mark"),
  pvBrand: document.getElementById("pv-brand"),
  pvHeadline: document.getElementById("pv-headline"),
  pvTag: document.getElementById("pv-tag"),
  pvCta: document.getElementById("pv-cta"),
  pvFeatures: document.getElementById("pv-features"),
  pvMeta: document.getElementById("pv-meta"),
  previewFrame: document.getElementById("preview-frame"),
};

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "WT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function currentSolution() {
  return SOLUTIONS.find((s) => s.id === state.solution) || null;
}

function renderSolGrid() {
  el.solGrid.innerHTML = SOLUTIONS.map(
    (s) => `
    <button type="button" class="sol-tile ${state.solution === s.id ? "is-selected" : ""}"
      role="option" aria-selected="${state.solution === s.id}"
      data-sol="${s.id}"
      style="--sol-accent:${s.accent};--sol-glow:${s.glow}">
      <div class="sol-icon" aria-hidden="true">${s.icon}</div>
      <h3>${s.name}</h3>
      <p>${s.promise}</p>
    </button>`
  ).join("");

  el.solGrid.querySelectorAll(".sol-tile").forEach((btn) => {
    btn.addEventListener("click", () => selectSolution(btn.dataset.sol));
  });
}

function renderSolutionFields() {
  const sol = currentSolution();
  if (!sol) {
    el.solutionFields.innerHTML = "";
    return;
  }
  el.solutionFields.innerHTML =
    `<h3 class="reg-sol-head">${sol.name} specifics</h3>` +
    sol.fields
      .map((f) => {
        const val = state.solutionFields[f.key] ?? "";
        if (f.type === "select") {
          const opts = (f.options || [])
            .map(
              (o) =>
                `<option value="${o.value}" ${val === o.value ? "selected" : ""}>${o.label}</option>`
            )
            .join("");
          return `<label class="reg-field"><span>${f.label}</span>
            <select data-sf="${f.key}"><option value="">Select…</option>${opts}</select></label>`;
        }
        return `<label class="reg-field"><span>${f.label}</span>
          <input type="${f.type}" data-sf="${f.key}" min="${f.min || 1}"
            placeholder="${f.placeholder || ""}" value="${val}" /></label>`;
      })
      .join("");

  el.solutionFields.querySelectorAll("[data-sf]").forEach((input) => {
    input.addEventListener("input", () => {
      state.solutionFields[input.dataset.sf] = input.value;
      syncTeamSizeFromSolution();
      updatePreview();
    });
  });
}

function syncTeamSizeFromSolution() {
  const sol = currentSolution();
  if (!sol) return;
  const map = {
    security: "guards",
    field: "workers",
    truck: "trucks",
    family: "familySize",
    retail: "staff",
    concrete: "mixers",
    taxi: "drivers",
  };
  const key = map[sol.id];
  if (key && state.solutionFields[key]) {
    const n = Number(state.solutionFields[key]);
    if (n > 0) {
      state.teamSize = n;
      const teamInput = document.getElementById("teamSize");
      if (teamInput) teamInput.value = String(n);
    }
  }
}

function updateSwatches() {
  el.swatches.innerHTML = SWATCHES.map(
    (c) =>
      `<button type="button" class="reg-swatch ${state.brandColor.toLowerCase() === c.toLowerCase() ? "is-active" : ""}"
        style="background:${c}" data-color="${c}" aria-label="Color ${c}"></button>`
  ).join("");
  el.swatches.querySelectorAll(".reg-swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.brandColor = btn.dataset.color;
      el.brandColor.value = state.brandColor;
      el.brandColorPicker.value = state.brandColor;
      updateSwatches();
      updatePreview();
    });
  });
}

function updatePreview() {
  const sol = currentSolution();
  const name = state.companyName.trim() || (sol ? `Your ${sol.name.toLowerCase()} team` : "Your company");
  const accent = state.brandColor || sol?.accent || "#f0b429";
  const slug = state.orgSlug || slugify(state.companyName) || "your-team";

  el.previewFrame.style.setProperty("--pv-accent", accent);
  el.pvMark.textContent = initials(name);
  el.pvMark.style.background = accent;
  el.pvBrand.textContent = name;
  el.pvHeadline.textContent = sol?.headline || "Your headline goes here.";
  el.pvTag.textContent = state.tagline.trim() || sol?.promise || "Your tagline will appear live as you type.";
  el.pvCta.textContent = sol?.cta || "Open dispatch";
  el.pvCta.style.background = accent;
  el.previewUrl.textContent = `sites/?org=${slug}`;

  const features = sol?.features || ["Live map", "Radio dispatch", "Team roster", "Alerts"];
  el.pvFeatures.innerHTML = features.map((f) => `<li>${f}</li>`).join("");

  const city = state.city.trim() || "Your city";
  const size = state.teamSize || 0;
  const noun = sol?.teamNoun || "people";
  el.pvMeta.textContent = `${city}${state.region ? ", " + state.region : ""} · ${size} ${noun}`;
}

function readDetailsForm() {
  state.companyName = document.getElementById("companyName")?.value || "";
  state.contactName = document.getElementById("contactName")?.value || "";
  state.email = document.getElementById("email")?.value || "";
  state.phone = document.getElementById("phone")?.value || "";
  state.city = document.getElementById("city")?.value || "";
  state.region = document.getElementById("region")?.value || "";
  state.teamSize = Number(document.getElementById("teamSize")?.value) || 1;
  state.websiteUrl = document.getElementById("websiteUrl")?.value || "";
}

function bindLiveFields() {
  ["companyName", "contactName", "email", "phone", "city", "region", "teamSize", "websiteUrl"].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener("input", () => {
      readDetailsForm();
      if (id === "companyName" && !el.orgSlug.dataset.touched) {
        el.orgSlug.value = slugify(state.companyName);
        state.orgSlug = el.orgSlug.value;
      }
      updatePreview();
    });
  });

  el.brandColor.addEventListener("input", () => {
    const v = el.brandColor.value.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
      state.brandColor = v;
      el.brandColorPicker.value = v;
      updateSwatches();
      updatePreview();
    }
  });
  el.brandColorPicker.addEventListener("input", () => {
    state.brandColor = el.brandColorPicker.value;
    el.brandColor.value = state.brandColor;
    updateSwatches();
    updatePreview();
  });
  el.tagline.addEventListener("input", () => {
    state.tagline = el.tagline.value;
    updatePreview();
  });
  el.orgSlug.addEventListener("input", () => {
    el.orgSlug.dataset.touched = "1";
    state.orgSlug = slugify(el.orgSlug.value);
    el.orgSlug.value = state.orgSlug;
    updatePreview();
  });
}

function setStep(step) {
  state.step = step;
  if (step >= 1) {
    el.flow.hidden = false;
    document.querySelector(".reg-hero")?.setAttribute("hidden", "");
  }

  document.querySelectorAll("[data-step-panel]").forEach((panel) => {
    const n = Number(panel.dataset.stepPanel);
    panel.classList.toggle("is-active", n === step);
    if (n === 0) return;
    panel.style.display = n === step ? "block" : "none";
  });

  // hero is step 0 outside flow
  if (step === 0) {
    document.querySelector(".reg-hero")?.removeAttribute("hidden");
    el.flow.hidden = true;
  }

  const progressStep = Math.min(step, 4);
  el.progressFill.style.width = `${(progressStep / 4) * 100}%`;
  document.querySelectorAll("[data-step-label]").forEach((li) => {
    const n = Number(li.dataset.stepLabel);
    li.classList.toggle("is-active", n === progressStep);
    li.classList.toggle("is-done", n < progressStep);
  });

  el.regNav.hidden = step === 0 || step === 5;
  el.backBtn.hidden = step <= 1;
  el.nextBtn.textContent = step === 4 ? (state.submitting ? "Submitting…" : "Submit registration") : "Continue";
  el.nextBtn.disabled = state.submitting;

  if (step === 4) renderReview();
  updatePreview();

  if (step >= 1) {
    el.flow.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderReview() {
  readDetailsForm();
  state.brandColor = el.brandColor.value;
  state.tagline = el.tagline.value;
  state.orgSlug = el.orgSlug.value;
  const sol = currentSolution();
  const rows = [
    ["Solution", sol?.name || "—"],
    ["Company / family", state.companyName || "—"],
    ["Contact", state.contactName || "—"],
    ["Email", state.email || "—"],
    ["Phone", state.phone || "—"],
    ["Location", [state.city, state.region].filter(Boolean).join(", ") || "—"],
    ["Team size", String(state.teamSize)],
    ["Brand color", state.brandColor],
    ["Tagline", state.tagline || sol?.promise || "—"],
    ["Org ID", state.orgSlug || slugify(state.companyName) || "(auto)"],
  ];
  Object.entries(state.solutionFields).forEach(([k, v]) => {
    if (v) rows.push([k, String(v)]);
  });
  el.review.innerHTML = rows
    .map(
      ([k, v]) =>
        `<div class="reg-review-row"><span>${k}</span><strong>${escapeHtml(v)}</strong></div>`
    )
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function validateStep(step) {
  el.submitError.hidden = true;
  if (step === 1 && !state.solution) {
    alert("Pick a solution vertical to continue.");
    return false;
  }
  if (step === 2) {
    readDetailsForm();
    const form = document.getElementById("details-form");
    if (!form.checkValidity()) {
      form.reportValidity();
      return false;
    }
  }
  if (step === 3) {
    const color = el.brandColor.value.trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      alert("Enter a valid hex color like #f0b429.");
      return false;
    }
    state.brandColor = color;
    state.tagline = el.tagline.value.trim();
    state.orgSlug = slugify(el.orgSlug.value);
  }
  return true;
}

async function submit() {
  readDetailsForm();
  state.brandColor = el.brandColor.value.trim();
  state.tagline = el.tagline.value.trim();
  state.orgSlug = slugify(el.orgSlug.value);
  state.submitting = true;
  setStep(4);
  el.submitError.hidden = true;

  try {
    const payload = {
      solution: state.solution,
      companyName: state.companyName.trim(),
      contactName: state.contactName.trim(),
      email: state.email.trim(),
      phone: state.phone.trim(),
      city: state.city.trim(),
      region: state.region.trim(),
      teamSize: state.teamSize,
      brandColor: state.brandColor,
      tagline: state.tagline || currentSolution()?.promise || "",
      websiteUrl: state.websiteUrl.trim(),
      orgId: state.orgSlug || slugify(state.companyName),
      solutionFields: state.solutionFields,
    };
    const result = await submitRegistration(payload);
    const data = result.data || {};
    el.confirmRef.textContent = data.registrationId || "submitted";
    el.confirmOrg.textContent = data.orgId
      ? `Requested org: ${data.orgId} · status: pending`
      : "Status: pending review";
    state.submitting = false;
    setStep(5);
  } catch (err) {
    console.error(err);
    state.submitting = false;
    setStep(4);
    el.submitError.hidden = false;
    el.submitError.textContent =
      err?.message || err?.code || "Submission failed. Please try again.";
  }
}

el.startBtn.addEventListener("click", () => setStep(1));
el.backBtn.addEventListener("click", () => setStep(Math.max(1, state.step - 1)));
el.nextBtn.addEventListener("click", async () => {
  if (!validateStep(state.step)) return;
  if (state.step === 4) {
    await submit();
    return;
  }
  setStep(state.step + 1);
});

renderSolGrid();
updateSwatches();
bindLiveFields();
updatePreview();

// Persist YouTube / Ads UTMs across get-started → register (Google Ads reporting)
(function captureUtm() {
  const keys = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "gclid",
    "gbraid",
    "wbraid",
  ];
  const params = new URLSearchParams(location.search);
  let stored = {};
  try {
    stored = JSON.parse(sessionStorage.getItem("wt_utm") || "{}") || {};
  } catch {
    stored = {};
  }
  const merged = { ...stored };
  keys.forEach((k) => {
    if (params.has(k)) merged[k] = params.get(k);
  });
  try {
    sessionStorage.setItem("wt_utm", JSON.stringify(merged));
  } catch {
    /* ignore quota */
  }
})();

function selectSolution(solId) {
  const sol = SOLUTIONS.find((s) => s.id === solId);
  if (!sol) return;
  state.solution = sol.id;
  state.brandColor = sol.accent;
  el.brandColor.value = sol.accent;
  el.brandColorPicker.value = sol.accent;
  if (!state.tagline) {
    state.tagline = sol.promise;
    el.tagline.value = sol.promise;
  }
  el.nameLabel.textContent = sol.nameLabel;
  el.teamLabel.textContent = sol.teamLabel;
  el.step2Sub.textContent = `Configuring ${sol.name} — fields adapt to your vertical.`;
  renderSolGrid();
  renderSolutionFields();
  updatePreview();
  updateSwatches();
}

// Deep-link: /register/#flow, #picker, ?start=1, or ?sol= → open world picker
const bootParams = new URLSearchParams(location.search);
const bootSol = (bootParams.get("sol") || "").trim().toLowerCase();
if (
  location.hash === "#flow" ||
  location.hash === "#picker" ||
  bootParams.has("start") ||
  bootSol
) {
  setStep(1);
}
if (bootSol) selectSolution(bootSol);
