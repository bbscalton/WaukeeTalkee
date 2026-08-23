import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import {
  formatAge,
  type CheckInStatus,
  type EmergencyBroadcast,
  type FamilyMember,
} from "../types";

function mapMember(id: string, data: Record<string, unknown>): FamilyMember {
  return {
    id,
    name: String(data.name || "Member"),
    relationship: String(data.relationship || "Member"),
    phone: String(data.phone || ""),
    checkInStatus: (data.checkInStatus as CheckInStatus) || "safe",
    lastCheckInAt: (data.lastCheckInAt as Timestamp | null) ?? null,
    privacyLocationSharing: Boolean(data.privacyLocationSharing ?? true),
    notes: String(data.notes || ""),
  };
}

function mapBroadcast(id: string, data: Record<string, unknown>): EmergencyBroadcast {
  return {
    id,
    senderName: String(data.senderName || "Circle Admin"),
    message: String(data.message || ""),
    severity: (data.severity as EmergencyBroadcast["severity"]) || "info",
    createdAt: (data.createdAt as Timestamp | null) ?? null,
  };
}

export function FamilyCirclesPage() {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [broadcasts, setBroadcasts] = useState<EmergencyBroadcast[]>([]);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAddModal, setShowAddModal] = useState(false);

  // Member Form
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("Parent");
  const [phone, setPhone] = useState("");

  // Broadcast Form
  const [bMessage, setBMessage] = useState("");
  const [bSeverity, setBSeverity] = useState<EmergencyBroadcast["severity"]>("warning");
  const [triggerSiren, setTriggerSiren] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ORG_ID) return;
    const qM = query(collection(db, "orgs", ORG_ID, "familyMembers"));
    const unsubM = onSnapshot(qM, (snap) => {
      setMembers(snap.docs.map((d) => mapMember(d.id, d.data())));
    });

    const qB = query(
      collection(db, "orgs", ORG_ID, "broadcasts"),
      orderBy("createdAt", "desc")
    );
    const unsubB = onSnapshot(qB, (snap) => {
      setBroadcasts(snap.docs.map((d) => mapBroadcast(d.id, d.data())));
    });

    return () => {
      unsubM();
      unsubB();
    };
  }, []);

  async function handleAddMember(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const id = "mem_" + Date.now();
      await setDoc(doc(db, "orgs", ORG_ID, "familyMembers", id), {
        name: name.trim(),
        relationship: relationship.trim(),
        phone: phone.trim(),
        checkInStatus: "safe",
        lastCheckInAt: new Date(),
        privacyLocationSharing: true,
        notes: "",
      });
      setName("");
      setPhone("");
      setShowAddModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setBusy(false);
    }
  }

  async function toggleCheckIn(memberId: string, currentStatus: CheckInStatus) {
    setBusy(true);
    const nextStatus: CheckInStatus =
      currentStatus === "safe"
        ? "check_in_due"
        : currentStatus === "check_in_due"
        ? "emergency"
        : "safe";

    try {
      await updateDoc(doc(db, "orgs", ORG_ID, "familyMembers", memberId), {
        checkInStatus: nextStatus,
        lastCheckInAt: new Date(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update check-in status");
    } finally {
      setBusy(false);
    }
  }

  async function togglePrivacy(memberId: string, currentPrivacy: boolean) {
    setBusy(true);
    try {
      await updateDoc(doc(db, "orgs", ORG_ID, "familyMembers", memberId), {
        privacyLocationSharing: !currentPrivacy,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update location privacy");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteMember(memberId: string, memberName: string) {
    if (!confirm(`Remove ${memberName} from this family/team safety circle?`)) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "orgs", ORG_ID, "familyMembers", memberId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendBroadcast(e: FormEvent) {
    e.preventDefault();
    if (!bMessage.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const id = "bcast_" + Date.now();
      await setDoc(doc(db, "orgs", ORG_ID, "broadcasts", id), {
        senderName: "Safety Command Center",
        message: bMessage.trim(),
        severity: bSeverity,
        createdAt: new Date(),
        triggerSiren: triggerSiren,
      });
      setBMessage("");
      alert(`📢 Emergency Broadcast dispatched! ${triggerSiren ? " (Siren Warning Activated)" : ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dispatch broadcast");
    } finally {
      setBusy(false);
    }
  }

  async function handleClearBroadcastHistory() {
    if (broadcasts.length === 0) return;
    if (!confirm(`Clear all ${broadcasts.length} emergency broadcast log(s)?`)) return;
    setBusy(true);
    try {
      const batch = writeBatch(db);
      broadcasts.forEach((b) => {
        batch.delete(doc(db, "orgs", ORG_ID, "broadcasts", b.id));
      });
      await batch.commit();
    } catch (err: any) {
      alert("Failed to clear broadcast history: " + err.message);
    } finally {
      setBusy(false);
    }
  }

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      const matchesStatus =
        statusFilter === "all"
          ? true
          : statusFilter === "emergency"
          ? m.checkInStatus === "emergency"
          : statusFilter === "check_in_due"
          ? m.checkInStatus === "check_in_due"
          : statusFilter === "safe"
          ? m.checkInStatus === "safe"
          : true;

      const matchesSearch =
        !searchQuery.trim() ||
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.relationship.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesStatus && matchesSearch;
    });
  }, [members, statusFilter, searchQuery]);

  const safeCount = members.filter((m) => m.checkInStatus === "safe").length;
  const dueCount = members.filter((m) => m.checkInStatus === "check_in_due").length;
  const emergencyCount = members.filter((m) => m.checkInStatus === "emergency").length;
  const sharingCount = members.filter((m) => m.privacyLocationSharing).length;

  return (
    <div style={{ padding: "1.5rem", maxWidth: "1400px", margin: "0 auto", color: "var(--ink)" }}>
      {/* Hero Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ background: "rgba(239, 68, 68, 0.2)", color: "#f87171", border: "1px solid rgba(239, 68, 68, 0.4)", padding: "0.2rem 0.6rem", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase" }}>
              Family & Team Safety Network
            </span>
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              Live Siren & SOS Emergency Gateway
            </span>
          </div>
          <h1 style={{ margin: "0.4rem 0 0 0", fontSize: "2rem", color: "#fff", fontWeight: 800 }}>
            🛡️ Safety Circles & Emergency Broadcast
          </h1>
          <p style={{ margin: "0.3rem 0 0 0", color: "var(--muted)", fontSize: "0.95rem" }}>
            Monitor real-time check-in statuses, toggle location privacy, and issue siren broadcasts.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          style={{
            background: "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)",
            color: "#fff",
            border: "none",
            fontWeight: 800,
            padding: "0.75rem 1.25rem",
            borderRadius: "10px",
            boxShadow: "0 4px 14px rgba(239, 68, 68, 0.4)",
            cursor: "pointer"
          }}
        >
          + Add Circle Member
        </button>
      </div>

      {/* KPI Counters */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ background: "rgba(34, 197, 94, 0.12)", border: "1px solid rgba(34, 197, 94, 0.3)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "#4ade80", fontWeight: 700 }}>Safe Members</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{safeCount}</div>
        </div>

        <div style={{ background: emergencyCount > 0 ? "rgba(239, 68, 68, 0.18)" : "rgba(255, 255, 255, 0.03)", border: emergencyCount > 0 ? "1px solid rgba(239, 68, 68, 0.5)" : "1px solid var(--line)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: emergencyCount > 0 ? "#f87171" : "var(--muted)", fontWeight: 700 }}>Active SOS Emergencies</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: emergencyCount > 0 ? "#f87171" : "#fff", marginTop: "0.2rem" }}>
            {emergencyCount > 0 ? `🚨 ${emergencyCount}` : "0"}
          </div>
        </div>

        <div style={{ background: dueCount > 0 ? "rgba(245, 158, 11, 0.12)" : "rgba(255, 255, 255, 0.03)", border: dueCount > 0 ? "1px solid rgba(245, 158, 11, 0.4)" : "1px solid var(--line)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: dueCount > 0 ? "#f59e0b" : "var(--muted)", fontWeight: 700 }}>Check-In Due</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{dueCount}</div>
        </div>

        <div style={{ background: "rgba(59, 130, 246, 0.12)", border: "1px solid rgba(59, 130, 246, 0.3)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "#60a5fa", fontWeight: 700 }}>GPS Location Sharing</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>
            {members.length > 0 ? Math.round((sharingCount / members.length) * 100) : 0}%
          </div>
        </div>
      </div>

      {/* Main Content Grid: Members (Left) + Emergency Broadcast (Right) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: "1.5rem", flexWrap: "wrap" }}>
        
        {/* Circle Members Panel */}
        <div style={{ background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(12px)", border: "1px solid var(--line)", borderRadius: "16px", padding: "1.25rem" }}>
          
          {/* Header Controls */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: "1.3rem", color: "#fff", fontWeight: 800 }}>
                Circle Members ({filteredMembers.length})
              </h2>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  padding: "0.55rem 0.9rem",
                  borderRadius: "8px",
                  background: "rgba(0,0,0,0.3)",
                  color: "#fff",
                  border: "1px solid var(--line)",
                  fontSize: "0.85rem"
                }}
              >
                <option value="all">All Check-in Statuses</option>
                <option value="safe">🟢 Safe Only</option>
                <option value="check_in_due">🟡 Check-In Due</option>
                <option value="emergency">🚨 Emergency SOS</option>
              </select>
            </div>

            <input
              type="text"
              placeholder="🔍 Search name or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: "0.55rem 0.9rem",
                borderRadius: "8px",
                background: "rgba(0,0,0,0.3)",
                color: "#fff",
                border: "1px solid var(--line)",
                fontSize: "0.85rem",
                minWidth: "200px"
              }}
            />
          </div>

          {error && <p style={{ color: "#ef4444", marginBottom: "1rem" }}>{error}</p>}

          {/* Members Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 0.5rem" }}>
              <thead>
                <tr style={{ color: "var(--muted)", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  <th style={{ padding: "0.75rem 1rem" }}>Member</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Role</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Check-In Status</th>
                  <th style={{ padding: "0.75rem 1rem" }}>GPS Sharing</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
                      No circle members registered. Click "+ Add Circle Member" to invite family or team members.
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map((m) => {
                    const isEmergency = m.checkInStatus === "emergency";
                    const isDue = m.checkInStatus === "check_in_due";

                    return (
                      <tr
                        key={m.id}
                        style={{
                          background: isEmergency
                            ? "rgba(239, 68, 68, 0.15)"
                            : isDue
                            ? "rgba(245, 158, 11, 0.08)"
                            : "rgba(255, 255, 255, 0.02)",
                          borderLeft: isEmergency
                            ? "4px solid #ef4444"
                            : isDue
                            ? "4px solid #f59e0b"
                            : "4px solid #22c55e",
                          borderRadius: "8px"
                        }}
                      >
                        {/* Member */}
                        <td style={{ padding: "0.85rem 1rem" }}>
                          <div style={{ fontWeight: 800, color: "#fff", fontSize: "0.95rem" }}>{m.name}</div>
                          {m.phone && <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.1rem" }}>📞 {m.phone}</div>}
                        </td>

                        {/* Role */}
                        <td style={{ padding: "0.85rem 1rem", fontSize: "0.85rem", color: "#cbd5e1" }}>
                          <span style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", padding: "0.2rem 0.5rem", borderRadius: "6px" }}>
                            {m.relationship}
                          </span>
                        </td>

                        {/* Check-In Status */}
                        <td style={{ padding: "0.85rem 1rem" }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void toggleCheckIn(m.id, m.checkInStatus)}
                            style={{
                              background: isEmergency
                                ? "#ef4444"
                                : isDue
                                ? "rgba(245, 158, 11, 0.25)"
                                : "rgba(34, 197, 94, 0.2)",
                              color: isEmergency
                                ? "#fff"
                                : isDue
                                ? "#f59e0b"
                                : "#4ade80",
                              border: isEmergency
                                ? "none"
                                : isDue
                                ? "1px solid rgba(245, 158, 11, 0.5)"
                                : "1px solid rgba(34, 197, 94, 0.5)",
                              borderRadius: "8px",
                              padding: "0.4rem 0.8rem",
                              fontSize: "0.8rem",
                              fontWeight: 800,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.35rem"
                            }}
                            title="Click to cycle status: Safe -> Check-In Due -> Emergency SOS"
                          >
                            <span>{isEmergency ? "🚨 EMERGENCY SOS" : isDue ? "🟡 Check-In Due" : "🟢 Safe"}</span>
                          </button>
                          <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                            {formatAge(m.lastCheckInAt)}
                          </div>
                        </td>

                        {/* GPS Privacy */}
                        <td style={{ padding: "0.85rem 1rem" }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void togglePrivacy(m.id, m.privacyLocationSharing)}
                            style={{
                              background: m.privacyLocationSharing ? "rgba(59, 130, 246, 0.2)" : "rgba(255, 255, 255, 0.05)",
                              color: m.privacyLocationSharing ? "#60a5fa" : "#94a3b8",
                              border: m.privacyLocationSharing ? "1px solid rgba(59, 130, 246, 0.4)" : "1px solid var(--line)",
                              borderRadius: "6px",
                              padding: "0.35rem 0.65rem",
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              cursor: "pointer"
                            }}
                          >
                            {m.privacyLocationSharing ? "📍 GPS Shared" : "🔒 GPS Hidden"}
                          </button>
                        </td>

                        {/* Delete Action */}
                        <td style={{ padding: "0.85rem 1rem", textAlign: "right" }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleDeleteMember(m.id, m.name)}
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
                          >
                            Remove
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

        {/* Emergency Broadcast Dispatcher */}
        <div style={{ background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(12px)", border: "1px solid var(--line)", borderRadius: "16px", padding: "1.25rem", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "1.5rem" }}>📢</span>
              <h2 style={{ margin: 0, fontSize: "1.3rem", color: "#fff", fontWeight: 800 }}>
                Emergency Broadcast
              </h2>
            </div>
            <p style={{ margin: "0 0 1.25rem 0", color: "var(--muted)", fontSize: "0.85rem" }}>
              Send instant high-priority siren alerts and SOS broadcasts to all circle devices.
            </p>

            <form onSubmit={handleSendBroadcast}>
              <div className="form-group">
                <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>Alert Severity Level</label>
                <select
                  value={bSeverity}
                  onChange={(e) => setBSeverity(e.target.value as EmergencyBroadcast["severity"])}
                  style={{ width: "100%", padding: "0.65rem", borderRadius: "8px", background: "#1e293b", color: "#fff", border: "1px solid var(--line)", marginTop: "0.3rem" }}
                >
                  <option value="info">ℹ️ Information Callout</option>
                  <option value="warning">⚠️ Warning Advisory</option>
                  <option value="critical">🚨 CRITICAL EMERGENCY SOS</option>
                </select>
              </div>

              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>Broadcast Message</label>
                <textarea
                  value={bMessage}
                  onChange={(e) => setBMessage(e.target.value)}
                  placeholder="e.g. Severe weather alert in sector 4. All members report safe status immediately."
                  rows={3}
                  required
                  style={{ width: "100%", padding: "0.65rem", borderRadius: "8px", background: "#1e293b", color: "#fff", border: "1px solid var(--line)", marginTop: "0.3rem" }}
                />
              </div>

              {/* Siren Toggle */}
              <div style={{ marginTop: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  id="sirenCheck"
                  checked={triggerSiren}
                  onChange={(e) => setTriggerSiren(e.target.checked)}
                  style={{ width: "16px", height: "16px", cursor: "pointer" }}
                />
                <label htmlFor="sirenCheck" style={{ color: "#f87171", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                  🔊 Trigger Device Police Siren Sound
                </label>
              </div>

              <button
                type="submit"
                disabled={busy || !bMessage.trim()}
                style={{
                  width: "100%",
                  marginTop: "1.25rem",
                  background: bSeverity === "critical"
                    ? "linear-gradient(135deg, #ef4444 0%, #991b1b 100%)"
                    : "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)",
                  color: "#fff",
                  border: "none",
                  padding: "0.75rem",
                  borderRadius: "10px",
                  fontWeight: 800,
                  fontSize: "0.95rem",
                  boxShadow: "0 4px 14px rgba(239, 68, 68, 0.4)",
                  cursor: "pointer"
                }}
              >
                📢 Dispatch Emergency Alert
              </button>
            </form>

            {/* Broadcast History */}
            <div style={{ marginTop: "1.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <h3 style={{ margin: 0, fontSize: "0.95rem", color: "#fff", fontWeight: 800 }}>Recent Broadcast History</h3>
                {broadcasts.length > 0 && (
                  <button
                    onClick={handleClearBroadcastHistory}
                    style={{ background: "none", border: "none", color: "#ef4444", fontSize: "0.75rem", cursor: "pointer", fontWeight: 700 }}
                  >
                    🧹 Clear History
                  </button>
                )}
              </div>

              <div style={{ maxHeight: "200px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {broadcasts.length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No recent emergency broadcast logs.</p>
                ) : (
                  broadcasts.map((b) => (
                    <div
                      key={b.id}
                      style={{
                        background: "rgba(0,0,0,0.3)",
                        padding: "0.65rem 0.8rem",
                        borderRadius: "8px",
                        borderLeft: `4px solid ${
                          b.severity === "critical" ? "#ef4444" : b.severity === "warning" ? "#f59e0b" : "#3b82f6"
                        }`
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
                        <strong style={{ color: "#fff" }}>{b.senderName}</strong>
                        <span style={{ color: "var(--muted)" }}>{formatAge(b.createdAt)}</span>
                      </div>
                      <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", color: "#cbd5e1" }}>{b.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Add Member Modal */}
      {showAddModal && (
        <div className="modal" style={{ display: "flex" }}>
          <div className="modal-content" style={{ maxWidth: "500px", width: "90%", background: "#0f172a", border: "1px solid var(--line)", borderRadius: "16px", padding: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, color: "#fff", fontSize: "1.3rem", fontWeight: 800 }}>Add Circle Member</h3>
              <button onClick={() => setShowAddModal(false)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: "1.4rem", cursor: "pointer" }}>✕</button>
            </div>

            <form onSubmit={handleAddMember}>
              <div className="form-group">
                <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>Member Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sarah Smith"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", background: "#1e293b", color: "#fff", border: "1px solid var(--line)", marginTop: "0.4rem" }}
                />
              </div>

              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>Role / Relationship</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Parent, Field Team Lead, Elder"
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", background: "#1e293b", color: "#fff", border: "1px solid var(--line)", marginTop: "0.4rem" }}
                />

                {/* Preset Roles */}
                <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                  {["Parent", "Child", "Supervisor", "Team Lead", "Emergency Contact"].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRelationship(r)}
                      style={{ background: "rgba(255,255,255,0.05)", color: "#cbd5e1", border: "1px solid var(--line)", padding: "0.2rem 0.5rem", borderRadius: "6px", fontSize: "0.75rem" }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>Phone Number (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. +1 555-0199"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", background: "#1e293b", color: "#fff", border: "1px solid var(--line)", marginTop: "0.4rem" }}
                />
              </div>

              <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{ background: "rgba(255,255,255,0.08)", color: "#cbd5e1", border: "1px solid var(--line)", padding: "0.7rem 1.25rem", borderRadius: "10px", fontWeight: 700 }}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || !name.trim()}
                  style={{ background: "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)", color: "#fff", border: "none", padding: "0.7rem 1.4rem", borderRadius: "10px", fontWeight: 800, boxShadow: "0 4px 14px rgba(239, 68, 68, 0.4)" }}
                >
                  {busy ? "Adding..." : "Add to Circle"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
