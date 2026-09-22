import { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import {
  type Driver,
  type RadioRequest,
  type RadioRequestStatus,
  type RadioClip,
} from "../types";
import { useSolutionProfile } from "../useSolutionProfile";
import { playClipAudio, parseRadioClip } from "../radio";
import { createDirectRadioRequest, createBroadcastRadioRequests } from "../radioRequests";

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

function mapRequest(id: string, data: Record<string, unknown>): RadioRequest {
  const statusRaw = String(data.status || "pending");
  const status: RadioRequestStatus =
    statusRaw === "responded" || statusRaw === "expired"
      ? statusRaw
      : "pending";
  const kindRaw = String(data.kind || "direct");
  return {
    id,
    kind: kindRaw === "broadcast" ? "broadcast" : "direct",
    driverId: String(data.driverId || ""),
    driverName: String(data.driverName || "Driver"),
    outboundClipId: String(data.outboundClipId || ""),
    replyClipId: data.replyClipId ? String(data.replyClipId) : null,
    status,
    createdAt: (data.createdAt as RadioRequest["createdAt"]) ?? null,
    expiresAt: (data.expiresAt as RadioRequest["expiresAt"]) ?? null,
    respondedAt: (data.respondedAt as RadioRequest["respondedAt"]) ?? null,
    broadcastBatchId: data.broadcastBatchId
      ? String(data.broadcastBatchId)
      : null,
    groupId: data.groupId ? String(data.groupId) : null,
  };
}

function effectiveStatus(req: RadioRequest, nowSeconds: number): RadioRequestStatus {
  if (req.status !== "pending") return req.status;
  if (!req.expiresAt || typeof req.expiresAt.seconds !== "number") {
    return req.status;
  }
  if (nowSeconds > req.expiresAt.seconds) return "expired";
  return "pending";
}

function formatFullTimestamp(ts: { seconds: number; nanoseconds: number } | null): string {
  if (!ts || typeof ts.seconds !== "number") return "—";
  const date = new Date(ts.seconds * 1000);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatTimeOnly(ts: { seconds: number; nanoseconds: number } | null): string {
  if (!ts || typeof ts.seconds !== "number") return "—";
  return new Date(ts.seconds * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function computeResponseTimeSeconds(req: RadioRequest): number | null {
  if (!req.createdAt || !req.respondedAt) return null;
  if (typeof req.createdAt.seconds !== "number" || typeof req.respondedAt.seconds !== "number") return null;
  const diff = req.respondedAt.seconds - req.createdAt.seconds;
  return diff >= 0 ? diff : null;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function RequestResponsePage() {
  const { label } = useSolutionProfile();

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [requests, setRequests] = useState<RadioRequest[]>([]);
  const [clips, setClips] = useState<Map<string, RadioClip>>(new Map());
  const [driverFilter, setDriverFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Live Ticker for SLA Expiration Timers
  const [nowSeconds, setNowSeconds] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  // Multi-selection state for cleanup
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // New Request Modal State
  const [showModal, setShowModal] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [requestKind, setRequestKind] = useState<"direct" | "broadcast">("direct");
  const [submitting, setSubmitting] = useState(false);

  // Audio Playback State
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);

  useEffect(() => {
    if (!ORG_ID) return;
    return onSnapshot(collection(db, "orgs", ORG_ID, "drivers"), (snap) => {
      setDrivers(
        snap.docs.map((d) => mapDriver(d.id, d.data() as Record<string, unknown>))
      );
    });
  }, []);

  useEffect(() => {
    if (!ORG_ID) return;
    const base = collection(db, "orgs", ORG_ID, "radioRequests");
    const q = driverFilter
      ? query(
          base,
          where("driverId", "==", driverFilter),
          orderBy("createdAt", "desc")
        )
      : query(base, orderBy("createdAt", "desc"));

    return onSnapshot(
      q,
      (snap) => {
        setRequests(
          snap.docs.map((d) =>
            mapRequest(d.id, d.data() as Record<string, unknown>)
          )
        );
        setError(null);
      },
      (err) => setError(err.message)
    );
  }, [driverFilter]);

  // Load clips for audio playback capability
  useEffect(() => {
    if (!ORG_ID) return;
    const q = query(
      collection(db, "orgs", ORG_ID, "radio"),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(q, (snap) => {
      const clipMap = new Map<string, RadioClip>();
      snap.docs.forEach((d) => {
        clipMap.set(d.id, parseRadioClip(d.id, d.data() as Record<string, unknown>));
      });
      setClips(clipMap);
    });
  }, []);

  const paired = useMemo(
    () =>
      [...drivers]
        .filter((d) => d.pairStatus === "paired")
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [drivers]
  );

  // Compute First Responders for Broadcast Batches
  const firstResponderMap = useMemo(() => {
    const batchMap = new Map<string, RadioRequest>();
    for (const req of requests) {
      if (req.kind === "broadcast" && req.broadcastBatchId && req.status === "responded" && req.respondedAt) {
        const existing = batchMap.get(req.broadcastBatchId);
        if (!existing || (req.respondedAt.seconds < (existing.respondedAt?.seconds ?? Infinity))) {
          batchMap.set(req.broadcastBatchId, req);
        }
      }
    }
    const result = new Set<string>();
    batchMap.forEach((req) => result.add(req.id));
    return result;
  }, [requests]);

  const rows = useMemo(() => {
    return requests.map((req) => {
      const displayStatus = effectiveStatus(req, nowSeconds);
      const latencySec = computeResponseTimeSeconds(req);
      const isFirstResponder = firstResponderMap.has(req.id);
      
      // Calculate SLA Countdown Seconds Remaining
      const remainingSlaSec = req.expiresAt && typeof req.expiresAt.seconds === "number"
        ? Math.max(0, req.expiresAt.seconds - nowSeconds)
        : 0;

      return {
        ...req,
        displayStatus,
        latencySec,
        isFirstResponder,
        remainingSlaSec,
      };
    });
  }, [requests, firstResponderMap, nowSeconds]);

  // Driver Response SLA Leaderboard Ranking
  const driverLeaderboard = useMemo(() => {
    const driverStats = new Map<string, { name: string; times: number[] }>();
    for (const r of rows) {
      if (r.displayStatus === "responded" && r.latencySec !== null) {
        const existing = driverStats.get(r.driverId) || { name: r.driverName, times: [] };
        existing.times.push(r.latencySec);
        driverStats.set(r.driverId, existing);
      }
    }
    const list = Array.from(driverStats.values()).map((item) => {
      const avgSec = Math.round(item.times.reduce((a, b) => a + b, 0) / item.times.length);
      return { name: item.name, avgSec, count: item.times.length };
    });
    return list.sort((a, b) => a.avgSec - b.avgSec).slice(0, 3);
  }, [rows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const matchesStatus =
        statusFilter === "all" ? true : r.displayStatus === statusFilter;
      const matchesKind =
        kindFilter === "all" ? true : r.kind === kindFilter;
      const matchesSearch =
        !searchQuery.trim() ||
        r.driverName.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesStatus && matchesKind && matchesSearch;
    });
  }, [rows, statusFilter, kindFilter, searchQuery]);

  // Stats Analytics Calculations
  const respondedRows = useMemo(() => rows.filter((r) => r.displayStatus === "responded" && r.latencySec !== null), [rows]);
  const avgResponseTimeSec = useMemo(() => {
    if (respondedRows.length === 0) return null;
    const total = respondedRows.reduce((acc, r) => acc + (r.latencySec || 0), 0);
    return Math.round(total / respondedRows.length);
  }, [respondedRows]);

  const pendingCount = rows.filter((r) => r.displayStatus === "pending").length;
  const expiredCount = rows.filter((r) => r.displayStatus === "expired").length;
  const totalCount = rows.length;
  const responseRate = totalCount > 0 ? Math.round((respondedRows.length / totalCount) * 100) : 0;

  // Multi-selection handlers
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRows.map((r) => r.id)));
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

  // Cleanup Functions
  const deleteSingleRequest = async (id: string) => {
    if (!ORG_ID) return;
    try {
      await deleteDoc(doc(db, "orgs", ORG_ID, "radioRequests", id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err: any) {
      alert("Failed to delete request record: " + err.message);
    }
  };

  const deleteBatchRequests = async (ids: string[]) => {
    if (!ORG_ID || ids.length === 0) return;
    try {
      const batch = writeBatch(db);
      ids.slice(0, 500).forEach((id) => {
        batch.delete(doc(db, "orgs", ORG_ID, "radioRequests", id));
      });
      await batch.commit();
      setSelectedIds(new Set());
    } catch (err: any) {
      alert("Failed to purge requests: " + err.message);
    }
  };

  const handleClearSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected request record(s)?`)) return;
    await deleteBatchRequests([...selectedIds]);
  };

  const handleClearExpired = async () => {
    const expiredIds = rows.filter((r) => r.displayStatus === "expired").map((r) => r.id);
    if (expiredIds.length === 0) {
      alert("No expired requests to clean up.");
      return;
    }
    if (!confirm(`Clean up all ${expiredIds.length} expired (unanswered) request record(s)?`)) return;
    await deleteBatchRequests(expiredIds);
  };

  const handleClearResponded = async () => {
    const respondedIds = rows.filter((r) => r.displayStatus === "responded").map((r) => r.id);
    if (respondedIds.length === 0) {
      alert("No completed responded requests to clean up.");
      return;
    }
    if (!confirm(`Clean up all ${respondedIds.length} completed responded request record(s)?`)) return;
    await deleteBatchRequests(respondedIds);
  };

  const handleClearAllHistory = async () => {
    if (rows.length === 0) return;
    if (!confirm(`⚠️ PURGE ALL HISTORY: Are you sure you want to delete ALL ${rows.length} request/response logs from the database?`)) return;
    await deleteBatchRequests(rows.map((r) => r.id));
  };

  const handleNudgeDriver = async (req: RadioRequest) => {
    try {
      await createDirectRadioRequest(req.driverId, req.driverName, "dispatch_nudge_request");
      alert(`⚡ Urgent SLA Nudge radio alert re-dispatched to ${req.driverName}!`);
    } catch (err: any) {
      alert("Failed to nudge driver: " + err.message);
    }
  };

  const handlePlayClip = (clipId: string) => {
    const clip = clips.get(clipId);
    if (!clip) {
      alert("Audio clip buffer no longer available in retention window.");
      return;
    }
    setPlayingClipId(clipId);
    const audio = playClipAudio(clip);
    audio.onended = () => setPlayingClipId(null);
    audio.onerror = () => setPlayingClipId(null);
  };

  const handleCreateRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ORG_ID) return;

    setSubmitting(true);
    try {
      if (requestKind === "direct") {
        const driver = drivers.find((d) => d.id === selectedDriverId);
        if (!driver) {
          alert("Please select a target driver.");
          setSubmitting(false);
          return;
        }
        await createDirectRadioRequest(driver.id, driver.displayName, "dispatch_manual_request");
        alert(`⚡ Direct Push-to-Talk request sent to ${driver.displayName}. 3-minute SLA response timer started!`);
      } else {
        const onDutyDrivers = drivers.filter((d) => d.onDuty);
        if (onDutyDrivers.length === 0) {
          alert("No drivers are currently marked On-Duty for broadcast tracking.");
          setSubmitting(false);
          return;
        }
        const nameMap = new Map<string, string>();
        const clipList = onDutyDrivers.map((d) => {
          nameMap.set(d.id, d.displayName);
          return { driverId: d.id, clipId: "dispatch_broadcast_request" };
        });
        const batchId = `batch_${Date.now()}`;
        const createdCount = await createBroadcastRadioRequests(clipList, nameMap, batchId);
        alert(`📢 Fleet Broadcast Request sent to ${createdCount} on-duty drivers! First responder will be tracked live.`);
      }
      setShowModal(false);
    } catch (err: any) {
      alert("Failed to issue request: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: "1.5rem", maxWidth: "1450px", margin: "0 auto", color: "var(--ink)" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ background: "rgba(59, 130, 246, 0.2)", color: "#60a5fa", border: "1px solid rgba(59, 130, 246, 0.4)", padding: "0.2rem 0.6rem", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase" }}>
              SLA Telemetry Command Center
            </span>
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              Active SLA Target: <strong>3 Minutes (180s)</strong>
            </span>
          </div>
          <h1 style={{ margin: "0.4rem 0 0 0", fontSize: "2.1rem", color: "#fff", fontWeight: 800 }}>
            ⚡ {label("requestResponse")} Tactical Hub
          </h1>
          <p style={{ margin: "0.3rem 0 0 0", color: "var(--muted)", fontSize: "0.95rem" }}>
            Monitor real-time SLA countdowns, first-responder rankings, audio clip replays, and purge history.
          </p>
        </div>

        {/* Top Header Buttons: Issue New Request & Bulk Cleanup Dropdown */}
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button
              onClick={handleClearExpired}
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                color: "#ef4444",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                fontWeight: 700,
                padding: "0.6rem 0.9rem",
                borderRadius: "10px",
                fontSize: "0.8rem",
                cursor: "pointer"
              }}
              title="Clean up all expired unanswered requests"
            >
              🧹 Clear Expired ({expiredCount})
            </button>
            <button
              onClick={handleClearResponded}
              style={{
                background: "rgba(34, 197, 94, 0.15)",
                color: "#4ade80",
                border: "1px solid rgba(34, 197, 94, 0.4)",
                fontWeight: 700,
                padding: "0.6rem 0.9rem",
                borderRadius: "10px",
                fontSize: "0.8rem",
                cursor: "pointer"
              }}
              title="Clean up all completed responded requests"
            >
              🧹 Clear Responded ({respondedRows.length})
            </button>
          </div>

          <button
            onClick={() => setShowModal(true)}
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
            + Issue New Radio Request
          </button>
        </div>
      </div>

      {/* Analytics KPI Dashboard & Driver Leaderboard Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "1.25rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        
        {/* Left: 4 KPI Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
          <div style={{ background: "rgba(59, 130, 246, 0.12)", border: "1px solid rgba(59, 130, 246, 0.3)", borderRadius: "12px", padding: "1.1rem" }}>
            <div style={{ fontSize: "0.85rem", color: "#60a5fa", fontWeight: 700 }}>Average Response SLA</div>
            <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>
              {avgResponseTimeSec !== null ? formatDuration(avgResponseTimeSec) : "—"}
            </div>
          </div>

          <div style={{ background: pendingCount > 0 ? "rgba(245, 158, 11, 0.12)" : "rgba(255, 255, 255, 0.03)", border: pendingCount > 0 ? "1px solid rgba(245, 158, 11, 0.4)" : "1px solid var(--line)", borderRadius: "12px", padding: "1.1rem" }}>
            <div style={{ fontSize: "0.85rem", color: pendingCount > 0 ? "#f59e0b" : "var(--muted)", fontWeight: 700 }}>Active Pending SLA</div>
            <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{pendingCount}</div>
          </div>

          <div style={{ background: "rgba(34, 197, 94, 0.12)", border: "1px solid rgba(34, 197, 94, 0.3)", borderRadius: "12px", padding: "1.1rem" }}>
            <div style={{ fontSize: "0.85rem", color: "#4ade80", fontWeight: 700 }}>Fleet SLA Compliance</div>
            <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{responseRate}%</div>
          </div>

          <div style={{ background: "rgba(239, 68, 68, 0.12)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "12px", padding: "1.1rem" }}>
            <div style={{ fontSize: "0.85rem", color: "#f87171", fontWeight: 700 }}>SLA Expired Requests</div>
            <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{expiredCount}</div>
          </div>
        </div>

        {/* Right: Driver SLA Leaderboard */}
        <div style={{ background: "rgba(168, 85, 247, 0.12)", border: "1px solid rgba(168, 85, 247, 0.3)", borderRadius: "14px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "#c084fc", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
            🏆 Fastest SLA Responders
          </div>

          {driverLeaderboard.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No completed response SLA data yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {driverLeaderboard.map((item, idx) => (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(0,0,0,0.25)", padding: "0.45rem 0.75rem", borderRadius: "8px" }}>
                  <div style={{ fontWeight: 800, color: "#fff", fontSize: "0.85rem" }}>
                    {idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉"} {item.name}
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "#4ade80", fontWeight: 800 }}>
                    ⚡ {formatDuration(item.avgSec)} <span style={{ color: "var(--muted)", fontWeight: 500 }}>({item.count} replies)</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Audio Playback Glowing Banner */}
      {playingClipId && (
        <div style={{ background: "linear-gradient(90deg, rgba(34, 197, 94, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%)", border: "1px solid rgba(34, 197, 94, 0.5)", borderRadius: "12px", padding: "0.75rem 1.25rem", marginBottom: "1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ fontSize: "1.5rem" }}>🔊</span>
            <div>
              <div style={{ fontWeight: 800, color: "#fff", fontSize: "0.9rem" }}>Playing Radio Audio Clip Payload...</div>
              <div style={{ fontSize: "0.75rem", color: "#4ade80" }}>Audio streaming active from retention archive</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "3px", height: "20px", alignItems: "center" }}>
            {[40, 80, 60, 100, 50, 90, 70, 40, 85].map((h, i) => (
              <div key={i} style={{ width: "4px", height: `${h}%`, background: "#4ade80", borderRadius: "2px" }} />
            ))}
          </div>
        </div>
      )}

      {/* Main Table Container */}
      <div style={{ background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(12px)", border: "1px solid var(--line)", borderRadius: "16px", padding: "1.25rem" }}>
        
        {/* Controls Toolbar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            {/* Driver Filter */}
            <select
              value={driverFilter}
              onChange={(e) => setDriverFilter(e.target.value)}
              style={{
                padding: "0.55rem 0.9rem",
                borderRadius: "8px",
                background: "rgba(0,0,0,0.3)",
                color: "#fff",
                border: "1px solid var(--line)",
                fontSize: "0.85rem"
              }}
            >
              <option value="">All Drivers</option>
              {paired.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.displayName} {d.onDuty ? "· On Duty" : ""}
                </option>
              ))}
            </select>

            {/* Status Filter */}
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
              <option value="all">All Statuses</option>
              <option value="responded">✅ Responded</option>
              <option value="pending">⏳ Pending SLA</option>
              <option value="expired">❌ Expired (No Reply)</option>
            </select>

            {/* Kind Filter */}
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              style={{
                padding: "0.55rem 0.9rem",
                borderRadius: "8px",
                background: "rgba(0,0,0,0.3)",
                color: "#fff",
                border: "1px solid var(--line)",
                fontSize: "0.85rem"
              }}
            >
              <option value="all">All Request Types</option>
              <option value="direct">Direct PTT Callout</option>
              <option value="broadcast">Fleet Broadcast</option>
            </select>
          </div>

          {/* Search Input & Multi-Delete Actions */}
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            {selectedIds.size > 0 && (
              <button
                onClick={handleClearSelected}
                style={{
                  background: "#ef4444",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  padding: "0.55rem 0.9rem",
                  fontSize: "0.85rem",
                  fontWeight: 800,
                  cursor: "pointer"
                }}
              >
                🗑️ Delete Selected ({selectedIds.size})
              </button>
            )}

            <button
              onClick={handleClearAllHistory}
              style={{
                background: "rgba(255,255,255,0.05)",
                color: "#94a3b8",
                border: "1px solid var(--line)",
                borderRadius: "8px",
                padding: "0.55rem 0.8rem",
                fontSize: "0.8rem",
                cursor: "pointer"
              }}
              title="Purge all request records from database"
            >
              ⚠️ Purge All History
            </button>

            <input
              type="text"
              placeholder="🔍 Search driver name..."
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
        </div>

        {error && <p style={{ color: "#ef4444", marginBottom: "1rem" }}>{error}</p>}

        {/* Requests Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 0.5rem" }}>
            <thead>
              <tr style={{ color: "var(--muted)", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <th style={{ padding: "0.75rem 0.5rem", width: "40px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={filteredRows.length > 0 && selectedIds.size === filteredRows.length}
                    onChange={toggleSelectAll}
                    style={{ cursor: "pointer" }}
                  />
                </th>
                <th style={{ padding: "0.75rem 1rem" }}>Driver</th>
                <th style={{ padding: "0.75rem 1rem" }}>Type</th>
                <th style={{ padding: "0.75rem 1rem" }}>Request Sent At</th>
                <th style={{ padding: "0.75rem 1rem" }}>Response Received</th>
                <th style={{ padding: "0.75rem 1rem" }}>SLA Response Time</th>
                <th style={{ padding: "0.75rem 1rem" }}>Live Status / SLA Timer</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "3.5rem", color: "var(--muted)" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>🧹</div>
                    <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#fff" }}>Request Log Clean</div>
                    <p style={{ margin: "0.4rem 0 0 0", fontSize: "0.85rem" }}>
                      No request records found. Dispatch a new radio request to track telemetry.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredRows.map((req) => {
                  const isResponded = req.displayStatus === "responded";
                  const isPending = req.displayStatus === "pending";
                  const isSelected = selectedIds.has(req.id);

                  return (
                    <tr
                      key={req.id}
                      style={{
                        background: isSelected
                          ? "rgba(59, 130, 246, 0.2)"
                          : req.isFirstResponder
                          ? "rgba(245, 158, 11, 0.12)"
                          : isResponded
                          ? "rgba(34, 197, 94, 0.05)"
                          : isPending
                          ? "rgba(59, 130, 246, 0.05)"
                          : "rgba(255, 255, 255, 0.02)",
                        borderLeft: req.isFirstResponder
                          ? "4px solid #f59e0b"
                          : isResponded
                          ? "4px solid #22c55e"
                          : isPending
                          ? "4px solid #3b82f6"
                          : "4px solid #64748b",
                        borderRadius: "8px"
                      }}
                    >
                      {/* Checkbox */}
                      <td style={{ padding: "0.85rem 0.5rem", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(req.id)}
                          style={{ cursor: "pointer" }}
                        />
                      </td>

                      {/* Driver */}
                      <td style={{ padding: "0.85rem 1rem", fontWeight: 700, color: "#fff" }}>
                        {req.driverName}
                        {req.isFirstResponder && (
                          <div style={{ fontSize: "0.7rem", color: "#f59e0b", fontWeight: 800, marginTop: "0.1rem" }}>
                            🏆 FIRST RESPONDER
                          </div>
                        )}
                      </td>

                      {/* Type */}
                      <td style={{ padding: "0.85rem 1rem" }}>
                        <span style={{
                          padding: "0.2rem 0.55rem",
                          borderRadius: "6px",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          background: req.kind === "broadcast" ? "rgba(168, 85, 247, 0.2)" : "rgba(59, 130, 246, 0.2)",
                          color: req.kind === "broadcast" ? "#c084fc" : "#60a5fa"
                        }}>
                          {req.kind === "broadcast" ? "📢 Fleet Broadcast" : "🎙️ Direct Call"}
                        </span>
                      </td>

                      {/* Request Sent At */}
                      <td style={{ padding: "0.85rem 1rem", fontSize: "0.85rem", color: "#e2e8f0" }}>
                        <div>{formatFullTimestamp(req.createdAt)}</div>
                      </td>

                      {/* Response Received */}
                      <td style={{ padding: "0.85rem 1rem", fontSize: "0.85rem", color: isResponded ? "#4ade80" : "var(--muted)" }}>
                        {isResponded ? (
                          <div>{formatTimeOnly(req.respondedAt)}</div>
                        ) : isPending ? (
                          <span style={{ color: "#f59e0b", fontWeight: 600 }}>⏳ Awaiting Driver...</span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>

                      {/* SLA Response Time */}
                      <td style={{ padding: "0.85rem 1rem" }}>
                        {req.latencySec !== null ? (
                          <span style={{
                            padding: "0.25rem 0.6rem",
                            borderRadius: "6px",
                            fontSize: "0.8rem",
                            fontWeight: 800,
                            background: req.latencySec < 45 ? "rgba(34, 197, 94, 0.2)" : "rgba(245, 158, 11, 0.2)",
                            color: req.latencySec < 45 ? "#4ade80" : "#f59e0b"
                          }}>
                            ⚡ {formatDuration(req.latencySec)}
                          </span>
                        ) : (
                          <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>—</span>
                        )}
                      </td>

                      {/* Status / Live SLA Countdown */}
                      <td style={{ padding: "0.85rem 1rem" }}>
                        {isResponded ? (
                          <span style={{ color: "#22c55e", fontWeight: 700, fontSize: "0.85rem" }}>
                            ✅ Confirmed Responded
                          </span>
                        ) : isPending ? (
                          <div>
                            <span style={{ color: "#3b82f6", fontWeight: 800, fontSize: "0.85rem" }}>
                              ⏳ Pending SLA
                            </span>
                            <div style={{ fontSize: "0.72rem", color: "#f59e0b", fontWeight: 800, marginTop: "0.1rem" }}>
                              ⏱️ {formatDuration(req.remainingSlaSec)} remaining
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: "#ef4444", fontWeight: 600, fontSize: "0.85rem" }}>
                            ❌ Expired (No Reply)
                          </span>
                        )}
                      </td>

                      {/* Audio Playback, Nudge & Clear */}
                      <td style={{ padding: "0.85rem 1rem", textAlign: "right" }}>
                        <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end", alignItems: "center" }}>
                          {isPending && (
                            <button
                              onClick={() => handleNudgeDriver(req)}
                              style={{
                                background: "rgba(245, 158, 11, 0.18)",
                                color: "#f59e0b",
                                border: "1px solid rgba(245, 158, 11, 0.4)",
                                borderRadius: "6px",
                                padding: "0.35rem 0.6rem",
                                fontSize: "0.75rem",
                                fontWeight: 800,
                                cursor: "pointer"
                              }}
                              title="Resend PTT callout nudge to driver"
                            >
                              ⚡ Nudge
                            </button>
                          )}

                          {req.replyClipId ? (
                            <button
                              onClick={() => handlePlayClip(req.replyClipId!)}
                              style={{
                                background: playingClipId === req.replyClipId ? "#22c55e" : "rgba(255,255,255,0.08)",
                                color: playingClipId === req.replyClipId ? "#000" : "#fff",
                                border: "1px solid var(--line)",
                                borderRadius: "6px",
                                padding: "0.35rem 0.65rem",
                                fontSize: "0.75rem",
                                fontWeight: 700,
                                cursor: "pointer"
                              }}
                            >
                              {playingClipId === req.replyClipId ? "🔊 Playing..." : "🔊 Play Reply"}
                            </button>
                          ) : req.outboundClipId ? (
                            <button
                              onClick={() => handlePlayClip(req.outboundClipId)}
                              style={{
                                background: playingClipId === req.outboundClipId ? "#3b82f6" : "rgba(255,255,255,0.05)",
                                color: "#fff",
                                border: "1px solid var(--line)",
                                borderRadius: "6px",
                                padding: "0.35rem 0.65rem",
                                fontSize: "0.75rem",
                                cursor: "pointer"
                              }}
                            >
                              {playingClipId === req.outboundClipId ? "🔊 Playing..." : "🎙️ Audio"}
                            </button>
                          ) : null}

                          <button
                            onClick={() => deleteSingleRequest(req.id)}
                            style={{
                              background: "rgba(239, 68, 68, 0.12)",
                              color: "#ef4444",
                              border: "1px solid rgba(239, 68, 68, 0.3)",
                              borderRadius: "6px",
                              padding: "0.35rem 0.6rem",
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              cursor: "pointer"
                            }}
                            title="Delete request log"
                          >
                            🗑️ Clear
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

      {/* New Request Modal */}
      {showModal && (
        <div className="modal" style={{ display: "flex" }}>
          <div className="modal-content" style={{ maxWidth: "520px", width: "90%", background: "#0f172a", border: "1px solid var(--line)", borderRadius: "16px", padding: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, color: "#fff", fontSize: "1.3rem", fontWeight: 800 }}>Issue Dispatch Radio Request</h3>
              <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: "1.4rem", cursor: "pointer" }}>✕</button>
            </div>

            <form onSubmit={handleCreateRequestSubmit}>
              <div className="form-group">
                <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>Request Target</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "0.4rem" }}>
                  <button
                    type="button"
                    onClick={() => setRequestKind("direct")}
                    style={{
                      background: requestKind === "direct" ? "#3b82f6" : "rgba(255,255,255,0.05)",
                      color: "#fff",
                      border: "1px solid var(--line)",
                      padding: "0.6rem",
                      borderRadius: "8px",
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    🎙️ Direct Driver Callout
                  </button>
                  <button
                    type="button"
                    onClick={() => setRequestKind("broadcast")}
                    style={{
                      background: requestKind === "broadcast" ? "#a855f7" : "rgba(255,255,255,0.05)",
                      color: "#fff",
                      border: "1px solid var(--line)",
                      padding: "0.6rem",
                      borderRadius: "8px",
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    📢 Fleet Broadcast
                  </button>
                </div>
              </div>

              {requestKind === "direct" && (
                <div className="form-group" style={{ marginTop: "1rem" }}>
                  <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>Select Target Driver</label>
                  <select
                    required
                    value={selectedDriverId}
                    onChange={(e) => setSelectedDriverId(e.target.value)}
                    style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", background: "#1e293b", color: "#fff", border: "1px solid var(--line)", marginTop: "0.4rem" }}
                  >
                    <option value="">Select a paired driver...</option>
                    {paired.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.displayName} {d.onDuty ? "· On Duty" : "· Off Duty"}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {requestKind === "broadcast" && (
                <div style={{ background: "rgba(168, 85, 247, 0.15)", border: "1px solid rgba(168, 85, 247, 0.4)", padding: "0.75rem", borderRadius: "10px", marginTop: "1rem", fontSize: "0.85rem", color: "#c084fc" }}>
                  📢 Fleet broadcast will send an urgent radio check-in call to all on-duty drivers. The first driver to reply will be logged as 🏆 <strong>First Responder</strong>.
                </div>
              )}

              <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{ background: "rgba(255,255,255,0.08)", color: "#cbd5e1", border: "1px solid var(--line)", padding: "0.7rem 1.25rem", borderRadius: "10px", fontWeight: 700 }}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)", color: "#fff", border: "none", padding: "0.7rem 1.4rem", borderRadius: "10px", fontWeight: 800, boxShadow: "0 4px 14px rgba(59, 130, 246, 0.4)" }}
                >
                  {submitting ? "Dispatching..." : "Send Radio Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
