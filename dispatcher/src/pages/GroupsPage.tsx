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
    name: String(data.name || "Group"),
    memberDriverIds: members,
    createdAt: (data.createdAt as RadioGroup["createdAt"]) ?? null,
    updatedAt: (data.updatedAt as RadioGroup["updatedAt"]) ?? null,
  };
}

export function GroupsPage() {
  const [groups, setGroups] = useState<RadioGroup[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [name, setName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(
    new Set()
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
            lastHeading:
              typeof data.lastHeading === "number" ? data.lastHeading : null,
            lastTelemetryAt: data.lastTelemetryAt ?? null,
            speedLimitKmh:
              typeof data.speedLimitKmh === "number" ? data.speedLimitKmh : null,
          };
        })
      );
    });
  }, []);

  const paired = useMemo(
    () => drivers.filter((d) => d.pairStatus === "paired"),
    [drivers]
  );

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    drivers.forEach((d) => m.set(d.id, d.displayName));
    return m;
  }, [drivers]);

  const toggleMember = (id: string) => {
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
      setError("Pick at least one driver for the group.");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeGroup(group: RadioGroup) {
    if (
      !window.confirm(
        `Delete group “${group.name}”? Drivers will lose group talk until reassigned.`
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

  return (
    <div className="page">
      <div className="page-head">
        <h1>Radio groups</h1>
        <p className="muted">
          Drivers in a group can talk peer-to-peer (Volume Up) or broadcast to
          the whole group including dispatch (Volume Down). Dispatch can broadcast
          to a group or the entire fleet from the radio map.
        </p>
      </div>

      <div className="panel">
        <h2>Create group</h2>
        <form className="form-row groups-create-form" onSubmit={createGroup}>
          <label>
            Group name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Night shift"
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Create group"}
          </button>
        </form>
        <div className="groups-member-pick">
          <p className="muted small">Members for new group</p>
          <div className="groups-member-grid">
            {paired.map((d) => (
              <label key={d.id} className="groups-member-chip">
                <input
                  type="checkbox"
                  checked={selectedMembers.has(d.id)}
                  onChange={() => toggleMember(d.id)}
                />
                {d.displayName}
              </label>
            ))}
            {paired.length === 0 && (
              <p className="muted">No paired drivers yet.</p>
            )}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Members</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No groups yet. Create one to enable driver-to-driver radio.
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <tr key={g.id}>
                <td>
                  <strong>{g.name}</strong>
                </td>
                <td>
                  <div className="groups-member-grid">
                    {paired.map((d) => (
                      <label key={d.id} className="groups-member-chip">
                        <input
                          type="checkbox"
                          checked={g.memberDriverIds.includes(d.id)}
                          disabled={busy}
                          onChange={() => void toggleGroupMember(g, d.id)}
                        />
                        {d.displayName}
                      </label>
                    ))}
                  </div>
                  {g.memberDriverIds.length === 0 && (
                    <span className="muted">No members</span>
                  )}
                  {g.memberDriverIds.length > 0 && (
                    <p className="muted small">
                      {g.memberDriverIds
                        .map((id) => nameById.get(id) ?? id)
                        .join(", ")}
                    </p>
                  )}
                </td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="ghost danger-ghost"
                    disabled={busy}
                    onClick={() => void removeGroup(g)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
