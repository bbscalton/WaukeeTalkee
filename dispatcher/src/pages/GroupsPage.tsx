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
    <div className="manga-page">
      <div className="manga-hero">
        <div>
          <div className="manga-hero-meta">
            <span className="manga-chip manga-chip--info">Radio Channel Command</span>
            <span className="manga-hero-note">
              Hardware PTT Override: <strong>Volume Down</strong>
            </span>
          </div>
          <h1 className="manga-title">📻 Peer-to-Peer & Group Channels</h1>
          <p className="manga-lead">
            Configure driver talkgroups, hardware push-to-talk volume keys, and channel broadcast targets.
          </p>
        </div>

        <button
          type="button"
          className="manga-btn manga-btn-primary"
          onClick={() => setShowCreateModal(true)}
        >
          + Create Radio Channel
        </button>
      </div>

      <div className="manga-kpi-grid">
        <div className="manga-kpi manga-kpi--info">
          <div className="manga-kpi-label">Active Radio Channels</div>
          <div className="manga-kpi-value">{groups.length}</div>
        </div>

        <div className="manga-kpi manga-kpi--ok">
          <div className="manga-kpi-label">On-Duty In Channels</div>
          <div className="manga-kpi-value">{totalOnDutyInGroups}</div>
        </div>

        <div className="manga-kpi">
          <div className="manga-kpi-label">Assigned Fleet Drivers</div>
          <div className="manga-kpi-value">{totalMembersAssigned}</div>
        </div>

        <div className="manga-kpi manga-kpi--warn">
          <div className="manga-kpi-label">Peer Talk Mode</div>
          <div className="manga-kpi-value" style={{ fontSize: "1.4rem" }}>VOLUME UP 🔊</div>
        </div>
      </div>

      <div className="manga-console">
        <div className="manga-toolbar">
          <h2>Fleet Channels & Driver Talkgroups ({filteredGroups.length})</h2>

          <div className="manga-filter-row">
            <input
              type="text"
              placeholder="🔍 Search channels..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div className="manga-banner" style={{ marginBottom: "1rem" }}>
            <p style={{ margin: 0, color: "#ff6b6b", fontWeight: 700 }}>{error}</p>
          </div>
        )}

        {/* Group Cards Grid */}
        {filteredGroups.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3.5rem 1rem" }}>
            <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>📻</div>
            <div className="manga-title" style={{ fontSize: "1.2rem" }}>No Radio Channels Found</div>
            <p className="manga-lead">
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
                  className="manga-console"
                  style={{ marginBottom: 0, display: "flex", flexDirection: "column", justifyContent: "space-between" }}
                >
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ fontSize: "1.4rem" }}>📻</span>
                          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>{g.name}</h2>
                        </div>
                        <div className="manga-hero-note" style={{ marginTop: "0.2rem" }}>
                          {members.length} Drivers Assigned · <strong className="manga-kpi--ok">{onDutyCount} On-Duty</strong>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="manga-btn manga-btn-primary"
                        style={{ padding: "0.4rem 0.8rem", fontSize: "0.75rem" }}
                        onClick={() => handleBroadcastToGroup(g)}
                      >
                        📢 PTT Broadcast
                      </button>
                    </div>

                    <div style={{ marginTop: "1rem" }}>
                      <div className="manga-kpi-label" style={{ marginBottom: "0.5rem" }}>
                        Assign Channel Members:
                      </div>

                      <div className="manga-filter-row" style={{ maxHeight: "180px", overflowY: "auto" }}>
                        {pairedDrivers.map((d) => {
                          const isMember = g.memberDriverIds.includes(d.id);
                          const btnClass = isMember
                            ? d.onDuty
                              ? "manga-btn manga-btn-ok"
                              : "manga-btn manga-btn-primary"
                            : "manga-btn manga-btn-ghost";
                          return (
                            <button
                              key={d.id}
                              type="button"
                              className={btnClass}
                              style={{ padding: "0.35rem 0.65rem", fontSize: "0.75rem" }}
                              disabled={busy}
                              onClick={() => void toggleGroupMember(g, d.id)}
                            >
                              <span>{isMember ? "✓" : "+"}</span>
                              <span>{d.displayName}</span>
                              {d.onDuty && <span className="manga-chip manga-chip--ok" style={{ padding: "0 0.25rem", fontSize: "0.5rem", transform: "none", boxShadow: "none" }} aria-hidden>●</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="manga-toolbar" style={{ marginTop: "1.25rem", paddingTop: "0.75rem", borderTop: "2px solid #111", marginBottom: 0 }}>
                    <span className="manga-hero-note">
                      Channels automatically sync to mobile PTT devices
                    </span>

                    <button
                      type="button"
                      className="manga-btn manga-btn-danger"
                      style={{ padding: "0.35rem 0.75rem", fontSize: "0.75rem" }}
                      disabled={busy}
                      onClick={() => void removeGroup(g)}
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

      {showCreateModal && (
        <div className="manga-modal-backdrop">
          <div className="manga-modal" style={{ maxWidth: "540px" }}>
            <div className="manga-toolbar" style={{ marginBottom: "0.75rem" }}>
              <h2>Create New Radio Channel</h2>
              <button type="button" className="manga-btn manga-btn-ghost" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>

            <form onSubmit={createGroup}>
              <div className="form-group">
                <label>Channel Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Haul Route Alpha / Night Patrol"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="manga-filter-row" style={{ marginTop: "0.75rem" }}>
                <span className="manga-hero-note">Presets:</span>
                {["Hauling Division", "Night Shift Patrol", "Site Operations", "Emergency Response"].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="manga-btn manga-btn-ghost"
                    style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                    onClick={() => setName(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <div className="form-group" style={{ marginTop: "1.25rem" }}>
                <label>Select Initial Channel Members</label>

                <div className="manga-filter-row" style={{ marginTop: "0.5rem", maxHeight: "180px", overflowY: "auto" }}>
                  {pairedDrivers.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`manga-btn ${selectedMembers.has(d.id) ? "manga-btn-primary" : "manga-btn-ghost"}`}
                      style={{ fontSize: "0.8rem" }}
                      onClick={() => toggleMemberInState(d.id)}
                    >
                      {selectedMembers.has(d.id) ? "✓ " : "+ "} {d.displayName}
                    </button>
                  ))}
                  {pairedDrivers.length === 0 && (
                    <p className="manga-hero-note">No paired drivers currently available.</p>
                  )}
                </div>
              </div>

              <div className="manga-filter-row" style={{ marginTop: "1.5rem", justifyContent: "flex-end" }}>
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
