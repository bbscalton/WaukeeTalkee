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
  formatVehicleType,
  VEHICLE_TYPES,
  type Driver,
  type Vehicle,
  type VehicleType,
} from "../types";

function mapVehicle(id: string, data: Record<string, unknown>): Vehicle {
  return {
    id,
    name: String(data.name || "Vehicle"),
    type: (data.type as VehicleType) || "truck",
    plate: String(data.plate || ""),
    make: String(data.make || ""),
    model: String(data.model || ""),
    year: String(data.year || ""),
    notes: String(data.notes || ""),
    assignedDriverId: (data.assignedDriverId as string | null) ?? null,
    createdAt: (data.createdAt as Timestamp | null) ?? null,
    updatedAt: (data.updatedAt as Timestamp | null) ?? null,
  };
}

export function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<VehicleType>("truck");
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qV = query(
      collection(db, "orgs", ORG_ID, "vehicles"),
      orderBy("createdAt", "desc")
    );
    const unsubV = onSnapshot(
      qV,
      (snap) => {
        setVehicles(
          snap.docs.map((d) => mapVehicle(d.id, d.data() as Record<string, unknown>))
        );
      },
      (err) => setError(err.message)
    );

    const qD = query(collection(db, "orgs", ORG_ID, "drivers"));
    const unsubD = onSnapshot(qD, (snap) => {
      setDrivers(
        snap.docs.map((d) => ({
          id: d.id,
          displayName: String(d.data().displayName || "Driver"),
          plate: (d.data().plate as string | null) ?? null,
          pairStatus: d.data().pairStatus === "paired" ? "paired" : "unpaired",
          deviceId: (d.data().deviceId as string | null) ?? null,
          onDuty: Boolean(d.data().onDuty),
          lastLat: null,
          lastLng: null,
          lastSpeed: null,
          lastHeading: null,
          lastTelemetryAt: null,
          speedLimitKmh: null,
          vehicleId: (d.data().vehicleId as string | null) ?? null,
        }))
      );
    });

    return () => {
      unsubV();
      unsubD();
    };
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id = "veh_" + Date.now();
      await setDoc(doc(db, "orgs", ORG_ID, "vehicles", id), {
        name: name.trim(),
        type,
        plate: plate.trim(),
        make: make.trim(),
        model: model.trim(),
        year: year.trim(),
        notes: notes.trim(),
        assignedDriverId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setName("");
      setPlate("");
      setMake("");
      setModel("");
      setYear("");
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create vehicle");
    } finally {
      setBusy(false);
    }
  }

  async function assignDriver(vehicleId: string, driverId: string | null) {
    setBusy(true);
    setError(null);
    try {
      // Unassign current driver on vehicle if any
      const vehicle = vehicles.find((v) => v.id === vehicleId);
      if (vehicle?.assignedDriverId) {
        await updateDoc(doc(db, "orgs", ORG_ID, "drivers", vehicle.assignedDriverId), {
          vehicleId: null,
        });
      }

      await updateDoc(doc(db, "orgs", ORG_ID, "vehicles", vehicleId), {
        assignedDriverId: driverId || null,
        updatedAt: new Date(),
      });

      if (driverId) {
        await updateDoc(doc(db, "orgs", ORG_ID, "drivers", driverId), {
          vehicleId: vehicleId,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign driver");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(vehicleId: string) {
    if (!confirm("Are you sure you want to remove this vehicle profile?")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDoc(doc(db, "orgs", ORG_ID, "vehicles", vehicleId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete vehicle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Vehicles & Trailers</h1>
        <p className="muted">
          Manage fleet vehicles, mixer trucks, trailers, and assign dedicated drivers.
        </p>
      </div>

      <form className="panel form-row" onSubmit={handleCreate}>
        <label>
          Name / Unit #
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mixer Truck 04"
            required
          />
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as VehicleType)}>
            {VEHICLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {formatVehicleType(t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Plate
          <input
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            placeholder="CON-4042"
          />
        </label>
        <label>
          Make / Model
          <input
            value={make}
            onChange={(e) => setMake(e.target.value)}
            placeholder="Mack Granite"
          />
        </label>
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Saving…" : "Add Vehicle"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Unit Name</th>
              <th>Type</th>
              <th>Plate</th>
              <th>Make / Model</th>
              <th>Assigned Driver</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vehicles.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No vehicles registered yet.
                </td>
              </tr>
            )}
            {vehicles.map((v) => {
              return (
                <tr key={v.id}>
                  <td>
                    <strong>{v.name}</strong>
                  </td>
                  <td>
                    <span className="pill">{formatVehicleType(v.type)}</span>
                  </td>
                  <td>{v.plate || "—"}</td>
                  <td>{v.make ? `${v.make} ${v.model}` : "—"}</td>
                  <td>
                    <select
                      value={v.assignedDriverId || ""}
                      onChange={(e) => void assignDriver(v.id, e.target.value || null)}
                      disabled={busy}
                    >
                      <option value="">Unassigned</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.displayName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ghost danger"
                      disabled={busy}
                      onClick={() => void handleDelete(v.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
