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
    <div className="manga-page">
      <div className="manga-hero">
        <div>
          <div className="manga-hero-meta">
            <span className="manga-chip manga-chip--danger">Family & Team Safety Network</span>
            <span className="manga-hero-note">Live Siren & SOS Emergency Gateway</span>
          </div>
          <h1 className="manga-title">🛡️ Safety Circles & Emergency Broadcast</h1>
          <p className="manga-lead">
            Monitor real-time check-in statuses, toggle location privacy, and issue siren broadcasts.
          </p>
        </div>

        <button
          type="button"
          className="manga-btn manga-btn-danger"
          onClick={() => setShowAddModal(true)}
        >
          + Add Circle Member
        </button>
      </div>

      <div className="manga-kpi-grid">
        <div className="manga-kpi manga-kpi--ok">
          <div className="manga-kpi-label">Safe Members</div>
          <div className="manga-kpi-value">{safeCount}</div>
        </div>

        <div className={`manga-kpi${emergencyCount > 0 ? " manga-kpi--danger" : ""}`}>
          <div className="manga-kpi-label">Active SOS Emergencies</div>
          <div className="manga-kpi-value">
            {emergencyCount > 0 ? `🚨 ${emergencyCount}` : "0"}
          </div>
        </div>

        <div className={`manga-kpi${dueCount > 0 ? " manga-kpi--warn" : ""}`}>
          <div className="manga-kpi-label">Check-In Due</div>
          <div className="manga-kpi-value">{dueCount}</div>
        </div>

        <div className="manga-kpi manga-kpi--info">
          <div className="manga-kpi-label">GPS Location Sharing</div>
          <div className="manga-kpi-value">
            {members.length > 0 ? Math.round((sharingCount / members.length) * 100) : 0}%
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: "1.5rem" }}>
        <div className="manga-console" style={{ marginBottom: 0 }}>
          <div className="manga-toolbar">
            <h2>Circle Members ({filteredMembers.length})</h2>

            <div className="manga-filter-row">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Check-in Statuses</option>
                <option value="safe">🟢 Safe Only</option>
                <option value="check_in_due">🟡 Check-In Due</option>
                <option value="emergency">🚨 Emergency SOS</option>
              </select>

              <input
                type="text"
                placeholder="🔍 Search name or role..."
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

          <div className="manga-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Check-In Status</th>
                  <th>GPS Sharing</th>
                  <th style={{ textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: "3rem" }}>
                      No circle members registered. Click "+ Add Circle Member" to invite family or team members.
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map((m) => {
                    const isEmergency = m.checkInStatus === "emergency";
                    const isDue = m.checkInStatus === "check_in_due";
                    const checkInBtnClass = isEmergency
                      ? "manga-btn manga-btn-danger"
                      : isDue
                      ? "manga-btn manga-btn-primary"
                      : "manga-btn manga-btn-ok";

                    return (
                      <tr key={m.id}>
                        <td>
                          <div style={{ fontWeight: 800 }}>{m.name}</div>
                          {m.phone && <div className="manga-hero-note" style={{ marginTop: "0.1rem" }}>📞 {m.phone}</div>}
                        </td>

                        <td>
                          <span className="manga-chip manga-chip--info">{m.relationship}</span>
                        </td>

                        <td>
                          <button
                            type="button"
                            className={checkInBtnClass}
                            style={{ fontSize: "0.8rem" }}
                            disabled={busy}
                            onClick={() => void toggleCheckIn(m.id, m.checkInStatus)}
                            title="Click to cycle status: Safe -> Check-In Due -> Emergency SOS"
                          >
                            {isEmergency ? "🚨 EMERGENCY SOS" : isDue ? "🟡 Check-In Due" : "🟢 Safe"}
                          </button>
                          <div className="manga-hero-note" style={{ marginTop: "0.25rem", fontSize: "0.72rem" }}>
                            {formatAge(m.lastCheckInAt)}
                          </div>
                        </td>

                        <td>
                          <button
                            type="button"
                            className={`manga-btn ${m.privacyLocationSharing ? "manga-btn-primary" : "manga-btn-ghost"}`}
                            style={{ fontSize: "0.75rem", padding: "0.35rem 0.65rem" }}
                            disabled={busy}
                            onClick={() => void togglePrivacy(m.id, m.privacyLocationSharing)}
                          >
                            {m.privacyLocationSharing ? "📍 GPS Shared" : "🔒 GPS Hidden"}
                          </button>
                        </td>

                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            className="manga-btn manga-btn-danger"
                            style={{ fontSize: "0.75rem", padding: "0.35rem 0.65rem" }}
                            disabled={busy}
                            onClick={() => void handleDeleteMember(m.id, m.name)}
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

        <div className="manga-console" style={{ marginBottom: 0, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="manga-hero-meta" style={{ marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "1.5rem" }}>📢</span>
              <h2 style={{ margin: 0 }}>Emergency Broadcast</h2>
            </div>
            <p className="manga-lead" style={{ marginBottom: "1.25rem", fontSize: "0.85rem" }}>
              Send instant high-priority siren alerts and SOS broadcasts to all circle devices.
            </p>

            <form onSubmit={handleSendBroadcast}>
              <div className="form-group">
                <label>Alert Severity Level</label>
                <select
                  value={bSeverity}
                  onChange={(e) => setBSeverity(e.target.value as EmergencyBroadcast["severity"])}
                >
                  <option value="info">ℹ️ Information Callout</option>
                  <option value="warning">⚠️ Warning Advisory</option>
                  <option value="critical">🚨 CRITICAL EMERGENCY SOS</option>
                </select>
              </div>

              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label>Broadcast Message</label>
                <textarea
                  value={bMessage}
                  onChange={(e) => setBMessage(e.target.value)}
                  placeholder="e.g. Severe weather alert in sector 4. All members report safe status immediately."
                  rows={3}
                  required
                />
              </div>

              <div className="manga-filter-row" style={{ marginTop: "0.75rem" }}>
                <input
                  type="checkbox"
                  id="sirenCheck"
                  checked={triggerSiren}
                  onChange={(e) => setTriggerSiren(e.target.checked)}
                />
                <label htmlFor="sirenCheck" className="manga-kpi-label manga-kpi--danger" style={{ cursor: "pointer" }}>
                  🔊 Trigger Device Police Siren Sound
                </label>
              </div>

              <button
                type="submit"
                className={`manga-btn ${bSeverity === "critical" ? "manga-btn-danger" : "manga-btn-primary"}`}
                style={{ width: "100%", marginTop: "1.25rem" }}
                disabled={busy || !bMessage.trim()}
              >
                📢 Dispatch Emergency Alert
              </button>
            </form>

            <div style={{ marginTop: "1.75rem" }}>
              <div className="manga-toolbar" style={{ marginBottom: "0.5rem" }}>
                <h2 style={{ fontSize: "0.95rem" }}>Recent Broadcast History</h2>
                {broadcasts.length > 0 && (
                  <button
                    type="button"
                    className="manga-btn manga-btn-ghost"
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                    onClick={handleClearBroadcastHistory}
                  >
                    🧹 Clear History
                  </button>
                )}
              </div>

              <div style={{ maxHeight: "200px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {broadcasts.length === 0 ? (
                  <p className="manga-hero-note">No recent emergency broadcast logs.</p>
                ) : (
                  broadcasts.map((b) => (
                    <div
                      key={b.id}
                      className="manga-console"
                      style={{
                        marginBottom: 0,
                        padding: "0.65rem 0.8rem",
                        borderLeft: `4px solid ${
                          b.severity === "critical" ? "var(--manga-accent)" : b.severity === "warning" ? "var(--amber)" : "#9ecbff"
                        }`,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
                        <strong>{b.senderName}</strong>
                        <span className="manga-hero-note">{formatAge(b.createdAt)}</span>
                      </div>
                      <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem" }}>{b.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAddModal && (
        <div className="manga-modal-backdrop">
          <div className="manga-modal" style={{ maxWidth: "500px" }}>
            <div className="manga-toolbar" style={{ marginBottom: "0.75rem" }}>
              <h2>Add Circle Member</h2>
              <button type="button" className="manga-btn manga-btn-ghost" onClick={() => setShowAddModal(false)}>✕</button>
            </div>

            <form onSubmit={handleAddMember}>
              <div className="form-group">
                <label>Member Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sarah Smith"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label>Role / Relationship</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Parent, Field Team Lead, Elder"
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                />

                <div className="manga-filter-row" style={{ marginTop: "0.5rem" }}>
                  {["Parent", "Child", "Supervisor", "Team Lead", "Emergency Contact"].map((r) => (
                    <button
                      key={r}
                      type="button"
                      className="manga-btn manga-btn-ghost"
                      style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
                      onClick={() => setRelationship(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label>Phone Number (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. +1 555-0199"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div className="manga-filter-row" style={{ marginTop: "1.5rem", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="manga-btn manga-btn-ghost"
                  onClick={() => setShowAddModal(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="manga-btn manga-btn-danger"
                  disabled={busy || !name.trim()}
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
