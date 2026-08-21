import { useCallback, useEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db, ORG_ID } from "../firebase";

type Props = {
  driverId: string;
  driverName: string;
};

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

export function PushToTalk({ driverId, driverName }: Props) {
  const [tx, setTx] = useState(false);
  const [rx, setRx] = useState(false);
  const [status, setStatus] = useState("Hold to talk");
  const [error, setError] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const readyAtRef = useRef(Date.now());
  const startedAtRef = useRef(0);

  const stopMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startTalk = useCallback(async () => {
    setError(null);
    if (tx || rx) return;
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
        setStatus("Sending…");
        stopMic();
        try {
          const blob = new Blob(chunksRef.current, { type: mime });
          if (blob.size < 800) {
            setStatus("Hold to talk");
            return;
          }
          if (blob.size > 700_000) {
            setError("Clip too long — keep push-to-talk under ~10 seconds.");
            setStatus("Hold to talk");
            return;
          }
          const audioBase64 = await blobToBase64(blob);
          await addDoc(collection(db, "orgs", ORG_ID, "radio"), {
            from: "dispatch",
            driverId,
            audioBase64,
            contentType: mime,
            createdAt: serverTimestamp(),
          });
          setStatus("Sent — hold to talk again");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Send failed");
          setStatus("Hold to talk");
        }
      };
      mediaRef.current = recorder;
      recorder.start();
      setTx(true);
      setStatus("TRANSMITTING — release to send");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Microphone permission needed for push-to-talk"
      );
    }
  }, [driverId, rx, tx]);

  const stopTalk = useCallback(() => {
    const rec = mediaRef.current;
    if (rec && rec.state === "recording") {
      rec.stop();
    } else {
      setTx(false);
      stopMic();
      setStatus("Hold to talk");
    }
    mediaRef.current = null;
  }, []);

  useEffect(() => {
    readyAtRef.current = Date.now();
    seenRef.current = new Set();
    setStatus("Hold to talk");
    setError(null);

    const q = query(
      collection(db, "orgs", ORG_ID, "radio"),
      where("driverId", "==", driverId),
      where("from", "==", "driver"),
      orderBy("createdAt", "desc")
    );

    return onSnapshot(q, (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type !== "added") return;
        if (seenRef.current.has(change.doc.id)) return;
        seenRef.current.add(change.doc.id);
        const data = change.doc.data();
        const created = data.createdAt?.toMillis?.() ?? 0;
        if (created && created < readyAtRef.current - 2000) return;
        const b64 = String(data.audioBase64 || "");
        const contentType = String(data.contentType || "audio/mp4");
        if (!b64) return;
        setRx(true);
        setStatus(`Receiving from ${driverName}…`);
        const audio = new Audio(`data:${contentType};base64,${b64}`);
        audioRef.current = audio;
        audio.onended = () => {
          setRx(false);
          setStatus("Hold to talk");
        };
        audio.onerror = () => {
          setRx(false);
          setStatus("Hold to talk");
          setError("Could not play driver audio");
        };
        void audio.play().catch(() => {
          setRx(false);
          setError("Click once on the page, then try again (browser blocked audio)");
          setStatus("Hold to talk");
        });
      });
    });
  }, [driverId, driverName]);

  useEffect(() => {
    return () => {
      stopMic();
      audioRef.current?.pause();
    };
  }, []);

  return (
    <div className="ptt">
      <p className={`ptt-status ${tx ? "tx" : rx ? "rx" : ""}`}>
        {tx ? "TX · LIVE" : rx ? "RX · INCOMING" : "STANDBY"}
      </p>
      <button
        type="button"
        className={`ptt-btn ${tx ? "hot" : ""}`}
        disabled={rx}
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
        {tx ? "Release to send" : "Hold to talk"}
      </button>
      <p className="muted">{status}</p>
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        Your mic → driver’s speaker. Driver answers with Volume Up.
      </p>
    </div>
  );
}
