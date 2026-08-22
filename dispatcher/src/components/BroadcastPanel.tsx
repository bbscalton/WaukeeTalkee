import { useCallback, useEffect, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import {
  broadcastToAllDrivers,
  broadcastToGroupMembers,
} from "../radioSend";
import { useRadioLive } from "../RadioLiveProvider";
import type { Driver, RadioGroup } from "../types";

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return "audio/webm;codecs=opus";
  }
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "audio/webm";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

type Props = {
  lat?: number | null;
  lng?: number | null;
};

export function BroadcastPanel({ lat, lng }: Props) {
  const { queue } = useRadioLive();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [groups, setGroups] = useState<RadioGroup[]>([]);
  const [target, setTarget] = useState<"all" | string>("all");
  const [tx, setTx] = useState(false);
  const [status, setStatus] = useState("Hold to broadcast");
  const [error, setError] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);

  const audioBusy = queue.playing;
  const paired = drivers.filter((d) => d.pairStatus === "paired");

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

  useEffect(() => {
    const q = query(
      collection(db, "orgs", ORG_ID, "groups"),
      orderBy("name", "asc")
    );
    return onSnapshot(q, (snap) => {
      setGroups(
        snap.docs.map((d) => ({
          id: d.id,
          name: String(d.data().name || "Group"),
          memberDriverIds: Array.isArray(d.data().memberDriverIds)
            ? (d.data().memberDriverIds as unknown[]).map(String)
            : [],
          createdAt: null,
          updatedAt: null,
        }))
      );
    });
  }, []);

  const stopMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const selectedGroup =
    target !== "all" ? groups.find((g) => g.id === target) ?? null : null;

  const recipientCount =
    target === "all"
      ? paired.length
      : (selectedGroup?.memberDriverIds.length ?? 0);

  const startTalk = useCallback(async () => {
    setError(null);
    if (tx || audioBusy) return;
    if (recipientCount < 1) {
      setError(
        target === "all"
          ? "No paired drivers to broadcast to."
          : "Group has no members."
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        setTx(false);
        setStatus("Sending broadcast…");
        stopMic();
        try {
          const blob = new Blob(chunksRef.current, { type: mime });
          if (blob.size < 800) {
            setStatus("Hold to broadcast");
            return;
          }
          if (blob.size > 700_000) {
            setError("Clip too long — keep under ~10 seconds.");
            setStatus("Hold to broadcast");
            return;
          }
          const durationMs = Math.max(0, Date.now() - startedAtRef.current);
          const audioBase64 = await blobToBase64(blob);
          const base = {
            audioBase64,
            contentType: mime,
            durationMs,
            ...(typeof lat === "number" &&
            typeof lng === "number" &&
            Number.isFinite(lat) &&
            Number.isFinite(lng)
              ? { lat, lng }
              : {}),
          };
          let sent = 0;
          if (target === "all") {
            sent = await broadcastToAllDrivers(
              paired.map((d) => d.id),
              base
            );
          } else if (selectedGroup) {
            sent = await broadcastToGroupMembers(
              selectedGroup.memberDriverIds,
              selectedGroup.id,
              base
            );
          }
          setStatus(`Broadcast sent to ${sent} driver${sent === 1 ? "" : "s"}`);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Broadcast failed");
          setStatus("Hold to broadcast");
        }
      };
      mediaRef.current = recorder;
      recorder.start();
      setTx(true);
      setStatus("BROADCASTING — release to send");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Microphone permission needed for broadcast"
      );
    }
  }, [
    audioBusy,
    lat,
    lng,
    paired,
    recipientCount,
    selectedGroup,
    target,
    tx,
  ]);

  const stopTalk = useCallback(() => {
    const rec = mediaRef.current;
    if (rec && rec.state === "recording") {
      rec.stop();
    } else {
      setTx(false);
      stopMic();
      setStatus("Hold to broadcast");
    }
    mediaRef.current = null;
  }, []);

  useEffect(() => () => stopMic(), []);

  return (
    <div className="broadcast-panel panel">
      <h3>Fleet broadcast</h3>
      <p className="muted small">
        Hold to talk to every driver or one group. Each driver hears it on their
        speaker.
      </p>
      <label>
        Broadcast to
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={tx}
        >
          <option value="all">All paired drivers ({paired.length})</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.memberDriverIds.length})
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={`ptt-btn broadcast-btn ${tx ? "hot" : ""}`}
        disabled={audioBusy || recipientCount < 1}
        onMouseDown={(e) => {
          e.preventDefault();
          void startTalk();
        }}
        onMouseUp={() => stopTalk()}
        onMouseLeave={() => {
          if (tx) stopTalk();
        }}
        onTouchStart={(e) => {
          e.preventDefault();
          void startTalk();
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          stopTalk();
        }}
      >
        {tx ? "Release to send" : "Hold to broadcast"}
      </button>
      <p className="muted">{status}</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
