import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import type { Driver, RadioGroup } from "../types";

function mapGroup(id: string, data: Record<string, unknown>): RadioGroup {
  const members = Array.isArray(data.memberDriverIds)
    ? (data.memberDriverIds as unknown[]).map(String)
    : [];
  return {
    id,
    name: String(data.name || "Group Channel"),
    memberDriverIds: members,
    createdAt: (data.createdAt as RadioGroup["createdAt"]) ?? null,
    updatedAt: (data.updatedAt as RadioGroup["updatedAt"]) ?? null,
  };
}

export function GroupsPage() {
  const [groups, setGroups] = useState<RadioGroup[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [name, setName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    if (!ORG_ID) return;
    const q = query(
      collection(db, "orgs", ORG_ID, "groups"),
      orderBy("name", "asc")
    );
    return onSnapshot(q, (snap) => {
      setGroups(
        snap.docs.map((d) => mapGroup(d.id, d.data() as Record<string, unknown>))
      );
    });
  }, []);

  useEffect(() => {
    if (!ORG_ID) return;
    return onSnapshot(collection(db, "orgs", ORG_ID, "drivers"), (snap) => {
      setDrivers(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            displayName: String(data.displayName || "Driver"),
            plate: (data.plate as string | null) ?? null,
            pairStatus: data.pairStatus === "paired" ? "paired" : "unpaired",
            deviceId: (data.deviceId as string | null) ?? null,
            onDuty: Boolean(data.onDuty),
            lastLat: typeof data.lastLat === "number" ? data.lastLat : null,
            lastLng: typeof data.lastLng === "number" ? data.lastLng : null,
            lastSpeed: typeof data.lastSpeed === "number" ? data.lastSpeed : null,
            lastHeading: typeof data.lastHeading === "number" ? data.lastHeading : null,
            lastTelemetryAt: data.lastTelemetryAt ?? null,
            speedLimitKmh: typeof data.speedLimitKmh === "number" ? data.speedLimitKmh : null,
          };
        })
      );
    });
  }, []);

  const pairedDrivers = useMemo(
    () => drivers.filter((d) => d.pairStatus === "paired"),
    [drivers]
  );

  const driverMap = useMemo(() => {
    const map = new Map<string, Driver>();
    drivers.forEach((d) => map.set(d.id, d));
    return map;
  }, [drivers]);

  const toggleMemberInState = (id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function createGroup(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (selectedMembers.size < 1) {
      setError("Please pick at least one driver for the channel.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addDoc(collection(db, "orgs", ORG_ID, "groups"), {
        name: trimmed,
        memberDriverIds: [...selectedMembers],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setName("");
      setSelectedMembers(new Set());
      setShowCreateModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create channel");
    } finally {
      setBusy(false);
    }
  }

  async function removeGroup(group: RadioGroup) {
    if (
      !window.confirm(
        `Delete channel "${group.name}"? Members will lose group radio channel sync.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await deleteDoc(doc(db, "orgs", ORG_ID, "groups", group.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleGroupMember(group: RadioGroup, driverId: string) {
    const has = group.memberDriverIds.includes(driverId);
    const next = has
      ? group.memberDriverIds.filter((id) => id !== driverId)
      : [...group.memberDriverIds, driverId];
    setBusy(true);
    try {
      await updateDoc(doc(db, "orgs", ORG_ID, "groups", group.id), {
        memberDriverIds: next,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  const handleBroadcastToGroup = async (group: RadioGroup) => {
    const onDutyMembers = group.memberDriverIds
      .map((id) => driverMap.get(id))
      .filter((d) => d && d.onDuty);

    if (onDutyMembers.length === 0) {
      alert(`No on-duty drivers currently in ${group.name}.`);
      return;
    }

    if (!confirm(`Broadcast urgent PTT radio warning to all ${onDutyMembers.length} on-duty drivers in channel "${group.name}"?`)) return;

    try {
      await addDoc(collection(db, "orgs", ORG_ID, "broadcasts"), {
        senderName: `Dispatch (${group.name})`,
        message: `Radio broadcast callout for ${group.name} channel.`,
        severity: "warning",
        createdAt: serverTimestamp(),
      });
      alert(`📢 Broadcast siren & radio alert dispatched to ${group.name}!`);
    } catch (err: any) {
      alert("Failed to broadcast: " + err.message);
    }
  };

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    return groups.filter((g) =>
      g.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [groups, searchQuery]);

  const totalMembersAssigned = useMemo(() => {
    const assigned = new Set<string>();
    groups.forEach((g) => g.memberDriverIds.forEach((id) => assigned.add(id)));
    return assigned.size;
  }, [groups]);

  const totalOnDutyInGroups = useMemo(() => {
    const onDutySet = new Set<string>();
    groups.forEach((g) => {
      g.memberDriverIds.forEach((id) => {
        const d = driverMap.get(id);
        if (d?.onDuty) onDutySet.add(id);
      });
    });
    return onDutySet.size;
  }, [groups, driverMap]);

  return (
    <div style={{ padding: "1.5rem", maxWidth: "1400px", margin: "0 auto", color: "var(--ink)" }}>
      {/* Hero Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ background: "rgba(168, 85, 247, 0.2)", color: "#c084fc", border: "1px solid rgba(168, 85, 247, 0.4)", padding: "0.2rem 0.6rem", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase" }}>
              Radio Channel Command
            </span>
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              Hardware PTT Override: <strong>Volume Down</strong>
            </span>
          </div>
          <h1 style={{ margin: "0.4rem 0 0 0", fontSize: "2rem", color: "#fff", fontWeight: 800 }}>
            📻 Peer-to-Peer & Group Channels
          </h1>
          <p style={{ margin: "0.3rem 0 0 0", color: "var(--muted)", fontSize: "0.95rem" }}>
            Configure driver talkgroups, hardware push-to-talk volume keys, and channel broadcast targets.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          style={{
            background: "linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)",
            color: "#fff",
            border: "none",
            fontWeight: 800,
            padding: "0.75rem 1.25rem",
            borderRadius: "10px",
            boxShadow: "0 4px 14px rgba(168, 85, 247, 0.4)",
            cursor: "pointer"
          }}
        >
          + Create Radio Channel
        </button>
      </div>

      {/* KPI Counters */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ background: "rgba(168, 85, 247, 0.12)", border: "1px solid rgba(168, 85, 247, 0.3)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "#c084fc", fontWeight: 700 }}>Active Radio Channels</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{groups.length}</div>
        </div>

        <div style={{ background: "rgba(34, 197, 94, 0.12)", border: "1px solid rgba(34, 197, 94, 0.3)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "#4ade80", fontWeight: 700 }}>On-Duty In Channels</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{totalOnDutyInGroups}</div>
        </div>

        <div style={{ background: "rgba(255, 255, 255, 0.03)", border: "1px solid var(--line)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 700 }}>Assigned Fleet Drivers</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{totalMembersAssigned}</div>
        </div>

        <div style={{ background: "rgba(255, 255, 255, 0.03)", border: "1px solid var(--line)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 700 }}>Peer Talk Mode</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--amber)", marginTop: "0.4rem" }}>VOLUME UP 🔊</div>
        </div>
      </div>

      {/* Main Channels Console */}
      <div style={{ background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(12px)", border: "1px solid var(--line)", borderRadius: "16px", padding: "1.25rem" }}>
        
        {/* Search & Header Toolbar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.3rem", color: "#fff", fontWeight: 800 }}>
            Fleet Channels & Driver Talkgroups ({filteredGroups.length})
          </h2>

          <input
            type="text"
            placeholder="🔍 Search channels..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: "0.55rem 0.9rem",
              borderRadius: "8px",
              background: "rgba(0,0,0,0.3)",
              color: "#fff",
              border: "1px solid var(--line)",
              fontSize: "0.85rem",
              minWidth: "240px"
            }}
          />
        </div>

        {error && <p style={{ color: "#ef4444", marginBottom: "1rem" }}>{error}</p>}

        {/* Group Cards Grid */}
        {filteredGroups.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3.5rem 1rem", color: "var(--muted)" }}>
            <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>📻</div>
            <div style={{ fontWeight: 700, fontSize: "1.2rem", color: "#fff" }}>No Radio Channels Found</div>
            <p style={{ margin: "0.4rem 0 0 0", fontSize: "0.9rem" }}>
              Click "+ Create Radio Channel" above to build a peer talkgroup.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: "1.25rem" }}>
            {filteredGroups.map((g) => {
              const members = g.memberDriverIds
                .map((id) => driverMap.get(id))
                .filter(Boolean) as Driver[];

              const onDutyCount = members.filter((m) => m.onDuty).length;

              return (
                <div
                  key={g.id}
                  style={{
                    background: "rgba(255, 255, 255, 0.025)",
                    border: "1px solid var(--line)",
                    borderRadius: "14px",
                    padding: "1.25rem",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between"
                  }}
                >
                  <div>
                    {/* Card Title & Broadcast Button */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ fontSize: "1.4rem" }}>📻</span>
                          <h3 style={{ margin: 0, color: "#fff", fontSize: "1.25rem", fontWeight: 800 }}>
                            {g.name}
                          </h3>
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.2rem" }}>
                          {members.length} Drivers Assigned · <strong style={{ color: "#4ade80" }}>{onDutyCount} On-Duty</strong>
                        </div>
                      </div>

                      <button
                        onClick={() => handleBroadcastToGroup(g)}
                        style={{
                          background: "rgba(245, 158, 11, 0.18)",
                          color: "#f59e0b",
                          border: "1px solid rgba(245, 158, 11, 0.4)",
                          borderRadius: "8px",
                          padding: "0.4rem 0.8rem",
                          fontSize: "0.75rem",
                          fontWeight: 800,
                          cursor: "pointer"
                        }}
                      >
                        📢 PTT Broadcast
                      </button>
                    </div>

                    {/* Member Chips Selector */}
                    <div style={{ marginTop: "1rem" }}>
                      <div style={{ fontSize: "0.8rem", color: "#cbd5e1", fontWeight: 700, marginBottom: "0.5rem" }}>
                        Assign Channel Members:
                      </div>

                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", maxHeight: "180px", overflowY: "auto", paddingRight: "0.2rem" }}>
                        {pairedDrivers.map((d) => {
                          const isMember = g.memberDriverIds.includes(d.id);
                          return (
                            <button
                              key={d.id}
                              type="button"
                              disabled={busy}
                              onClick={() => void toggleGroupMember(g, d.id)}
                              style={{
                                background: isMember
                                  ? d.onDuty
                                    ? "rgba(34, 197, 94, 0.2)"
                                    : "rgba(168, 85, 247, 0.2)"
                                  : "rgba(255, 255, 255, 0.04)",
                                color: isMember
                                  ? d.onDuty
                                    ? "#4ade80"
                                    : "#c084fc"
                                  : "#94a3b8",
                                border: isMember
                                  ? d.onDuty
                                    ? "1px solid rgba(34, 197, 94, 0.5)"
                                    : "1px solid rgba(168, 85, 247, 0.5)"
                                  : "1px solid var(--line)",
                                borderRadius: "8px",
                                padding: "0.35rem 0.65rem",
                                fontSize: "0.75rem",
                                fontWeight: 700,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "0.35rem",
                                transition: "all 0.15s ease"
                              }}
                            >
                              <span>{isMember ? "✓" : "+"}</span>
                              <span>{d.displayName}</span>
                              {d.onDuty && <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#22c55e" }} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div style={{ marginTop: "1.25rem", paddingTop: "0.75rem", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                      Channels automatically sync to mobile PTT devices
                    </span>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeGroup(g)}
                      style={{
                        background: "rgba(239, 68, 68, 0.12)",
                        color: "#ef4444",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                        borderRadius: "6px",
                        padding: "0.35rem 0.75rem",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        cursor: "pointer"
                      }}
                    >
                      Delete Channel
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Channel Modal */}
      {showCreateModal && (
        <div className="modal" style={{ display: "flex" }}>
          <div className="modal-content" style={{ maxWidth: "540px", width: "90%", background: "#0f172a", border: "1px solid var(--line)", borderRadius: "16px", padding: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, color: "#fff", fontSize: "1.3rem", fontWeight: 800 }}>Create New Radio Channel</h3>
              <button onClick={() => setShowCreateModal(false)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: "1.4rem", cursor: "pointer" }}>✕</button>
            </div>

            <form onSubmit={createGroup}>
              <div className="form-group">
                <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>Channel Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Haul Route Alpha / Night Patrol"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", background: "#1e293b", color: "#fff", border: "1px solid var(--line)", marginTop: "0.4rem" }}
                />
              </div>

              {/* Channel Presets */}
              <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>Presets:</span>
                {["Hauling Division", "Night Shift Patrol", "Site Operations", "Emergency Response"].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setName(preset)}
                    style={{ background: "rgba(255,255,255,0.05)", color: "#cbd5e1", border: "1px solid var(--line)", padding: "0.25rem 0.5rem", borderRadius: "6px", fontSize: "0.75rem" }}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <div className="form-group" style={{ marginTop: "1.25rem" }}>
                <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>Select Initial Channel Members</label>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem", maxHeight: "180px", overflowY: "auto" }}>
                  {pairedDrivers.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggleMemberInState(d.id)}
                      style={{
                        background: selectedMembers.has(d.id) ? "rgba(168, 85, 247, 0.25)" : "rgba(255,255,255,0.04)",
                        color: selectedMembers.has(d.id) ? "#c084fc" : "#94a3b8",
                        border: selectedMembers.has(d.id) ? "1px solid rgba(168, 85, 247, 0.5)" : "1px solid var(--line)",
                        borderRadius: "8px",
                        padding: "0.4rem 0.75rem",
                        fontSize: "0.8rem",
                        fontWeight: 700,
                        cursor: "pointer"
                      }}
                    >
                      {selectedMembers.has(d.id) ? "✓ " : "+ "} {d.displayName}
                    </button>
                  ))}
                  {pairedDrivers.length === 0 && (
                    <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No paired drivers currently available.</p>
                  )}
                </div>
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
                  disabled={busy}
                  style={{ background: "linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)", color: "#fff", border: "none", padding: "0.7rem 1.4rem", borderRadius: "10px", fontWeight: 800, boxShadow: "0 4px 14px rgba(168, 85, 247, 0.4)" }}
                >
                  {busy ? "Creating..." : "Save Channel"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
