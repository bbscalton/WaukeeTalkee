import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  type Timestamp,
} from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import {
  CONTACT_TYPES,
  telHref,
  type Contact,
  type ContactType,
} from "../types";

const emptyForm = {
  name: "",
  phone: "",
  notes: "",
  address: "",
  pickupPreference: "",
  type: "customer" as ContactType,
  tags: "",
};

function mapContact(id: string, data: Record<string, unknown>): Contact {
  const typeRaw = String(data.type || "customer");
  const type: ContactType = CONTACT_TYPES.includes(typeRaw as ContactType)
    ? (typeRaw as ContactType)
    : "customer";
  const tags = Array.isArray(data.tags)
    ? data.tags.map((t) => String(t)).filter(Boolean)
    : [];
  return {
    id,
    name: String(data.name || ""),
    phone: String(data.phone || ""),
    notes: String(data.notes || ""),
    address: String(data.address || ""),
    pickupPreference: String(data.pickupPreference || ""),
    type,
    tags,
    createdAt: (data.createdAt as Timestamp | null) ?? null,
    updatedAt: (data.updatedAt as Timestamp | null) ?? null,
  };
}

export function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ContactType>("all");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "orgs", ORG_ID, "contacts"),
      orderBy("name", "asc")
    );
    return onSnapshot(
      q,
      (snap) => {
        setContacts(snap.docs.map((d) => mapContact(d.id, d.data())));
      },
      (err) => setError(err.message)
    );
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (typeFilter !== "all" && c.type !== typeFilter) return false;
      if (!q) return true;
      const hay = [
        c.name,
        c.phone,
        c.notes,
        c.address,
        c.pickupPreference,
        c.type,
        ...c.tags,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [contacts, search, typeFilter]);

  function startEdit(c: Contact) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      phone: c.phone,
      notes: c.notes,
      address: c.address,
      pickupPreference: c.pickupPreference,
      type: c.type,
      tags: c.tags.join(", "),
    });
    setError(null);
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function saveContact(e: FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name || !phone) {
      setError("Name and phone are required.");
      return;
    }
    setBusy(true);
    setError(null);
    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const payload = {
      name,
      phone,
      notes: form.notes.trim(),
      address: form.address.trim(),
      pickupPreference: form.pickupPreference.trim(),
      type: form.type,
      tags,
      updatedAt: serverTimestamp(),
    };
    try {
      if (editingId) {
        await updateDoc(doc(db, "orgs", ORG_ID, "contacts", editingId), payload);
      } else {
        await addDoc(collection(db, "orgs", ORG_ID, "contacts"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeContact(id: string, name: string) {
    if (!window.confirm(`Delete contact “${name}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDoc(doc(db, "orgs", ORG_ID, "contacts", id));
      if (editingId === id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Contacts</h1>
        <p className="muted">
          Desk book for customers, hotels, and accounts — tap to call, book from
          a name.
        </p>
      </div>

      <form className="panel form-grid" onSubmit={saveContact}>
        <div className="form-grid-head">
          <strong>{editingId ? "Edit contact" : "Add contact"}</strong>
          {editingId && (
            <button type="button" className="ghost" onClick={resetForm}>
              Cancel edit
            </button>
          )}
        </div>
        <label>
          Name
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Jane Doe / Marriott front desk"
            required
          />
        </label>
        <label>
          Phone
          <input
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="515-555-0100"
            required
          />
        </label>
        <label>
          Type
          <select
            value={form.type}
            onChange={(e) =>
              setForm((f) => ({ ...f, type: e.target.value as ContactType }))
            }
          >
            {CONTACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Address (optional)
          <input
            value={form.address}
            onChange={(e) =>
              setForm((f) => ({ ...f, address: e.target.value }))
            }
            placeholder="123 Main St, Waukee"
          />
        </label>
        <label>
          Pickup preference
          <input
            value={form.pickupPreference}
            onChange={(e) =>
              setForm((f) => ({ ...f, pickupPreference: e.target.value }))
            }
            placeholder="Lobby / Door 2 / Gate B"
          />
        </label>
        <label>
          Tags (comma-separated)
          <input
            value={form.tags}
            onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
            placeholder="vip, weekly, airport"
          />
        </label>
        <label className="span-2">
          Notes
          <input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Wheelchair, prefers quiet driver…"
          />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : editingId ? "Update contact" : "Add contact"}
          </button>
        </div>
      </form>

      <div className="panel toolbar">
        <label className="grow">
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, phone, tag…"
          />
        </label>
        <label>
          Filter
          <select
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as "all" | ContactType)
            }
          >
            <option value="all">All types</option>
            {CONTACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Type</th>
              <th>Pickup / address</th>
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No contacts match.
                </td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                  {c.tags.length > 0 && (
                    <div className="tag-row">
                      {c.tags.map((t) => (
                        <span key={t} className="pill">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  <a className="tel-link" href={telHref(c.phone)}>
                    {c.phone}
                  </a>
                </td>
                <td>
                  <span className={`pill type-${c.type}`}>{c.type}</span>
                </td>
                <td>
                  {c.pickupPreference || c.address ? (
                    <>
                      {c.pickupPreference && <div>{c.pickupPreference}</div>}
                      {c.address && <div className="muted">{c.address}</div>}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="muted">{c.notes || "—"}</td>
                <td className="row-actions">
                  <Link
                    className="ghost-link"
                    to="/bookings"
                    state={{
                      contactId: c.id,
                      passengerName: c.name,
                      phone: c.phone,
                      pickupAddress: c.address || c.pickupPreference || "",
                    }}
                  >
                    Book
                  </Link>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => startEdit(c)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="ghost danger-ghost"
                    disabled={busy}
                    onClick={() => void removeContact(c.id, c.name)}
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
