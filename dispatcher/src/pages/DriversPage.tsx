import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
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

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
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
    <div style={{ padding: "1.5rem", maxWidth: "1400px", margin: "0 auto", color: "var(--ink)" }}>
      {/* Hero Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ background: "rgba(59, 130, 246, 0.2)", color: "#60a5fa", border: "1px solid rgba(59, 130, 246, 0.4)", padding: "0.2rem 0.6rem", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase" }}>
              Fleet Personnel Telemetry
            </span>
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              Pairing Security: <strong>30-min One-time Pin</strong>
            </span>
          </div>
          <h1 style={{ margin: "0.4rem 0 0 0", fontSize: "2rem", color: "#fff", fontWeight: 800 }}>
            🚘 {label("drivers")} Roster & Telemetry
          </h1>
          <p style={{ margin: "0.3rem 0 0 0", color: "var(--muted)", fontSize: "0.95rem" }}>
            Manage driver profiles, issue pairing codes, set speed limit alerts, and monitor live telemetry.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          style={{
            background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
            color: "#fff",
            border: "none",
            fontWeight: 800,
            padding: "0.75rem 1.25rem",
            borderRadius: "10px",
            boxShadow: "0 4px 14px rgba(59, 130, 246, 0.4)",
            cursor: "pointer"
          }}
        >
          + Add Driver & Pair Code
        </button>
      </div>

      {/* KPI Counters */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ background: "rgba(59, 130, 246, 0.12)", border: "1px solid rgba(59, 130, 246, 0.3)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "#60a5fa", fontWeight: 700 }}>Total Registered Drivers</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{drivers.length}</div>
        </div>

        <div style={{ background: "rgba(34, 197, 94, 0.12)", border: "1px solid rgba(34, 197, 94, 0.3)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "#4ade80", fontWeight: 700 }}>Active On-Duty Drivers</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{onDutyCount}</div>
        </div>

        <div style={{ background: "rgba(168, 85, 247, 0.12)", border: "1px solid rgba(168, 85, 247, 0.3)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "#c084fc", fontWeight: 700 }}>Paired Devices</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{pairedCount}</div>
        </div>

        <div style={{ background: speedingCount > 0 ? "rgba(239, 68, 68, 0.15)" : "rgba(255, 255, 255, 0.03)", border: speedingCount > 0 ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid var(--line)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: speedingCount > 0 ? "#ef4444" : "var(--muted)", fontWeight: 700 }}>Speeding Warnings</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: speedingCount > 0 ? "#ef4444" : "#fff", marginTop: "0.2rem" }}>{speedingCount}</div>
        </div>
      </div>

      {/* Pair Code Generated Banner */}
      {lastPair && (
        <div style={{ background: "linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(37, 99, 235, 0.1) 100%)", border: "1px solid rgba(59, 130, 246, 0.5)", borderRadius: "14px", padding: "1.25rem", marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ fontSize: "0.85rem", color: "#60a5fa", fontWeight: 700 }}>
              📱 Active Pair Code for <strong>{lastPair.displayName || "Driver"}</strong>:
            </div>
            <div style={{ fontSize: "2.5rem", fontWeight: 900, color: "#fff", letterSpacing: "0.15em", fontFamily: "monospace", margin: "0.2rem 0" }}>
              {lastPair.code}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
              Valid for 30 minutes · Expires {new Date(lastPair.expiresAt).toLocaleTimeString()}
            </div>
          </div>

          <button
            onClick={() => handleCopyCode(lastPair.code)}
            style={{
              background: copiedCode ? "#22c55e" : "#3b82f6",
              color: "#fff",
              border: "none",
              padding: "0.6rem 1.25rem",
              borderRadius: "10px",
              fontWeight: 800,
              cursor: "pointer"
            }}
          >
            {copiedCode ? "✓ Copied to Clipboard!" : "📋 Copy Code"}
          </button>
        </div>
      )}

      {error && <p style={{ color: "#ef4444", marginBottom: "1rem" }}>{error}</p>}

      {/* Driver Roster Console */}
      <div style={{ background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(12px)", border: "1px solid var(--line)", borderRadius: "16px", padding: "1.25rem" }}>
        
        {/* Toolbar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: "1.3rem", color: "#fff", fontWeight: 800 }}>
              Fleet Drivers ({filteredDrivers.length})
            </h2>

            <select
              value={dutyFilter}
              onChange={(e) => setDutyFilter(e.target.value)}
              style={{
                padding: "0.55rem 0.9rem",
                borderRadius: "8px",
                background: "rgba(0,0,0,0.3)",
                color: "#fff",
                border: "1px solid var(--line)",
                fontSize: "0.85rem"
              }}
            >
              <option value="all">All Drivers</option>
              <option value="onduty">🟢 On Duty Only ({onDutyCount})</option>
              <option value="paired">📱 Paired Devices ({pairedCount})</option>
              <option value="speeding">🔴 Speeding Alerts ({speedingCount})</option>
            </select>
          </div>

          <input
            type="text"
            placeholder="🔍 Search driver or plate..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: "0.55rem 0.9rem",
              borderRadius: "8px",
              background: "rgba(0,0,0,0.3)",
              color: "#fff",
              border: "1px solid var(--line)",
              fontSize: "0.85rem",
              minWidth: "220px"
            }}
          />
        </div>

        {/* Drivers Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 0.5rem" }}>
            <thead>
              <tr style={{ color: "var(--muted)", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <th style={{ padding: "0.75rem 1rem" }}>Driver & Vehicle</th>
                <th style={{ padding: "0.75rem 1rem" }}>Status</th>
                <th style={{ padding: "0.75rem 1rem" }}>Duty State</th>
                <th style={{ padding: "0.75rem 1rem" }}>Current Speed</th>
                <th style={{ padding: "0.75rem 1rem" }}>Speed Limit (km/h)</th>
                <th style={{ padding: "0.75rem 1rem" }}>Last Telemetry</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
                    No driver records found matching selected filters.
                  </td>
                </tr>
              ) : (
                filteredDrivers.map((d) => {
                  const isSpeeding = d.lastSpeed != null && d.speedLimitKmh != null && d.lastSpeed > d.speedLimitKmh;

                  return (
                    <tr
                      key={d.id}
                      style={{
                        background: isSpeeding
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
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void regenerateCode(d.id)}
                          style={{
                            background: "rgba(59, 130, 246, 0.18)",
                            color: "#60a5fa",
                            border: "1px solid rgba(59, 130, 246, 0.4)",
                            borderRadius: "6px",
                            padding: "0.35rem 0.75rem",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            cursor: "pointer"
                          }}
                        >
                          🔑 New Pair Code
                        </button>
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
        <div className="modal" style={{ display: "flex" }}>
          <div className="modal-content" style={{ maxWidth: "500px", width: "90%", background: "#0f172a", border: "1px solid var(--line)", borderRadius: "16px", padding: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, color: "#fff", fontSize: "1.3rem", fontWeight: 800 }}>Create Driver Profile & Pair Code</h3>
              <button onClick={() => setShowCreateModal(false)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: "1.4rem", cursor: "pointer" }}>✕</button>
            </div>

            <form onSubmit={createWithCode}>
              <div className="form-group">
                <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>Driver Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe – Truck 14"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", background: "#1e293b", color: "#fff", border: "1px solid var(--line)", marginTop: "0.4rem" }}
                />
              </div>

              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>License Plate / Vehicle Tag (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. ABC 1234"
                  value={plate}
                  onChange={(e) => setPlate(e.target.value)}
                  style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", background: "#1e293b", color: "#fff", border: "1px solid var(--line)", marginTop: "0.4rem" }}
                />
              </div>

              <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{ background: "rgba(255,255,255,0.08)", color: "#cbd5e1", border: "1px solid var(--line)", padding: "0.7rem 1.25rem", borderRadius: "10px", fontWeight: 700 }}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || !name.trim()}
                  style={{ background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)", color: "#fff", border: "none", padding: "0.7rem 1.4rem", borderRadius: "10px", fontWeight: 800, boxShadow: "0 4px 14px rgba(59, 130, 246, 0.4)" }}
                >
                  {busy ? "Generating..." : "Generate Pair Code"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
