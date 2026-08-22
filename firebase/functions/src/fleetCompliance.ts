import { initializeApp, getApps } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
  type DocumentData,
} from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { distToPathM, haversineM, routePath, type LatLng } from "./geo";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

/** Must stay inside this long before "arrived" fires (anti-spam). */
const ARRIVE_MIN_DWELL_MS = 20_000;
/** Extra meters outside radius before counting as left. */
const EXIT_BUFFER_M = 30;
const OFF_ROUTE_THROTTLE_MS = 3 * 60 * 1000;
const SPEED_ALERT_THROTTLE_MS = 2 * 60 * 1000;
/** Periodic dwell refresh while still inside after arrived. */
const DWELL_UPDATE_MS = 60_000;

type PlacePresence = {
  inside: boolean;
  enteredAtMs: number | null;
  arrivedAtMs: number | null;
  lastDwellEventAtMs: number | null;
};

type FleetState = {
  places: Record<string, PlacePresence>;
  lastOffRouteAtMs: number | null;
  lastOffRouteId: string | null;
  lastSpeedAlertAtMs: number | null;
};

function emptyState(): FleetState {
  return {
    places: {},
    lastOffRouteAtMs: null,
    lastOffRouteId: null,
    lastSpeedAlertAtMs: null,
  };
}

function parseState(data: DocumentData | undefined): FleetState {
  if (!data) return emptyState();
  const places: Record<string, PlacePresence> = {};
  const raw = (data.places || {}) as Record<string, DocumentData>;
  for (const [id, v] of Object.entries(raw)) {
    places[id] = {
      inside: Boolean(v.inside),
      enteredAtMs: typeof v.enteredAtMs === "number" ? v.enteredAtMs : null,
      arrivedAtMs: typeof v.arrivedAtMs === "number" ? v.arrivedAtMs : null,
      lastDwellEventAtMs:
        typeof v.lastDwellEventAtMs === "number" ? v.lastDwellEventAtMs : null,
    };
  }
  return {
    places,
    lastOffRouteAtMs:
      typeof data.lastOffRouteAtMs === "number" ? data.lastOffRouteAtMs : null,
    lastOffRouteId:
      typeof data.lastOffRouteId === "string" ? data.lastOffRouteId : null,
    lastSpeedAlertAtMs:
      typeof data.lastSpeedAlertAtMs === "number"
        ? data.lastSpeedAlertAtMs
        : null,
  };
}

async function emitEvent(
  orgId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await db.collection(`orgs/${orgId}/fleetEvents`).add({
    ...payload,
    at: FieldValue.serverTimestamp(),
  });
}

function formatDwell(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * Server-side geofence / route / speed compliance from live driver telemetry.
 * Triggered on every driver doc write; only acts when position/speed meaningfully change.
 */
export const onDriverTelemetryWritten = onDocumentWritten(
  {
    document: "orgs/{orgId}/drivers/{driverId}",
    memory: "256MiB",
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const before = event.data?.before;
    const orgId = String(event.params.orgId);
    const driverId = String(event.params.driverId);
    const data = after.data()!;
    const prev = before?.exists ? before.data()! : null;

    const lat = data.lastLat;
    const lng = data.lastLng;
    if (typeof lat !== "number" || typeof lng !== "number") return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const pos: LatLng = { lat, lng };
    const speedMps =
      typeof data.lastSpeed === "number" && Number.isFinite(data.lastSpeed)
        ? data.lastSpeed
        : null;
    const onDuty = Boolean(data.onDuty);
    const driverName = String(data.displayName || "Driver");
    const speedLimitKmh =
      typeof data.speedLimitKmh === "number" && data.speedLimitKmh > 0
        ? data.speedLimitKmh
        : null;

    const locChanged =
      !prev ||
      prev.lastLat !== lat ||
      prev.lastLng !== lng ||
      prev.lastSpeed !== data.lastSpeed ||
      Boolean(prev.onDuty) !== onDuty;

    if (!locChanged) return;

    const stateRef = db.doc(`orgs/${orgId}/fleetState/${driverId}`);
    const stateSnap = await stateRef.get();
    const state = parseState(stateSnap.data());
    const now = Date.now();
    let dirty = false;

    // --- Places: arrive / dwell / leave ---
    const placesSnap = await db.collection(`orgs/${orgId}/places`).get();
    const livePlaceIds = new Set<string>();

    for (const placeDoc of placesSnap.docs) {
      livePlaceIds.add(placeDoc.id);
      const p = placeDoc.data();
      const placeLat = p.lat;
      const placeLng = p.lng;
      const radiusM = Number(p.radiusM);
      if (
        typeof placeLat !== "number" ||
        typeof placeLng !== "number" ||
        !Number.isFinite(radiusM) ||
        radiusM <= 0
      ) {
        continue;
      }

      const placeName = String(p.name || "Place");
      const placeType = p.type === "home_base" ? "home_base" : "checkpoint";
      const dist = haversineM(pos, { lat: placeLat, lng: placeLng });
      const prevPresence = state.places[placeDoc.id] || {
        inside: false,
        enteredAtMs: null,
        arrivedAtMs: null,
        lastDwellEventAtMs: null,
      };

      const inCore = dist <= radiusM;
      const outBuffered = dist > radiusM + EXIT_BUFFER_M;

      let next: PlacePresence = { ...prevPresence };

      if (!prevPresence.inside) {
        if (inCore && onDuty) {
          next = {
            inside: true,
            enteredAtMs: now,
            arrivedAtMs: null,
            lastDwellEventAtMs: null,
          };
          dirty = true;
        }
      } else {
        // Currently tracked as inside
        if (outBuffered || !onDuty) {
          if (prevPresence.arrivedAtMs != null && prevPresence.enteredAtMs != null) {
            const dwellMs = Math.max(0, now - prevPresence.arrivedAtMs);
            await emitEvent(orgId, {
              type: "place_left",
              driverId,
              driverName,
              placeId: placeDoc.id,
              placeName,
              placeType,
              dwellMs,
              meta: {
                message: `${driverName} left ${placeName} after ${formatDwell(dwellMs)}`,
                lat,
                lng,
              },
            });
          }
          next = {
            inside: false,
            enteredAtMs: null,
            arrivedAtMs: null,
            lastDwellEventAtMs: null,
          };
          dirty = true;
        } else if (inCore || !outBuffered) {
          // Still inside (hysteresis: between radius and buffer stays inside)
          if (
            prevPresence.arrivedAtMs == null &&
            prevPresence.enteredAtMs != null &&
            now - prevPresence.enteredAtMs >= ARRIVE_MIN_DWELL_MS
          ) {
            next.arrivedAtMs = now;
            next.lastDwellEventAtMs = now;
            dirty = true;
            await emitEvent(orgId, {
              type: "place_arrived",
              driverId,
              driverName,
              placeId: placeDoc.id,
              placeName,
              placeType,
              dwellMs: now - prevPresence.enteredAtMs,
              meta: {
                message: `${driverName} arrived at ${placeName}`,
                lat,
                lng,
              },
            });
          } else if (
            prevPresence.arrivedAtMs != null &&
            (prevPresence.lastDwellEventAtMs == null ||
              now - prevPresence.lastDwellEventAtMs >= DWELL_UPDATE_MS)
          ) {
            const dwellMs = Math.max(0, now - prevPresence.arrivedAtMs);
            next.lastDwellEventAtMs = now;
            dirty = true;
            await emitEvent(orgId, {
              type: "place_dwell",
              driverId,
              driverName,
              placeId: placeDoc.id,
              placeName,
              placeType,
              dwellMs,
              meta: {
                message: `${driverName} still at ${placeName} (${formatDwell(dwellMs)})`,
                lat,
                lng,
              },
            });
          }
        }
      }

      if (
        next.inside !== prevPresence.inside ||
        next.enteredAtMs !== prevPresence.enteredAtMs ||
        next.arrivedAtMs !== prevPresence.arrivedAtMs ||
        next.lastDwellEventAtMs !== prevPresence.lastDwellEventAtMs
      ) {
        state.places[placeDoc.id] = next;
        dirty = true;
      }
    }

    // Drop state for deleted places
    for (const id of Object.keys(state.places)) {
      if (!livePlaceIds.has(id)) {
        delete state.places[id];
        dirty = true;
      }
    }

    // --- Off-route (monitored corridors) ---
    if (onDuty) {
      const routesSnap = await db
        .collection(`orgs/${orgId}/routes`)
        .where("monitor", "==", true)
        .get();

      let farthest: {
        id: string;
        name: string;
        distM: number;
        widthM: number;
      } | null = null;

      for (const routeDoc of routesSnap.docs) {
        const r = routeDoc.data();
        const assigned =
          r.driverId == null ||
          r.driverId === "" ||
          r.driverId === driverId;
        if (!assigned) continue;

        const path = routePath({
          polyline: typeof r.polyline === "string" ? r.polyline : null,
          path: Array.isArray(r.path) ? (r.path as LatLng[]) : null,
        });
        if (path.length < 2) continue;

        const widthM =
          typeof r.corridorWidthM === "number" && r.corridorWidthM > 0
            ? r.corridorWidthM
            : 80;
        const d = distToPathM(pos, path);
        if (d > widthM) {
          if (!farthest || d - widthM > farthest.distM - farthest.widthM) {
            farthest = {
              id: routeDoc.id,
              name: String(r.name || "Route"),
              distM: d,
              widthM,
            };
          }
        }
      }

      if (farthest) {
        const throttleOk =
          state.lastOffRouteAtMs == null ||
          now - state.lastOffRouteAtMs >= OFF_ROUTE_THROTTLE_MS ||
          state.lastOffRouteId !== farthest.id;
        if (throttleOk) {
          state.lastOffRouteAtMs = now;
          state.lastOffRouteId = farthest.id;
          dirty = true;
          await emitEvent(orgId, {
            type: "off_route",
            driverId,
            driverName,
            placeId: null,
            placeName: farthest.name,
            placeType: null,
            dwellMs: null,
            meta: {
              message: `${driverName} off route: ${farthest.name} (${Math.round(farthest.distM)}m from corridor)`,
              routeId: farthest.id,
              distM: Math.round(farthest.distM),
              corridorWidthM: farthest.widthM,
              lat,
              lng,
            },
          });
        }
      } else if (state.lastOffRouteId != null) {
        state.lastOffRouteId = null;
        dirty = true;
      }
    }

    // --- Speed limit ---
    if (onDuty && speedLimitKmh != null && speedMps != null) {
      const kmh = speedMps * 3.6;
      if (kmh > speedLimitKmh + 2) {
        const throttleOk =
          state.lastSpeedAlertAtMs == null ||
          now - state.lastSpeedAlertAtMs >= SPEED_ALERT_THROTTLE_MS;
        if (throttleOk) {
          state.lastSpeedAlertAtMs = now;
          dirty = true;
          await emitEvent(orgId, {
            type: "speed_alert",
            driverId,
            driverName,
            placeId: null,
            placeName: null,
            placeType: null,
            dwellMs: null,
            meta: {
              message: `${driverName} speeding: ${kmh.toFixed(0)} km/h (limit ${speedLimitKmh})`,
              speedKmh: Math.round(kmh),
              speedLimitKmh,
              lat,
              lng,
            },
          });
        }
      }
    }

    // Also check route-level speed limits for monitored routes assigned to driver
    if (onDuty && speedMps != null && speedLimitKmh == null) {
      const routesSnap = await db
        .collection(`orgs/${orgId}/routes`)
        .where("monitor", "==", true)
        .get();
      let routeLimit: number | null = null;
      let routeName: string | null = null;
      for (const routeDoc of routesSnap.docs) {
        const r = routeDoc.data();
        const assigned =
          r.driverId == null ||
          r.driverId === "" ||
          r.driverId === driverId;
        if (!assigned) continue;
        if (typeof r.speedLimitKmh === "number" && r.speedLimitKmh > 0) {
          routeLimit = r.speedLimitKmh;
          routeName = String(r.name || "Route");
          break;
        }
      }
      if (routeLimit != null) {
        const kmh = speedMps * 3.6;
        if (kmh > routeLimit + 2) {
          const throttleOk =
            state.lastSpeedAlertAtMs == null ||
            now - state.lastSpeedAlertAtMs >= SPEED_ALERT_THROTTLE_MS;
          if (throttleOk) {
            state.lastSpeedAlertAtMs = now;
            dirty = true;
            await emitEvent(orgId, {
              type: "speed_alert",
              driverId,
              driverName,
              placeId: null,
              placeName: routeName,
              placeType: null,
              dwellMs: null,
              meta: {
                message: `${driverName} speeding on ${routeName}: ${kmh.toFixed(0)} km/h (limit ${routeLimit})`,
                speedKmh: Math.round(kmh),
                speedLimitKmh: routeLimit,
                lat,
                lng,
              },
            });
          }
        }
      }
    }

    if (dirty) {
      await stateRef.set(
        {
          places: state.places,
          lastOffRouteAtMs: state.lastOffRouteAtMs,
          lastOffRouteId: state.lastOffRouteId,
          lastSpeedAlertAtMs: state.lastSpeedAlertAtMs,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }
);
