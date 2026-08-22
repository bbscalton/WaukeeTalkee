import { useCallback, useEffect, useRef, useState } from "react";
import { useRadioLive } from "../RadioLiveProvider";
import { createDirectRadioRequest } from "../radioRequests";
import { sendDirectToDriver } from "../radioSend";

type Props = {
  driverId: string;
  driverName: string;
  /** Optional GPS to pin this clip on Map DVR. */
  lat?: number | null;
  lng?: number | null;
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

export function PushToTalk({ driverId, driverName, lat, lng }: Props) {
  const { queue } = useRadioLive();
  const [tx, setTx] = useState(false);
  const [status, setStatus] = useState("Hold to talk");
  const [error, setError] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);

  const rx =
    queue.playing &&
    queue.current?.driverId === driverId &&
    queue.current?.source === "live";
  const audioBusy = queue.playing;

  useEffect(() => {
    if (rx) {
      setStatus(`Receiving from ${driverName}…`);
    } else if (!tx) {
      setStatus("Hold to talk");
    }
  }, [rx, driverName, tx]);

  const stopMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startTalk = useCallback(async () => {
    setError(null);
    if (tx || audioBusy) return;
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
          const durationMs = Math.max(0, Date.now() - startedAtRef.current);
          const audioBase64 = await blobToBase64(blob);
          const sendPayload = {
            driverId,
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
          const clipId = await sendDirectToDriver(sendPayload);
          await createDirectRadioRequest(driverId, driverName, clipId);
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
  }, [driverId, driverName, audioBusy, tx, lat, lng]);

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
    return () => {
      stopMic();
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
        disabled={audioBusy}
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
        Your mic → driver’s speaker. Driver answers with Volume Up. Clips kept 7 days.
      </p>
    </div>
  );
}
