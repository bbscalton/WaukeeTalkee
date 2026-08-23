import { type FormEvent, useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
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
    senderName: String(data.senderName || "Admin"),
    message: String(data.message || ""),
    severity: (data.severity as EmergencyBroadcast["severity"]) || "info",
    createdAt: (data.createdAt as Timestamp | null) ?? null,
  };
}

export function FamilyCirclesPage() {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [broadcasts, setBroadcasts] = useState<EmergencyBroadcast[]>([]);

  // Member form
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("Member");
  const [phone, setPhone] = useState("");

  // Broadcast form
  const [bMessage, setBMessage] = useState("");
  const [bSeverity, setBSeverity] = useState<EmergencyBroadcast["severity"]>("warning");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setBusy(false);
    }
  }

  async function toggleCheckIn(memberId: string, currentStatus: CheckInStatus) {
    setBusy(true);
    const nextStatus: CheckInStatus =
      currentStatus === "safe" ? "check_in_due" : currentStatus === "check_in_due" ? "emergency" : "safe";
    try {
      await updateDoc(doc(db, "orgs", ORG_ID, "familyMembers", memberId), {
        checkInStatus: nextStatus,
        lastCheckInAt: new Date(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update check-in");
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
      setError(err instanceof Error ? err.message : "Failed to update privacy");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteMember(memberId: string) {
    if (!confirm("Remove this member from circle?")) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "orgs", ORG_ID, "familyMembers", memberId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete member");
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
        senderName: "Dispatcher / Circle Admin",
        message: bMessage.trim(),
        severity: bSeverity,
        createdAt: new Date(),
      });
      setBMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send emergency broadcast");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Family Circles & Emergency Broadcast</h1>
        <p className="muted">
          Manage family/team circles, monitor check-in statuses, toggle location privacy, and issue emergency broadcasts.
        </p>
      </div>

      <div className="grid-2col">
        {/* Circle Members Panel */}
        <div className="panel">
          <h2>Circle Members ({members.length})</h2>

          <form onSubmit={handleAddMember} className="form-row" style={{ marginTop: "0.75rem" }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (e.g. Sarah)"
              required
            />
            <input
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              placeholder="Role (e.g. Parent, Supervisor)"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone (optional)"
            />
            <button type="submit" disabled={busy || !name.trim()}>
              + Add Member
            </button>
          </form>

          {error && <p className="error">{error}</p>}

          <table style={{ marginTop: "1rem" }}>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Check-In Status</th>
                <th>Location Sharing</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No circle members registered.
                  </td>
                </tr>
              )}
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.name}</strong>
                    {m.phone && <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{m.phone}</div>}
                  </td>
                  <td>{m.relationship}</td>
                  <td>
                    <button
                      type="button"
                      className={`pill ${m.checkInStatus === "emergency" ? "danger-badge" : ""}`}
                      onClick={() => void toggleCheckIn(m.id, m.checkInStatus)}
                      style={{ cursor: "pointer", border: "none" }}
                    >
                      {m.checkInStatus === "safe"
                        ? "🟢 Safe"
                        : m.checkInStatus === "check_in_due"
                        ? "🟡 Due"
                        : "🚨 Emergency"}
                    </button>
                    <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: "2px" }}>
                      {formatAge(m.lastCheckInAt)}
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void togglePrivacy(m.id, m.privacyLocationSharing)}
                      style={{ fontSize: "0.8rem" }}
                    >
                      {m.privacyLocationSharing ? "📍 Shared" : "🔒 Hidden"}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ghost danger"
                      onClick={() => void handleDeleteMember(m.id)}
                    >
                      Del
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Emergency Broadcast Panel */}
        <div className="panel">
          <h2>Broadcast Emergency Alert</h2>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Send instant priority notifications and emergency broadcast alerts to all members in the circle.
          </p>

          <form onSubmit={handleSendBroadcast} style={{ marginTop: "0.75rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem" }}>
              Alert Severity
              <select
                value={bSeverity}
                onChange={(e) => setBSeverity(e.target.value as EmergencyBroadcast["severity"])}
                style={{ width: "100%", marginTop: "0.25rem" }}
              >
                <option value="info">ℹ️ Information Broadcast</option>
                <option value="warning">⚠️ Warning Advisory</option>
                <option value="critical">🚨 Critical Emergency Broadcast</option>
              </select>
            </label>

            <label style={{ display: "block", marginBottom: "0.5rem" }}>
              Broadcast Message
              <textarea
                value={bMessage}
                onChange={(e) => setBMessage(e.target.value)}
                placeholder="E.g., Severe weather alert in sector 4. All units initiate immediate check-in."
                rows={3}
                style={{ width: "100%", marginTop: "0.25rem" }}
                required
              />
            </label>

            <button
              type="submit"
              className={bSeverity === "critical" ? "danger-badge" : ""}
              disabled={busy || !bMessage.trim()}
              style={{ width: "100%", padding: "0.6rem" }}
            >
              📢 Send Broadcast Alert
            </button>
          </form>

          <h3 style={{ marginTop: "1.5rem", fontSize: "0.95rem" }}>Recent Circle Broadcasts</h3>
          <div style={{ maxHeight: "220px", overflowY: "auto", marginTop: "0.5rem" }}>
            {broadcasts.length === 0 && <p className="muted">No recent broadcast history.</p>}
            {broadcasts.map((b) => (
              <div
                key={b.id}
                style={{
                  background: "#0f1319",
                  padding: "0.6rem",
                  borderRadius: "6px",
                  marginBottom: "0.5rem",
                  borderLeft: `4px solid ${
                    b.severity === "critical" ? "#d32f2f" : b.severity === "warning" ? "var(--amber)" : "#2196f3"
                  }`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                  <strong>{b.senderName}</strong>
                  <span className="muted">{formatAge(b.createdAt)}</span>
                </div>
                <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem" }}>{b.message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
