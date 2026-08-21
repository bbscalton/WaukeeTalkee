import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { collection, onSnapshot } from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import {
  clipTimeMs,
  formatClipTime,
  formatDuration,
  isUnreadForDispatch,
  markDispatchHeard,
  playClipAudio,
  speakerLabel,
} from "../radio";
import { RADIO_RETENTION_DAYS, type Driver, type RadioClip } from "../types";
import { useRadioArchive } from "../useRadioArchive";
import { PushToTalk } from "../components/PushToTalk";

const emptyClip: RadioClip = {
  id: "",
  from: "dispatch",
  driverId: "",
  audioBase64: "",
  contentType: "",
  createdAt: null,
  durationMs: null,
  dispatchHeardAt: null,
  driverHeardAt: null,
};

export function RadioInboxPage() {
  const [search, setSearch] = useSearchParams();
  const selectedId = search.get("driver") || null;
  const { clips, unreadByDriver, error } = useRadioArchive();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return onSnapshot(collection(db, "orgs", ORG_ID, "drivers"), (snap) => {
      setDrivers(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            displayName: String(data.displayName || "Driver"),
            plate: data.plate ?? null,
            pairStatus: data.pairStatus === "paired" ? "paired" : "unpaired",
            deviceId: data.deviceId ?? null,
            onDuty: Boolean(data.onDuty),
            lastLat: typeof data.lastLat === "number" ? data.lastLat : null,
            lastLng: typeof data.lastLng === "number" ? data.lastLng : null,
            lastSpeed: typeof data.lastSpeed === "number" ? data.lastSpeed : null,
            lastHeading:
              typeof data.lastHeading === "number" ? data.lastHeading : null,
            lastTelemetryAt: data.lastTelemetryAt ?? null,
          };
        })
      );
    });
  }, []);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    drivers.forEach((d) => m.set(d.id, d.displayName));
    return m;
  }, [drivers]);

  const threads = useMemo(() => {
    const map = new Map<
      string,
      { driverId: string; name: string; last: RadioClip | null; unread: number; count: number }
    >();
    for (const d of drivers.filter((x) => x.pairStatus === "paired")) {
      map.set(d.id, {
        driverId: d.id,
        name: d.displayName,
        last: null,
        unread: unreadByDriver.get(d.id) ?? 0,
        count: 0,
      });
    }
    for (const c of clips) {
      let row = map.get(c.driverId);
      if (!row) {
        row = {
          driverId: c.driverId,
          name: nameById.get(c.driverId) || "Driver",
          last: null,
          unread: unreadByDriver.get(c.driverId) ?? 0,
          count: 0,
        };
        map.set(c.driverId, row);
      }
      row.count += 1;
      if (!row.last || clipTimeMs(c) > clipTimeMs(row.last)) row.last = c;
    }
    return [...map.values()].sort((a, b) => {
      if (b.unread !== a.unread) return b.unread - a.unread;
      return clipTimeMs(b.last ?? emptyClip) - clipTimeMs(a.last ?? emptyClip);
    });
  }, [clips, drivers, nameById, unreadByDriver]);

  const selected =
    threads.find((t) => t.driverId === selectedId) ?? threads[0] ?? null;

  useEffect(() => {
    if (!selectedId && selected) {
      setSearch({ driver: selected.driverId }, { replace: true });
    }
  }, [selected, selectedId, setSearch]);

  const threadClips = useMemo(() => {
    if (!selected) return [];
    return clips
      .filter((c) => c.driverId === selected.driverId)
      .sort((a, b) => clipTimeMs(b) - clipTimeMs(a));
  }, [clips, selected]);

  const play = async (clip: RadioClip) => {
    audioRef.current?.pause();
    if (!clip.audioBase64) return;
    setPlayingId(clip.id);
    const audio = playClipAudio(clip);
    audioRef.current = audio;
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
    if (isUnreadForDispatch(clip)) {
      try {
        await markDispatchHeard(clip.id);
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div className="page inbox-page">
      <div className="page-head">
        <p className="map-kicker">Radio archive</p>
        <h1>Inbox</h1>
        <p className="muted">
          Replay PTT clips and reply on channel. Kept {RADIO_RETENTION_DAYS} days.
        </p>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="inbox-layout">
        <aside className="panel inbox-threads">
          <p className="list-label">Channels</p>
          <ul className="driver-list">
            {threads.map((t) => (
              <li key={t.driverId}>
                <button
                  type="button"
                  className={selected?.driverId === t.driverId ? "selected" : ""}
                  onClick={() => setSearch({ driver: t.driverId })}
                >
                  <strong>
                    {t.name}
                    {t.unread > 0 && <span className="nav-badge">{t.unread}</span>}
                  </strong>
                  <span>
                    {t.count} clip{t.count === 1 ? "" : "s"}
                    {t.last
                      ? ` · ${speakerLabel(t.last.from, t.name)} ${formatClipTime(t.last)}`
                      : ""}
                  </span>
                  <span className="talk-hint">
                    {t.unread > 0 ? "New message" : "Open thread"}
                  </span>
                </button>
              </li>
            ))}
            {threads.length === 0 && (
              <li className="muted">No radio traffic yet. Talk from the map.</li>
            )}
          </ul>
        </aside>

        <section className="panel inbox-detail">
          {selected ? (
            <>
              <div className="inbox-detail-head">
                <div>
                  <p className="map-kicker">Thread</p>
                  <h2>{selected.name}</h2>
                </div>
                <Link className="ghost-link" to={`/map?driver=${selected.driverId}`}>
                  Open on map
                </Link>
              </div>

              <PushToTalk driverId={selected.driverId} driverName={selected.name} />

              <p className="list-label">Recordings</p>
              <ul className="clip-list">
                {threadClips.map((c) => {
                  const unread = isUnreadForDispatch(c);
                  return (
                    <li
                      key={c.id}
                      className={`clip-row ${unread ? "unread" : ""} ${
                        playingId === c.id ? "playing" : ""
                      }`}
                    >
                      <div>
                        <strong>{speakerLabel(c.from, selected.name)}</strong>
                        <span className="muted">
                          {formatClipTime(c)} · {formatDuration(c.durationMs)}
                          {unread ? " · new" : ""}
                        </span>
                      </div>
                      <button type="button" className="ghost" onClick={() => void play(c)}>
                        {playingId === c.id ? "Playing…" : "Play"}
                      </button>
                    </li>
                  );
                })}
                {threadClips.length === 0 && (
                  <li className="muted">No clips in this thread yet.</li>
                )}
              </ul>
            </>
          ) : (
            <p className="muted">Select a driver channel to replay or reply.</p>
          )}
        </section>
      </div>
    </div>
  );
}
