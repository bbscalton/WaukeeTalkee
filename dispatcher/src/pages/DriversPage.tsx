import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions, ORG_ID } from "../firebase";
import { formatAge, formatSpeed, type Driver } from "../types";
import { useSolutionProfile } from "../useSolutionProfile";

type PairResult = {
  code: string;
  expiresAt: string;
  driverId: string;
  displayName?: string;
};

function mapDriver(id: string, data: Record<string, unknown>): Driver {
  return {
    id,
    displayName: String(data.displayName || "Driver"),
    plate: (data.plate as string | null) ?? null,
    pairStatus: data.pairStatus === "paired" ? "paired" : "unpaired",
    deviceId: (data.deviceId as string | null) ?? null,
    onDuty: Boolean(data.onDuty),
    lastLat: typeof data.lastLat === "number" ? data.lastLat : null,
    lastLng: typeof data.lastLng === "number" ? data.lastLng : null,
    lastSpeed: typeof data.lastSpeed === "number" ? data.lastSpeed : null,
    lastHeading: typeof data.lastHeading === "number" ? data.lastHeading : null,
    lastTelemetryAt: (data.lastTelemetryAt as Timestamp | null) ?? null,
    speedLimitKmh:
      typeof data.speedLimitKmh === "number" ? data.speedLimitKmh : null,
  };
}

export function DriversPage() {
  const { label } = useSolutionProfile();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPair, setLastPair] = useState<PairResult | null>(null);
  const [speedDraft, setSpeedDraft] = useState<Record<string, string>>({});

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [dutyFilter, setDutyFilter] = useState("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Multi-selection state for bulk delete
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!ORG_ID) return;
    const q = query(
      collection(db, "orgs", ORG_ID, "drivers"),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) =>
          mapDriver(d.id, d.data() as Record<string, unknown>)
        );
        setDrivers(rows);
        setSpeedDraft((prev) => {
          const next = { ...prev };
          for (const d of rows) {
            if (next[d.id] === undefined) {
              next[d.id] =
                d.speedLimitKmh != null ? String(d.speedLimitKmh) : "";
            }
          }
          return next;
        });
      },
      (err) => setError(err.message)
    );
  }, []);

  async function createWithCode(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, "createDriverWithPairCode");
      const res = await fn({
        orgId: ORG_ID,
        displayName: name.trim(),
        plate: plate.trim() || null,
      });
      const data = res.data as PairResult & { displayName: string };
      setLastPair({
        code: data.code,
        expiresAt: data.expiresAt,
        driverId: data.driverId,
        displayName: data.displayName,
      });
      setName("");
      setPlate("");
      setShowCreateModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function regenerateCode(driverId: string) {
    setBusy(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, "createPairCode");
      const res = await fn({ orgId: ORG_ID, driverId });
      const data = res.data as PairResult;
      setLastPair({ ...data, driverId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pair code generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveSpeedLimit(driverId: string, customVal?: number | null) {
    setBusy(true);
    setError(null);
    try {
      let n: number | null = null;
      if (customVal !== undefined) {
        n = customVal;
      } else {
        const raw = (speedDraft[driverId] ?? "").trim();
        n = raw === "" ? null : Number(raw);
      }

      if (n != null && (!Number.isFinite(n) || n < 1 || n > 200)) {
        throw new Error("Speed limit must be 1–200 km/h or empty");
      }
      await updateDoc(doc(db, "orgs", ORG_ID, "drivers", driverId), {
        speedLimitKmh: n == null ? null : Math.round(n),
      });
      setSpeedDraft((prev) => ({ ...prev, [driverId]: n != null ? String(n) : "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speed limit save failed");
    } finally {
      setBusy(false);
    }
  }

  const handleDeleteDriver = async (driver: Driver) => {
    if (!ORG_ID) return;
    if (!confirm(`Are you sure you want to delete driver "${driver.displayName}"? Device pair association will be removed.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDoc(doc(db, "orgs", ORG_ID, "drivers", driver.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(driver.id);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete driver.");
    } finally {
      setBusy(false);
    }
  };

  const handleClearSelectedDrivers = async () => {
    if (selectedIds.size === 0 || !ORG_ID) return;
    if (!confirm(`Delete all ${selectedIds.size} selected driver profiles?`)) return;
    setBusy(true);
    setError(null);
    try {
      const batch = writeBatch(db);
      Array.from(selectedIds).forEach((id) => {
        batch.delete(doc(db, "orgs", ORG_ID, "drivers", id));
      });
      await batch.commit();
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete selected drivers.");
    } finally {
      setBusy(false);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredDrivers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDrivers.map((d) => d.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredDrivers = useMemo(() => {
    return drivers.filter((d) => {
      const matchesDuty =
        dutyFilter === "all"
          ? true
          : dutyFilter === "onduty"
          ? d.onDuty
          : dutyFilter === "paired"
          ? d.pairStatus === "paired"
          : dutyFilter === "speeding"
          ? (d.lastSpeed != null && d.speedLimitKmh != null && d.lastSpeed > d.speedLimitKmh)
          : true;

      const matchesSearch =
        !searchQuery.trim() ||
        d.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.plate?.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesDuty && matchesSearch;
    });
  }, [drivers, dutyFilter, searchQuery]);

  const onDutyCount = drivers.filter((d) => d.onDuty).length;
  const pairedCount = drivers.filter((d) => d.pairStatus === "paired").length;
  const speedingCount = drivers.filter((d) => d.lastSpeed != null && d.speedLimitKmh != null && d.lastSpeed > d.speedLimitKmh).length;

  return (
    <div className="manga-page">
      {/* Hero Header */}
      <div className="manga-hero">
        <div>
          <div className="manga-hero-meta">
            <span className="manga-chip">Fleet Personnel Telemetry</span>
            <span className="manga-hero-note">
              Pairing Security: <strong>30-min One-time Pin</strong>
            </span>
          </div>
          <h1 className="manga-title">
            🚘 {label("drivers")} Roster & Telemetry
          </h1>
          <p className="manga-lead">
            Manage driver profiles, issue pairing codes, set speed limit alerts, delete profiles, and monitor live telemetry.
          </p>
        </div>

        <button
          type="button"
          className="manga-btn manga-btn-primary"
          onClick={() => setShowCreateModal(true)}
        >
          + Add Driver & Pair Code
        </button>
      </div>

      {/* KPI Counters */}
      <div className="manga-kpi-grid">
        <div className="manga-kpi">
          <div className="manga-kpi-label">Total Registered Drivers</div>
          <div className="manga-kpi-value">{drivers.length}</div>
        </div>

        <div className="manga-kpi manga-kpi--ok">
          <div className="manga-kpi-label">Active On-Duty Drivers</div>
          <div className="manga-kpi-value">{onDutyCount}</div>
        </div>

        <div className="manga-kpi manga-kpi--info">
          <div className="manga-kpi-label">Paired Devices</div>
          <div className="manga-kpi-value">{pairedCount}</div>
        </div>

        <div className={`manga-kpi${speedingCount > 0 ? " manga-kpi--danger" : ""}`}>
          <div className="manga-kpi-label">Speeding Warnings</div>
          <div className="manga-kpi-value">{speedingCount}</div>
        </div>
      </div>

      {/* Pair Code Generated Banner */}
      {lastPair && (
        <div className="manga-banner">
          <div>
            <div className="manga-kpi-label">
              📱 Active Pair Code for <strong>{lastPair.displayName || "Driver"}</strong>:
            </div>
            <div className="manga-banner-code">{lastPair.code}</div>
            <div className="manga-hero-note">
              Valid for 30 minutes · Expires {new Date(lastPair.expiresAt).toLocaleTimeString()}
            </div>
          </div>

          <button
            type="button"
            className={`manga-btn ${copiedCode ? "manga-btn-ok" : "manga-btn-primary"}`}
            onClick={() => handleCopyCode(lastPair.code)}
          >
            {copiedCode ? "✓ Copied to Clipboard!" : "📋 Copy Code"}
          </button>
        </div>
      )}

      {error && <p style={{ color: "#ef4444", marginBottom: "1rem" }}>{error}</p>}

      {/* Driver Roster Console */}
      <div className="manga-console">
        {/* Toolbar */}
        <div className="manga-toolbar">
          <div className="manga-filter-row">
            <h2>Fleet Drivers ({filteredDrivers.length})</h2>

            <select
              value={dutyFilter}
              onChange={(e) => setDutyFilter(e.target.value)}
            >
              <option value="all">All Drivers</option>
              <option value="onduty">🟢 On Duty Only ({onDutyCount})</option>
              <option value="paired">📱 Paired Devices ({pairedCount})</option>
              <option value="speeding">🔴 Speeding Alerts ({speedingCount})</option>
            </select>
          </div>

          <div className="manga-filter-row">
            {selectedIds.size > 0 && (
              <button
                type="button"
                className="manga-btn manga-btn-danger"
                onClick={handleClearSelectedDrivers}
                disabled={busy}
              >
                🗑️ Delete Selected ({selectedIds.size})
              </button>
            )}

            <input
              type="text"
              placeholder="🔍 Search driver or plate..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Drivers Table */}
        <div className="manga-table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: "40px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={filteredDrivers.length > 0 && selectedIds.size === filteredDrivers.length}
                    onChange={toggleSelectAll}
                    style={{ cursor: "pointer" }}
                  />
                </th>
                <th>Driver & Vehicle</th>
                <th>Status</th>
                <th>Duty State</th>
                <th>Current Speed</th>
                <th>Speed Limit (km/h)</th>
                <th>Last Telemetry</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
                    No driver records found matching selected filters.
                  </td>
                </tr>
              ) : (
                filteredDrivers.map((d) => {
                  const isSpeeding = d.lastSpeed != null && d.speedLimitKmh != null && d.lastSpeed > d.speedLimitKmh;
                  const isSelected = selectedIds.has(d.id);

                  return (
                    <tr
                      key={d.id}
                      style={{
                        background: isSelected
                          ? "rgba(59, 130, 246, 0.2)"
                          : isSpeeding
                          ? "rgba(239, 68, 68, 0.12)"
                          : d.onDuty
                          ? "rgba(34, 197, 94, 0.04)"
                          : "rgba(255, 255, 255, 0.02)",
                        borderLeft: isSpeeding
                          ? "4px solid #ef4444"
                          : d.onDuty
                          ? "4px solid #22c55e"
                          : "4px solid #64748b",
                        borderRadius: "8px"
                      }}
                    >
                      {/* Checkbox */}
                      <td style={{ padding: "0.85rem 0.5rem", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(d.id)}
                          style={{ cursor: "pointer" }}
                        />
                      </td>

                      {/* Driver Name & Plate */}
                      <td style={{ padding: "0.85rem 1rem" }}>
                        <div style={{ fontWeight: 800, color: "#fff", fontSize: "0.95rem" }}>{d.displayName}</div>
                        {d.plate && <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.1rem" }}>🚗 {d.plate}</div>}
                      </td>

                      {/* Pair Status */}
                      <td style={{ padding: "0.85rem 1rem" }}>
                        <span style={{
                          padding: "0.25rem 0.6rem",
                          borderRadius: "6px",
                          fontSize: "0.75rem",
                          fontWeight: 800,
                          background: d.pairStatus === "paired" ? "rgba(34, 197, 94, 0.2)" : "rgba(245, 158, 11, 0.2)",
                          color: d.pairStatus === "paired" ? "#4ade80" : "#f59e0b",
                        }}>
                          {d.pairStatus === "paired" ? "📱 Paired" : "⏳ Unpaired"}
                        </span>
                      </td>

                      {/* Duty State */}
                      <td style={{ padding: "0.85rem 1rem" }}>
                        <span style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.4rem",
                          fontWeight: 700,
                          fontSize: "0.85rem",
                          color: d.onDuty ? "#4ade80" : "var(--muted)"
                        }}>
                          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: d.onDuty ? "#22c55e" : "#64748b" }} />
                          {d.onDuty ? "On Duty" : "Off Duty"}
                        </span>
                      </td>

                      {/* Current Speed */}
                      <td style={{ padding: "0.85rem 1rem" }}>
                        <span style={{
                          fontWeight: 800,
                          fontSize: "0.9rem",
                          color: isSpeeding ? "#ef4444" : "#fff",
                        }}>
                          {formatSpeed(d.lastSpeed)}
                          {isSpeeding && <span style={{ fontSize: "0.7rem", marginLeft: "0.3rem", color: "#ef4444", fontWeight: 900 }}>⚡ SPEEDING</span>}
                        </span>
                      </td>

                      {/* Speed Limit Adjuster */}
                      <td style={{ padding: "0.85rem 1rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          <input
                            type="number"
                            min={1}
                            max={200}
                            placeholder="Limit"
                            value={speedDraft[d.id] ?? ""}
                            onChange={(e) =>
                              setSpeedDraft((prev) => ({
                                ...prev,
                                [d.id]: e.target.value,
                              }))
                            }
                            style={{
                              width: "70px",
                              padding: "0.35rem 0.5rem",
                              borderRadius: "6px",
                              background: "#1e293b",
                              color: "#fff",
                              border: "1px solid var(--line)",
                              fontSize: "0.8rem",
                              marginTop: 0
                            }}
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void saveSpeedLimit(d.id)}
                            style={{
                              background: "rgba(255,255,255,0.08)",
                              color: "#fff",
                              border: "1px solid var(--line)",
                              borderRadius: "6px",
                              padding: "0.35rem 0.6rem",
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              cursor: "pointer"
                            }}
                          >
                            Save
                          </button>
                        </div>
                      </td>

                      {/* Last Telemetry */}
                      <td style={{ padding: "0.85rem 1rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                        {formatAge(d.lastTelemetryAt)}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: "0.85rem 1rem", textAlign: "right" }}>
                        <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end", alignItems: "center" }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void regenerateCode(d.id)}
                            style={{
                              background: "rgba(59, 130, 246, 0.18)",
                              color: "#60a5fa",
                              border: "1px solid rgba(59, 130, 246, 0.4)",
                              borderRadius: "6px",
                              padding: "0.35rem 0.65rem",
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              cursor: "pointer"
                            }}
                          >
                            🔑 New Pair Code
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleDeleteDriver(d)}
                            style={{
                              background: "rgba(239, 68, 68, 0.12)",
                              color: "#ef4444",
                              border: "1px solid rgba(239, 68, 68, 0.3)",
                              borderRadius: "6px",
                              padding: "0.35rem 0.65rem",
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              cursor: "pointer"
                            }}
                            title="Delete driver profile"
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Driver Modal */}
      {showCreateModal && (
        <div className="manga-modal-backdrop">
          <div className="manga-modal">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <h2>Create Driver Profile</h2>
              <button
                type="button"
                className="manga-btn manga-btn-ghost"
                onClick={() => setShowCreateModal(false)}
                style={{ padding: "0.25rem 0.5rem !important" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={(e) => void createWithCode(e)}>
              <div className="form-group">
                <label>Driver Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Driver Alex / Unit 104"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label>Vehicle License Plate / ID (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. GR-9988-B"
                  value={plate}
                  onChange={(e) => setPlate(e.target.value)}
                />
              </div>

              <p style={{ marginTop: "1.25rem", fontSize: "0.85rem" }}>
                ℹ️ Generating a driver profile will issue a 6-character <strong>One-Time Pairing Code</strong> valid for 30 minutes. Enter this code into the mobile driver app to pair the device.
              </p>

              <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="manga-btn manga-btn-ghost"
                  onClick={() => setShowCreateModal(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="manga-btn manga-btn-primary"
                  disabled={busy}
                >
                  {busy ? "Generating..." : "Create & Get Pair Code"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
