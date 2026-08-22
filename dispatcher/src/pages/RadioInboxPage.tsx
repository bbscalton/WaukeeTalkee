import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { collection, onSnapshot } from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import {
  audienceLabel,
  clipBelongsToThread,
  clipDescription,
  clipThreadDriverId,
  clipTimeMs,
  deleteRadioClip,
  driverHeardLabel,
  formatClipTime,
  formatDuration,
  isUnheardOutbound,
  isUnreadForDispatch,
  speakerLabel,
} from "../radio";
import { useRadioLive } from "../RadioLiveProvider";
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
  lat: null,
  lng: null,
  audience: "direct",
  senderDriverId: null,
  senderDisplayName: null,
  groupId: null,
};

export function RadioInboxPage() {
  const [search, setSearch] = useSearchParams();
  const selectedId = search.get("driver") || null;
  const { clips, unreadByDriver, unheardOutboundByDriver, error } =
    useRadioArchive();
  const { queue, enqueueManual } = useRadioLive();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [onlyUnheard, setOnlyUnheard] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const playingId = queue.current?.id ?? null;

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
            speedLimitKmh:
              typeof data.speedLimitKmh === "number"
                ? data.speedLimitKmh
                : null,
          };
        })
      );
    });
  }, []);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    drivers.forEach((d) => m.set(d.id, d.displayName));
    return m;
  }, [drivers]);

  const threads = useMemo(() => {
    const map = new Map<
      string,
      {
        driverId: string;
        name: string;
        last: RadioClip | null;
        unread: number;
        unheard: number;
        count: number;
      }
    >();
    for (const d of drivers.filter((x) => x.pairStatus === "paired")) {
      map.set(d.id, {
        driverId: d.id,
        name: d.displayName,
        last: null,
        unread: unreadByDriver.get(d.id) ?? 0,
        unheard: unheardOutboundByDriver.get(d.id) ?? 0,
        count: 0,
      });
    }
    for (const c of clips) {
      const threadId = clipThreadDriverId(c);
      let row = map.get(threadId);
      if (!row) {
        row = {
          driverId: threadId,
          name: nameById.get(threadId) || "Driver",
          last: null,
          unread: unreadByDriver.get(threadId) ?? 0,
          unheard: unheardOutboundByDriver.get(threadId) ?? 0,
          count: 0,
        };
        map.set(threadId, row);
      }
      row.count += 1;
      if (!row.last || clipTimeMs(c) > clipTimeMs(row.last)) row.last = c;
    }
    return [...map.values()].sort((a, b) => {
      if (b.unread !== a.unread) return b.unread - a.unread;
      if (b.unheard !== a.unheard) return b.unheard - a.unheard;
      return clipTimeMs(b.last ?? emptyClip) - clipTimeMs(a.last ?? emptyClip);
    });
  }, [clips, drivers, nameById, unreadByDriver, unheardOutboundByDriver]);

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
      .filter((c) => clipBelongsToThread(c, selected.driverId))
      .filter((c) => (onlyUnheard ? isUnheardOutbound(c) : true))
      .sort((a, b) => clipTimeMs(b) - clipTimeMs(a));
  }, [clips, selected, onlyUnheard]);

  const play = (clip: RadioClip) => {
    if (!clip.audioBase64 || !selected) return;
    enqueueManual(clip, selected.name);
  };

  const removeClip = async (clip: RadioClip) => {
    const who = speakerLabel(clip.from, selected?.name || "Driver");
    if (
      !window.confirm(
        `Delete this recording from ${who}? It will disappear for the driver too.`
      )
    ) {
      return;
    }
    setBusyId(clip.id);
    try {
      await deleteRadioClip(clip.id);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Could not delete recording."
      );
    } finally {
      setBusyId(null);
    }
  };

  const clearThread = async () => {
    if (!selected) return;
    const all = clips.filter((c) => clipBelongsToThread(c, selected.driverId));
    if (all.length === 0) return;
    if (
      !window.confirm(
        `Delete all ${all.length} recording${all.length === 1 ? "" : "s"} with ${selected.name}? They will disappear for the driver too.`
      )
    ) {
      return;
    }
    setBusyId("thread");
    try {
      for (const c of all) {
        await deleteRadioClip(c.id);
      }
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Could not clear thread."
      );
    } finally {
      setBusyId(null);
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
                    {t.unheard > 0
                      ? ` · ${t.unheard} unheard`
                      : t.last
                        ? ` · ${speakerLabel(t.last.from, t.name)} ${formatClipTime(t.last)}`
                        : ""}
                  </span>
                  <span className="talk-hint">
                    {t.unread > 0
                      ? "New message"
                      : t.unheard > 0
                        ? "Outbound unheard"
                        : "Open thread"}
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
                  {selected.unheard > 0 && (
                    <p className="inbox-unheard-summary muted">
                      {selected.unheard} unheard outbound
                    </p>
                  )}
                </div>
                <div className="inbox-detail-actions">
                  <Link
                    className="ghost-link"
                    to={`/map?driver=${selected.driverId}`}
                  >
                    Open on map
                  </Link>
                  {selected.count > 0 && (
                    <button
                      type="button"
                      className="ghost danger-ghost"
                      disabled={busyId === "thread"}
                      onClick={() => void clearThread()}
                    >
                      Clear thread
                    </button>
                  )}
                </div>
              </div>

              <PushToTalk
                driverId={selected.driverId}
                driverName={selected.name}
                lat={
                  drivers.find((d) => d.id === selected.driverId)?.lastLat ??
                  null
                }
                lng={
                  drivers.find((d) => d.id === selected.driverId)?.lastLng ??
                  null
                }
              />

              <div className="inbox-recordings-head">
                <p className="list-label">Recordings</p>
                <label className="inbox-filter">
                  <input
                    type="checkbox"
                    checked={onlyUnheard}
                    onChange={(e) => setOnlyUnheard(e.target.checked)}
                  />
                  Unheard only
                </label>
              </div>
              <ul className="clip-list">
                {threadClips.map((c) => {
                  const unread = isUnreadForDispatch(c);
                  const heard = driverHeardLabel(c);
                  const unheardOut = isUnheardOutbound(c);
                  return (
                    <li
                      key={c.id}
                      className={`clip-row ${unread ? "unread" : ""} ${
                        unheardOut ? "unheard-out" : ""
                      } ${playingId === c.id ? "playing" : ""}`}
                    >
                      <div>
                        <strong>{speakerLabel(c.from, selected.name)}</strong>
                        {audienceLabel(c) && (
                          <span className="pill fleet-pill">{audienceLabel(c)}</span>
                        )}
                        <span className="muted">
                          {formatClipTime(c)} · {formatDuration(c.durationMs)}
                          {unread ? " · new" : ""}
                          {clipDescription(c, nameById)
                            ? ` · ${clipDescription(c, nameById)}`
                            : ""}
                        </span>
                        {heard && (
                          <span
                            className={`clip-heard ${
                              unheardOut ? "clip-heard-no" : "clip-heard-yes"
                            }`}
                          >
                            {heard}
                          </span>
                        )}
                      </div>
                      <div className="clip-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => play(c)}
                        >
                          {playingId === c.id ? "Playing…" : "Play"}
                        </button>
                        <button
                          type="button"
                          className="ghost danger-ghost"
                          disabled={busyId === c.id}
                          onClick={() => void removeClip(c)}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
                {threadClips.length === 0 && (
                  <li className="muted">
                    {onlyUnheard
                      ? "No unheard outbound clips in this thread."
                      : "No clips in this thread yet."}
                  </li>
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
