import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, ORG_ID, storage } from "../firebase";
import {
  BOOKING_STATUSES,
  formatBookingStatus,
  formatExceptionCode,
  STOP_EXCEPTION_CODES,
  telHref,
  type Attachment,
  type Booking,
  type BookingPickupMode,
  type BookingStatus,
  type Driver,
  type StopExceptionCode,
} from "../types";
import { useSolutionProfile } from "../useSolutionProfile";

type ContactPrefill = {
  contactId?: string;
  passengerName?: string;
  phone?: string;
  pickupAddress?: string;
};

const emptyForm = {
  passengerName: "",
  phone: "",
  contactId: "",
  pickupAddress: "",
  dropoffAddress: "",
  pickupMode: "asap" as BookingPickupMode,
  pickupAtLocal: "",
  notes: "",
  jobSiteName: "",
  yards: "",
  mixNotes: "",
};

function mapBooking(id: string, data: Record<string, unknown>): Booking {
  const statusRaw = String(data.status || "new");
  const status: BookingStatus = BOOKING_STATUSES.includes(
    statusRaw as BookingStatus
  )
    ? (statusRaw as BookingStatus)
    : "new";
  const modeRaw = String(data.pickupMode || "asap");
  const pickupMode: BookingPickupMode =
    modeRaw === "scheduled" ? "scheduled" : "asap";
  return {
    id,
    passengerName: String(data.passengerName || ""),
    phone: String(data.phone || ""),
    contactId: data.contactId ? String(data.contactId) : null,
    pickupAddress: String(data.pickupAddress || ""),
    dropoffAddress: String(data.dropoffAddress || ""),
    pickupMode,
    pickupAt: (data.pickupAt as Timestamp | null) ?? null,
    status,
    assignedDriverId: data.assignedDriverId
      ? String(data.assignedDriverId)
      : null,
    notes: String(data.notes || ""),
    jobSiteName: data.jobSiteName ? String(data.jobSiteName) : undefined,
    yards: data.yards ? String(data.yards) : undefined,
    mixNotes: data.mixNotes ? String(data.mixNotes) : undefined,
    attachments: (data.attachments as Attachment[]) ?? [],
    exceptionCode: (data.exceptionCode as StopExceptionCode | null) ?? null,
    exceptionNote: data.exceptionNote ? String(data.exceptionNote) : undefined,
    createdAt: (data.createdAt as Timestamp | null) ?? null,
    updatedAt: (data.updatedAt as Timestamp | null) ?? null,
  };
}

function formatPickup(b: Booking): string {
  if (b.pickupMode === "asap") return "ASAP";
  if (!b.pickupAt) return "Scheduled";
  return new Date(b.pickupAt.seconds * 1000).toLocaleString();
}

export function BookingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, label } = useSolutionProfile();
  const isConcrete = profile.id === "concrete";
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [statusFilter, setStatusFilter] = useState<"active" | BookingStatus | "all">(
    "active"
  );
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [uploadingBookingId, setUploadingBookingId] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const prefill = (location.state as ContactPrefill | null) || null;
    if (!prefill?.passengerName && !prefill?.phone) return;
    setForm((f) => ({
      ...f,
      passengerName: prefill.passengerName || f.passengerName,
      phone: prefill.phone || f.phone,
      contactId: prefill.contactId || f.contactId,
      pickupAddress: prefill.pickupAddress || f.pickupAddress,
    }));
    navigate(location.pathname, { replace: true, state: null });
  }, [location, navigate]);

  useEffect(() => {
    const q = query(
      collection(db, "orgs", ORG_ID, "bookings"),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(
      q,
      (snap) => {
        setBookings(snap.docs.map((d) => mapBooking(d.id, d.data())));
      },
      (err) => setError(err.message)
    );
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "orgs", ORG_ID, "drivers"),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(
      q,
      (snap) => {
        setDrivers(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              displayName: String(data.displayName || "Driver"),
              plate: data.plate ?? null,
              pairStatus:
                data.pairStatus === "paired" ? "paired" : "unpaired",
              deviceId: data.deviceId ?? null,
              onDuty: Boolean(data.onDuty),
              lastLat: data.lastLat ?? null,
              lastLng: data.lastLng ?? null,
              lastSpeed: data.lastSpeed ?? null,
              lastHeading: data.lastHeading ?? null,
              lastTelemetryAt: (data.lastTelemetryAt as Timestamp | null) ?? null,
              speedLimitKmh:
                typeof data.speedLimitKmh === "number"
                  ? data.speedLimitKmh
                  : null,
              vehicleId: (data.vehicleId as string | null) ?? null,
            };
          })
        );
      },
      (err) => setError(err.message)
    );
  }, []);

  const pairedDrivers = useMemo(
    () =>
      drivers
        .filter((d) => d.pairStatus === "paired")
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [drivers]
  );

  const driverName = useMemo(() => {
    const map = new Map(drivers.map((d) => [d.id, d.displayName]));
    return (id: string | null) => (id ? map.get(id) || id : "—");
  }, [drivers]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return bookings;
    if (statusFilter === "active") {
      return bookings.filter(
        (b) =>
          b.status === "new" ||
          b.status === "assigned" ||
          b.status === "en_route"
      );
    }
    return bookings.filter((b) => b.status === statusFilter);
  }, [bookings, statusFilter]);

  async function createBooking(e: FormEvent) {
    e.preventDefault();
    const passengerName = form.passengerName.trim();
    const pickupAddress = form.pickupAddress.trim();
    if (!passengerName || !pickupAddress) {
      setError("Passenger name and pickup address are required.");
      return;
    }
    if (form.pickupMode === "scheduled" && !form.pickupAtLocal) {
      setError("Pick a scheduled pickup time.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        passengerName,
        phone: form.phone.trim(),
        contactId: form.contactId.trim() || null,
        pickupAddress,
        dropoffAddress: form.dropoffAddress.trim(),
        pickupMode: form.pickupMode,
        pickupAt:
          form.pickupMode === "scheduled" && form.pickupAtLocal
            ? Timestamp.fromDate(new Date(form.pickupAtLocal))
            : null,
        status: "new",
        assignedDriverId: null,
        notes: form.notes.trim(),
        attachments: [],
        exceptionCode: null,
        exceptionNote: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (isConcrete) {
        payload.jobSiteName = form.jobSiteName.trim() || null;
        payload.yards = form.yards.trim() || null;
        payload.mixNotes = form.mixNotes.trim() || null;
      }
      await addDoc(collection(db, "orgs", ORG_ID, "bookings"), payload);
      setForm(emptyForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function patchBooking(
    id: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, "orgs", ORG_ID, "bookings", id), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function assignDriver(id: string, driverId: string) {
    if (!driverId) {
      await patchBooking(id, {
        assignedDriverId: null,
        status: "new",
      });
      return;
    }
    await patchBooking(id, {
      assignedDriverId: driverId,
      status: "assigned",
    });
  }

  async function handleFileUpload(booking: Booking, file: File) {
    setUploadingBookingId(booking.id);
    setError(null);
    try {
      const storagePath = `orgs/${ORG_ID}/bookings/${booking.id}/${Date.now()}_${file.name}`;
      const fileRef = ref(storage, storagePath);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);

      const newAttachment: Attachment = {
        id: "att_" + Date.now(),
        url,
        storagePath,
        caption: captionDraft.trim(),
        uploadedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
      };

      const updatedAttachments = [...(booking.attachments || []), newAttachment];
      await patchBooking(booking.id, { attachments: updatedAttachments });
      setCaptionDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Attachment upload failed");
    } finally {
      setUploadingBookingId(null);
    }
  }

  async function handleDeleteAttachment(booking: Booking, attachment: Attachment) {
    try {
      const fileRef = ref(storage, attachment.storagePath);
      await deleteObject(fileRef).catch(() => {}); // ignore error if file deleted
      const updated = (booking.attachments || []).filter((a) => a.id !== attachment.id);
      await patchBooking(booking.id, { attachments: updated });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete attachment failed");
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>{label("bookings")}</h1>
        <p className="muted">
          {isConcrete
            ? "Order board — schedule pours, assign mixer drivers, upload ticket photos & log exceptions."
            : "Job board — create, assign drivers, attach photos, track stop exceptions."}
        </p>
      </div>

      <form className="panel form-grid" onSubmit={createBooking}>
        <div className="form-grid-head">
          <strong>{label("newBooking")}</strong>
          {form.contactId && (
            <span className="muted">Linked contact · {form.contactId.slice(0, 8)}…</span>
          )}
        </div>
        <label>
          {isConcrete ? "Customer / contractor" : "Passenger / contact"}
          <input
            value={form.passengerName}
            onChange={(e) =>
              setForm((f) => ({ ...f, passengerName: e.target.value }))
            }
            placeholder={isConcrete ? "Contractor or customer name" : "Name on the job"}
            required
          />
        </label>
        <label>
          Phone (optional)
          <input
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="515-555-0100"
          />
        </label>
        <label>
          {isConcrete ? "Plant / pickup" : "Pickup address"}
          <input
            value={form.pickupAddress}
            onChange={(e) =>
              setForm((f) => ({ ...f, pickupAddress: e.target.value }))
            }
            placeholder={isConcrete ? "Batch plant or yard" : "Where to pick up"}
            required
          />
        </label>
        <label>
          {isConcrete ? "Job site" : "Dropoff (optional)"}
          <input
            value={isConcrete ? form.jobSiteName : form.dropoffAddress}
            onChange={(e) =>
              setForm((f) =>
                isConcrete
                  ? { ...f, jobSiteName: e.target.value, dropoffAddress: e.target.value }
                  : { ...f, dropoffAddress: e.target.value }
              )
            }
            placeholder={isConcrete ? "Pour location" : "Where to drop off"}
          />
        </label>
        {isConcrete && (
          <>
            <label>
              Yards (optional)
              <input
                value={form.yards}
                onChange={(e) => setForm((f) => ({ ...f, yards: e.target.value }))}
                placeholder="e.g. 8"
              />
            </label>
            <label>
              Mix notes (optional)
              <input
                value={form.mixNotes}
                onChange={(e) => setForm((f) => ({ ...f, mixNotes: e.target.value }))}
                placeholder="4000 PSI, fiber, slump…"
              />
            </label>
          </>
        )}
        <label>
          Timing
          <select
            value={form.pickupMode}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                pickupMode: e.target.value as BookingPickupMode,
              }))
            }
          >
            <option value="asap">ASAP</option>
            <option value="scheduled">Scheduled</option>
          </select>
        </label>
        {form.pickupMode === "scheduled" && (
          <label>
            Pickup time
            <input
              type="datetime-local"
              value={form.pickupAtLocal}
              onChange={(e) =>
                setForm((f) => ({ ...f, pickupAtLocal: e.target.value }))
              }
              required
            />
          </label>
        )}
        <label className="span-2">
          Notes
          <input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder={
              isConcrete
                ? "Gate code, pump truck, special access…"
                : "Luggage, flight number, gate…"
            }
          />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : label("createBooking")}
          </button>
        </div>
      </form>

      <div className="status-tabs" role="tablist" aria-label={`${label("bookings")} status`}>
        <button
          type="button"
          className={statusFilter === "active" ? "active" : ""}
          onClick={() => setStatusFilter("active")}
        >
          Active
        </button>
        {BOOKING_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={statusFilter === s ? "active" : ""}
            onClick={() => setStatusFilter(s)}
          >
            {formatBookingStatus(s)}
          </button>
        ))}
        <button
          type="button"
          className={statusFilter === "all" ? "active" : ""}
          onClick={() => setStatusFilter("all")}
        >
          All
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="booking-board">
        {filtered.length === 0 && (
          <div className="panel muted">No {label("bookings").toLowerCase()} in this view.</div>
        )}
        {filtered.map((b) => (
          <article key={b.id} className={`panel booking-card status-${b.status}`}>
            <header className="booking-card-head">
              <div>
                <h2>{b.passengerName}</h2>
                <p className="muted">
                  {formatPickup(b)}
                  {b.phone && (
                    <>
                      {" · "}
                      <a className="tel-link" href={telHref(b.phone)}>
                        {b.phone}
                      </a>
                    </>
                  )}
                </p>
              </div>
              <div className="booking-head-pills">
                {b.exceptionCode && (
                  <span className="pill status-warn">
                    ⚠️ {formatExceptionCode(b.exceptionCode)}
                  </span>
                )}
                <span className={`pill status-${b.status}`}>
                  {formatBookingStatus(b.status)}
                </span>
              </div>
            </header>

            <div className="booking-meta">
              <div>
                <span className="list-label">{isConcrete ? "Plant / pickup" : "Pickup"}</span>
                <p>{b.pickupAddress}</p>
              </div>
              <div>
                <span className="list-label">{isConcrete ? "Job site" : "Dropoff"}</span>
                <p>{b.jobSiteName || b.dropoffAddress || "—"}</p>
              </div>
              {isConcrete && b.yards && (
                <div>
                  <span className="list-label">Yards</span>
                  <p>{b.yards}</p>
                </div>
              )}
              <div>
                <span className="list-label">{isConcrete ? "Team member" : "Driver"}</span>
                <p>{driverName(b.assignedDriverId)}</p>
              </div>
            </div>

            {(b.notes || b.mixNotes) && (
              <p className="muted booking-notes">
                {[b.mixNotes, b.notes].filter(Boolean).join(" · ")}
              </p>
            )}

            {b.exceptionNote && (
              <p className="error booking-notes">
                <strong>Exception details:</strong> {b.exceptionNote}
              </p>
            )}

            {/* Feature #4: Photo Attachments Section */}
            <div className="attachments-section">
              <span className="list-label">
                📷 Attachments / Tickets ({b.attachments?.length || 0})
              </span>
              {b.attachments && b.attachments.length > 0 && (
                <div className="attachment-grid">
                  {b.attachments.map((att) => (
                    <div key={att.id} className="attachment-card">
                      <a href={att.url} target="_blank" rel="noreferrer">
                        <img src={att.url} alt={att.caption || "Attachment"} className="attachment-thumb" />
                      </a>
                      {att.caption && <div className="attachment-caption">{att.caption}</div>}
                      <button
                        type="button"
                        className="ghost danger attachment-del-btn"
                        onClick={() => void handleDeleteAttachment(b, att)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="attachment-upload-box">
                <input
                  type="text"
                  placeholder="Caption (e.g. Pour ticket #1042)"
                  value={captionDraft}
                  onChange={(e) => setCaptionDraft(e.target.value)}
                  className="caption-input"
                />
                <label className="button ghost upload-file-btn">
                  {uploadingBookingId === b.id ? "Uploading…" : "+ Attach Photo"}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFileUpload(b, file);
                    }}
                  />
                </label>
              </div>
            </div>

            {b.status !== "cancelled" && b.status !== "completed" && (
              <div className="booking-actions">
                <label>
                  {label("assignDriver")}
                  <select
                    value={b.assignedDriverId || ""}
                    disabled={busy}
                    onChange={(e) => void assignDriver(b.id, e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {pairedDrivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.displayName}
                        {d.onDuty ? "" : ` (${label("offDuty")})`}
                        {d.plate ? ` · ${d.plate}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Status
                  <select
                    value={b.status}
                    disabled={busy}
                    onChange={(e) =>
                      void patchBooking(b.id, {
                        status: e.target.value as BookingStatus,
                      })
                    }
                  >
                    {BOOKING_STATUSES.filter((s) => s !== "cancelled").map(
                      (s) => (
                        <option key={s} value={s}>
                          {formatBookingStatus(s)}
                        </option>
                      )
                    )}
                  </select>
                </label>
                {/* Feature #13: Stop Exception Code Selector */}
                <label>
                  Exception Code
                  <select
                    value={b.exceptionCode || ""}
                    disabled={busy}
                    onChange={(e) => {
                      const code = e.target.value as StopExceptionCode | "";
                      const note = code ? prompt("Optional exception note:") ?? "" : "";
                      void patchBooking(b.id, {
                        exceptionCode: code || null,
                        exceptionNote: note || null,
                      });
                    }}
                  >
                    <option value="">None (Normal)</option>
                    {STOP_EXCEPTION_CODES.map((code) => (
                      <option key={code} value={code}>
                        {formatExceptionCode(code)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="ghost danger-ghost"
                  disabled={busy}
                  onClick={() =>
                    void patchBooking(b.id, {
                      status: "cancelled",
                    })
                  }
                >
                  Cancel
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
