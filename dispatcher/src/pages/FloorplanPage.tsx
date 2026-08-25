import { type FormEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { db, ORG_ID, storage } from "../firebase";
import type { Driver } from "../types";
import { useSolutionProfile } from "../useSolutionProfile";

type FloorPlan = {
  id: string;
  name: string;
  imageUrl: string;
  storagePath: string;
  createdAt: Timestamp | null;
};

type FloorPin = {
  id: string;
  name: string;
  x: number;
  y: number;
  assignedDriverId: string | null;
};

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

export function FloorplanPage() {
  const { label } = useSolutionProfile();
  const boardRef = useRef<HTMLDivElement | null>(null);

  const [floors, setFloors] = useState<FloorPlan[]>([]);
  const [pins, setPins] = useState<FloorPin[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState<string>("");
  const [floorName, setFloorName] = useState("");
  const [floorImageUrl, setFloorImageUrl] = useState("");
  const [pinName, setPinName] = useState("");
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const selectedFloor = useMemo(
    () => floors.find((f) => f.id === selectedFloorId) || null,
    [floors, selectedFloorId]
  );

  const driverById = useMemo(() => {
    const map = new Map<string, Driver>();
    drivers.forEach((d) => map.set(d.id, d));
    return map;
  }, [drivers]);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, "orgs", ORG_ID, "floorplans"), orderBy("name", "asc")),
      (snap) => {
        const next = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: String(data.name || "Floor"),
            imageUrl: String(data.imageUrl || ""),
            storagePath: String(data.storagePath || ""),
            createdAt: (data.createdAt as Timestamp | null) ?? null,
          } satisfies FloorPlan;
        });
        setFloors(next);
        setSelectedFloorId((prev) => {
          if (prev && next.some((f) => f.id === prev)) return prev;
          return next[0]?.id || "";
        });
      },
      (err) => setError(err.message)
    );
  }, []);

  useEffect(() => {
    if (!selectedFloorId) {
      setPins([]);
      return;
    }
    return onSnapshot(
      query(
        collection(db, "orgs", ORG_ID, "floorplans", selectedFloorId, "pins"),
        orderBy("name", "asc")
      ),
      (snap) => {
        setPins(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              name: String(data.name || "Post"),
              x: clamp01(Number(data.x) || 0),
              y: clamp01(Number(data.y) || 0),
              assignedDriverId:
                typeof data.assignedDriverId === "string" && data.assignedDriverId
                  ? data.assignedDriverId
                  : null,
            };
          })
        );
      },
      (err) => setError(err.message)
    );
  }, [selectedFloorId]);

  useEffect(() => {
    return onSnapshot(collection(db, "orgs", ORG_ID, "drivers"), (snap) => {
      setDrivers(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            displayName: String(data.displayName || "Team member"),
            plate: data.plate ?? null,
            pairStatus: data.pairStatus === "paired" ? "paired" : "unpaired",
            deviceId: data.deviceId ?? null,
            onDuty: Boolean(data.onDuty),
            lastLat: typeof data.lastLat === "number" ? data.lastLat : null,
            lastLng: typeof data.lastLng === "number" ? data.lastLng : null,
            lastSpeed: typeof data.lastSpeed === "number" ? data.lastSpeed : null,
            lastHeading:
              typeof data.lastHeading === "number" ? data.lastHeading : null,
            lastTelemetryAt: data.lastTelemetryAt ?? null,
            speedLimitKmh:
              typeof data.speedLimitKmh === "number" ? data.speedLimitKmh : null,
            vehicleId: data.vehicleId ?? null,
          };
        })
      );
    });
  }, []);

  async function createFloor(e: FormEvent, file: File | null) {
    e.preventDefault();
    if (!floorName.trim()) return;
    const pastedUrl = floorImageUrl.trim();
    if (!file && !pastedUrl) {
      setError("Choose a floor plan image, or paste an image URL.");
      return;
    }
    if (file) {
      if (!file.type.startsWith("image/")) {
        setError("File must be an image.");
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        setError("Image must be under 8 MB.");
        return;
      }
    }

    setBusy(true);
    setUploading(Boolean(file));
    setError(null);
    try {
      let imageUrl = pastedUrl;
      let storagePath = "";

      const floorRef = await addDoc(collection(db, "orgs", ORG_ID, "floorplans"), {
        name: floorName.trim(),
        imageUrl: "",
        storagePath: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (file) {
        storagePath = `orgs/${ORG_ID}/floorplans/${floorRef.id}/${Date.now()}_${file.name}`;
        const fileRef = ref(storage, storagePath);
        await uploadBytes(fileRef, file);
        imageUrl = await getDownloadURL(fileRef);
      }

      await updateDoc(floorRef, {
        imageUrl,
        storagePath,
        updatedAt: serverTimestamp(),
      });
      setFloorName("");
      setFloorImageUrl("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSelectedFloorId(floorRef.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create floor plan.";
      setError(
        /storage|bucket|404|unauthorized/i.test(msg)
          ? `${msg} — If Firebase Storage is not set up yet, paste a public image URL instead, or enable Storage in the Firebase console.`
          : msg
      );
    } finally {
      setBusy(false);
      setUploading(false);
    }
  }

  async function deleteFloor(floor: FloorPlan) {
    if (!confirm(`Delete floor plan “${floor.name}” and its pins?`)) return;
    setBusy(true);
    setError(null);
    try {
      if (floor.storagePath) {
        await deleteObject(ref(storage, floor.storagePath)).catch(() => {});
      }
      const pinSnap = await getDocs(
        collection(db, "orgs", ORG_ID, "floorplans", floor.id, "pins")
      );
      await Promise.all(
        pinSnap.docs.map((d) =>
          deleteDoc(doc(db, "orgs", ORG_ID, "floorplans", floor.id, "pins", d.id)).catch(
            () => {}
          )
        )
      );
      await deleteDoc(doc(db, "orgs", ORG_ID, "floorplans", floor.id));
      if (selectedFloorId === floor.id) setSelectedFloorId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  function onBoardClick(e: MouseEvent<HTMLDivElement>) {
    if (!placing || !selectedFloor) return;
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
    setDraft({ x, y });
  }

  async function savePin(e: FormEvent) {
    e.preventDefault();
    if (!selectedFloorId || !draft || !pinName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addDoc(
        collection(db, "orgs", ORG_ID, "floorplans", selectedFloorId, "pins"),
        {
          name: pinName.trim(),
          x: draft.x,
          y: draft.y,
          assignedDriverId: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );
      setPinName("");
      setDraft(null);
      setPlacing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save pin.");
    } finally {
      setBusy(false);
    }
  }

  async function assignPin(pinId: string, driverId: string) {
    if (!selectedFloorId) return;
    setBusy(true);
    setError(null);
    try {
      await updateDoc(
        doc(db, "orgs", ORG_ID, "floorplans", selectedFloorId, "pins", pinId),
        {
          assignedDriverId: driverId || null,
          updatedAt: serverTimestamp(),
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assign failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removePin(pinId: string) {
    if (!selectedFloorId) return;
    setBusy(true);
    try {
      await deleteDoc(
        doc(db, "orgs", ORG_ID, "floorplans", selectedFloorId, "pins", pinId)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete pin failed.");
    } finally {
      setBusy(false);
    }
  }

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="map-layout geofence-layout floorplan-layout">
      <aside className="map-side geofence-side">
        <p className="map-kicker">Indoor</p>
        <h1>{label("floorplan")}</h1>
        <p className="muted">
          Upload a blueprint, pin posts or rooms, and assign {label("drivers").toLowerCase()}{" "}
          to those spots. Markers show station assignments on the plan (not GPS).
        </p>
        {error && <p className="error">{error}</p>}

        <div className="panel">
          <p className="map-kicker">New floor</p>
          <form
            className="stack-form"
            onSubmit={(e) => {
              const file = fileInputRef.current?.files?.[0] || null;
              void createFloor(e, file);
            }}
          >
            <label>
              Name
              <input
                value={floorName}
                onChange={(e) => setFloorName(e.target.value)}
                placeholder="Ground floor / Lobby"
                required
              />
            </label>
            <label>
              Blueprint image (upload)
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
              />
            </label>
            <label>
              Or image URL
              <input
                type="url"
                value={floorImageUrl}
                onChange={(e) => setFloorImageUrl(e.target.value)}
                placeholder="https://…"
              />
            </label>
            <button type="submit" disabled={busy || uploading}>
              {uploading ? "Uploading…" : "Create floor plan"}
            </button>
          </form>
        </div>

        <div className="panel">
          <p className="map-kicker">Floors ({floors.length})</p>
          <ul className="geofence-list">
            {floors.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className={
                    f.id === selectedFloorId
                      ? "ghost floorplan-floor-btn is-active"
                      : "ghost floorplan-floor-btn"
                  }
                  onClick={() => setSelectedFloorId(f.id)}
                >
                  {f.name}
                </button>
                <div className="geofence-list-actions">
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => void deleteFloor(f)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {!floors.length && (
              <li className="muted small">No floor plans yet.</li>
            )}
          </ul>
        </div>

        {selectedFloor && (
          <div className="panel">
            <p className="map-kicker">Pins on {selectedFloor.name}</p>
            <form className="stack-form" onSubmit={(e) => void savePin(e)}>
              <label>
                Post / room name
                <input
                  value={pinName}
                  onChange={(e) => setPinName(e.target.value)}
                  placeholder="Gate 1 / East wing"
                />
              </label>
              <p className="muted small">
                {draft
                  ? `Draft pin at ${(draft.x * 100).toFixed(0)}%, ${(draft.y * 100).toFixed(0)}%`
                  : "Turn on Pin mode, then click the blueprint."}
              </p>
              <div className="dvr-controls">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setPlacing((v) => !v);
                    setDraft(null);
                  }}
                >
                  {placing ? "Cancel pin" : "Pin on plan"}
                </button>
                <button
                  type="submit"
                  disabled={busy || !draft || !pinName.trim()}
                >
                  Save pin
                </button>
              </div>
            </form>

            <ul className="geofence-list" style={{ marginTop: "1rem" }}>
              {pins.map((pin) => {
                const assigned = pin.assignedDriverId
                  ? driverById.get(pin.assignedDriverId)
                  : null;
                return (
                  <li key={pin.id}>
                    <div>
                      <strong>{pin.name}</strong>
                      <div className="muted small">
                        {assigned
                          ? `${assigned.displayName}${assigned.onDuty ? " · on duty" : ""}`
                          : "Unassigned"}
                      </div>
                      <label className="small" style={{ display: "block", marginTop: "0.35rem" }}>
                        Assign
                        <select
                          value={pin.assignedDriverId || ""}
                          onChange={(e) => void assignPin(pin.id, e.target.value)}
                          disabled={busy}
                        >
                          <option value="">— None —</option>
                          {drivers.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.displayName}
                              {d.onDuty ? " (on duty)" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="geofence-list-actions">
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() => void removePin(pin.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
              {!pins.length && (
                <li className="muted small">No pins on this floor yet.</li>
              )}
            </ul>
          </div>
        )}
      </aside>

      <div className="floorplan-stage">
        {!selectedFloor ? (
          <div className="floorplan-empty">
            <p>Create or select a floor plan to place posts on the blueprint.</p>
          </div>
        ) : !selectedFloor.imageUrl ? (
          <div className="floorplan-empty">
            <p>Uploading image…</p>
          </div>
        ) : (
          <div
            ref={boardRef}
            className={`floorplan-board${placing ? " is-placing" : ""}`}
            onClick={onBoardClick}
            role="presentation"
          >
            <img
              src={selectedFloor.imageUrl}
              alt={selectedFloor.name}
              draggable={false}
            />
            {pins.map((pin) => {
              const assigned = pin.assignedDriverId
                ? driverById.get(pin.assignedDriverId)
                : null;
              return (
                <div
                  key={pin.id}
                  className={`floorplan-marker${assigned?.onDuty ? " is-onduty" : ""}`}
                  style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
                  title={
                    assigned
                      ? `${pin.name}: ${assigned.displayName}`
                      : pin.name
                  }
                >
                  <span className="floorplan-marker-dot" />
                  <span className="floorplan-marker-label">
                    {assigned ? assigned.displayName : pin.name}
                  </span>
                </div>
              );
            })}
            {draft && (
              <div
                className="floorplan-marker is-draft"
                style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}
              >
                <span className="floorplan-marker-dot" />
                <span className="floorplan-marker-label">New pin</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
