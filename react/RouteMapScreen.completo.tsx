// RouteMapScreen: mapa de la ruta del día con Leaflet + react-leaflet.
// - Optimiza el orden con Valhalla (servidor público gratis de OpenStreetMap).
// - Dibuja el depósito (casa), las paradas numeradas en el orden optimizado y la línea azul por las calles.
// - Guarda la última ruta en localStorage: sin internet, muestra la última ruta calculada.
// - Si no recibe paradas, usa 10 paradas de ejemplo en Mar del Plata.
//
// Dependencias: react, react-dom, leaflet, react-leaflet@4, @mapbox/polyline
//   npm i leaflet react-leaflet@4 @mapbox/polyline && npm i -D @types/leaflet @types/mapbox__polyline

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L, { type LatLngBoundsExpression, type LatLngTuple } from "leaflet";
import polyline from "@mapbox/polyline";
import "leaflet/dist/leaflet.css";

export type Stop = { id: string; cliente: string; address: string; lat: number; lon: number };
export type Depot = { name: string; address: string; lat: number; lon: number };

export type OptimizedRoute = {
  depot: Depot;
  stops: Stop[]; // ya en el orden optimizado
  shape: LatLngTuple[]; // trazado por calles
  km: number;
  minutes: number;
  savedAt: string; // ISO
  stopsKey: string; // para saber si la ruta guardada corresponde a estas paradas
};

type Props = {
  stops?: Stop[];
  depot?: Depot;
  roundTrip?: boolean; // volver al depósito al final (por defecto sí)
  onRoute?: (route: OptimizedRoute) => void;
};

const VALHALLA_URL = "https://valhalla1.openstreetmap.de/optimized_route";
const STORAGE_KEY = "ruta-escaner:last-route";

// ---------- datos de ejemplo (Mar del Plata) ----------
export const MOCK_DEPOT: Depot = { name: "Depósito", address: "Av. Independencia 2100, Mar del Plata", lat: -38.0001, lon: -57.5562 };
export const MOCK_STOPS: Stop[] = [
  { id: "0001", cliente: "Cliente 1", address: "Av. Colón 2500, Mar del Plata", lat: -38.0047, lon: -57.5497 },
  { id: "0002", cliente: "Cliente 2", address: "Güemes 2800, Mar del Plata", lat: -38.0152, lon: -57.5413 },
  { id: "0003", cliente: "Cliente 3", address: "Córdoba 1900, Mar del Plata", lat: -38.0003, lon: -57.5471 },
  { id: "0004", cliente: "Cliente 4", address: "San Martín 2600, Mar del Plata", lat: -37.9978, lon: -57.5525 },
  { id: "0005", cliente: "Cliente 5", address: "Av. Constitución 5000, Mar del Plata", lat: -37.9710, lon: -57.5621 },
  { id: "0006", cliente: "Cliente 6", address: "Alberti 3200, Mar del Plata", lat: -38.0113, lon: -57.5558 },
  { id: "0007", cliente: "Cliente 7", address: "Av. Juan B. Justo 1500, Mar del Plata", lat: -38.0302, lon: -57.5468 },
  { id: "0008", cliente: "Cliente 8", address: "Rivadavia 2300, Mar del Plata", lat: -37.9990, lon: -57.5446 },
  { id: "0009", cliente: "Cliente 9", address: "Av. Luro 4000, Mar del Plata", lat: -37.9930, lon: -57.5720 },
  { id: "0010", cliente: "Cliente 10", address: "Av. Jacinto Peralta Ramos 900, Mar del Plata", lat: -38.0440, lon: -57.5420 },
];

// ---------- guardado offline ----------
const stopsKeyOf = (depot: Depot, stops: Stop[], roundTrip: boolean) =>
  [roundTrip ? "rt" : "ow", `${depot.lat},${depot.lon}`, ...stops.map(s => `${s.id}@${s.lat},${s.lon}`).sort()].join("|");

export function loadLastRoute(): OptimizedRoute | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OptimizedRoute) : null;
  } catch {
    return null;
  }
}
function saveLastRoute(route: OptimizedRoute) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(route)); } catch { /* sin espacio o modo privado */ }
}

// ---------- Valhalla ----------
type ValhallaTrip = {
  trip: {
    locations: { lat: number; lon: number; original_index: number }[];
    legs: { shape: string; summary: { length: number; time: number } }[];
    summary: { length: number; time: number };
  };
  error?: string;
};

/**
 * Pide a Valhalla el mejor orden para visitar las paradas.
 * Valhalla deja fijos el primer y el último punto: se manda depósito → paradas → depósito,
 * y si no hay vuelta se descarta el último tramo.
 */
export async function optimizeWithValhalla(depot: Depot, stops: Stop[], roundTrip = true, signal?: AbortSignal): Promise<OptimizedRoute> {
  if (!stops.length) throw new Error("No hay paradas para optimizar");
  const locations = [depot, ...stops, depot].map(p => ({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) }));
  const body = { locations, costing: "auto", units: "kilometers", directions_type: "none" };

  let res = await fetch(VALHALLA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }).catch(() => null);
  // Algunos navegadores bloquean el POST por CORS; Valhalla acepta lo mismo por GET.
  if (!res || res.status === 405) res = await fetch(`${VALHALLA_URL}?json=${encodeURIComponent(JSON.stringify(body))}`, { signal });

  const data = (await res.json().catch(() => ({}))) as Partial<ValhallaTrip>;
  if (!res.ok || !data.trip) throw new Error(`Valhalla respondió ${res.status}${data.error ? ": " + data.error : ""}`);

  // optimized order: las ubicaciones del medio vienen ordenadas, con su índice original
  const ordered = data.trip.locations
    .slice(1, -1)
    .map(l => stops[l.original_index - 1])
    .filter((s): s is Stop => Boolean(s));

  const legs = roundTrip ? data.trip.legs : data.trip.legs.slice(0, -1);
  const shape: LatLngTuple[] = [];
  let km = 0, sec = 0;
  for (const leg of legs) {
    km += leg.summary.length;
    sec += leg.summary.time;
    // Valhalla codifica con 6 decimales
    for (const [lat, lon] of polyline.decode(leg.shape, 6)) shape.push([lat, lon]);
  }

  return {
    depot,
    stops: ordered,
    shape,
    km: Math.round(km * 10) / 10,
    minutes: Math.round(sec / 60),
    savedAt: new Date().toISOString(),
    stopsKey: stopsKeyOf(depot, stops, roundTrip),
  };
}

// ---------- iconos ----------
const depotIcon = L.divIcon({
  className: "",
  html: `<div style="width:36px;height:36px;border-radius:50%;background:#16202b;border:2px solid #fff;display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,.4)">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z"/></svg></div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
});

const iconCache = new Map<number, L.DivIcon>();
function stopIcon(n: number): L.DivIcon {
  let icon = iconCache.get(n);
  if (!icon) {
    icon = L.divIcon({
      className: "",
      html: `<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#f2b705;border:2px solid #16202b;display:grid;place-items:center;box-shadow:0 2px 4px rgba(0,0,0,.35)">
        <span style="transform:rotate(45deg);font:700 13px system-ui,sans-serif;color:#1b1600">${n}</span></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      popupAnchor: [0, -28],
    });
    iconCache.set(n, icon);
  }
  return icon;
}

// Ajusta la vista a la ruta cuando cambia
function FitBounds({ points }: { points: LatLngTuple[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points as LatLngBoundsExpression, { padding: [30, 30], maxZoom: 16 });
    else if (points.length === 1) map.setView(points[0], 15);
  }, [map, points]);
  return null;
}

// ---------- pantalla ----------
export default function RouteMapScreen({ stops, depot, roundTrip = true, onRoute }: Props) {
  const usingMock = !stops || stops.length === 0;
  const theStops = usingMock ? MOCK_STOPS : stops;
  const theDepot = depot ?? MOCK_DEPOT;
  const key = useMemo(() => stopsKeyOf(theDepot, theStops, roundTrip), [theDepot, theStops, roundTrip]);

  // arranca con la última ruta guardada si corresponde a estas paradas (funciona sin internet)
  const [route, setRoute] = useState<OptimizedRoute | null>(() => {
    const last = loadLastRoute();
    return last && last.stopsKey === key ? last : null;
  });
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [loading, setLoading] = useState(false);

  const optimize = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setStatus({ text: "Calculando la mejor ruta…" });
    try {
      const r = await optimizeWithValhalla(theDepot, theStops, roundTrip, signal);
      saveLastRoute(r);
      setRoute(r);
      onRoute?.(r);
      setStatus({ text: "Ruta optimizada." });
    } catch (e) {
      if (signal?.aborted) return;
      const last = loadLastRoute();
      if (last) {
        setRoute(last);
        setStatus({ text: `Sin conexión con el optimizador. Mostrando la última ruta guardada (${new Date(last.savedAt).toLocaleString()}).`, error: true });
      } else {
        setStatus({ text: `No se pudo optimizar: ${(e as Error).message}`, error: true });
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [theDepot, theStops, roundTrip, onRoute]);

  // optimiza al abrir si no hay una ruta guardada para estas paradas y hay internet
  useEffect(() => {
    if (route && route.stopsKey === key) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const last = loadLastRoute();
      if (last) setRoute(last);
      setStatus({ text: last ? "Sin internet: mostrando la última ruta guardada." : "Sin internet y sin ruta guardada.", error: true });
      return;
    }
    const ctrl = new AbortController();
    optimize(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const shown = route ?? { depot: theDepot, stops: theStops, shape: [] as LatLngTuple[] };
  const points = useMemo<LatLngTuple[]>(
    () => [[shown.depot.lat, shown.depot.lon], ...shown.stops.map(s => [s.lat, s.lon] as LatLngTuple)],
    [shown.depot, shown.stops],
  );
  // sin trazado por calles (por ejemplo, sin internet la primera vez) se unen las paradas en línea recta
  const line = shown.shape.length > 1 ? shown.shape : route ? points : [];

  return (
    <div style={{ position: "relative", height: "100%", minHeight: 400, width: "100%" }}>
      <MapContainer center={points[0]} zoom={13} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        <FitBounds points={line.length > 1 ? line : points} />
        {line.length > 1 && (
          <>
            <Polyline positions={line} pathOptions={{ color: "#ffffff", weight: 9, opacity: 0.9 }} />
            <Polyline positions={line} pathOptions={{ color: "#1a73e8", weight: 5, opacity: 0.95, dashArray: shown.shape.length > 1 ? undefined : "8 8" }} />
          </>
        )}
        <Marker position={[shown.depot.lat, shown.depot.lon]} icon={depotIcon}>
          <Popup><b>{shown.depot.name}</b><br />{shown.depot.address}</Popup>
        </Marker>
        {shown.stops.map((s, i) => (
          <Marker key={s.id} position={[s.lat, s.lon]} icon={stopIcon(i + 1)}>
            <Popup>
              <b>{route ? `Parada ${i + 1} · ` : ""}{s.cliente}</b><br />{s.address}
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <div style={{ position: "absolute", top: 10, left: 56, right: 10, zIndex: 1000, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          onClick={() => optimize()}
          disabled={loading}
          style={{ padding: "8px 14px", borderRadius: 999, border: 0, background: "#f2b705", font: "700 14px system-ui, sans-serif", cursor: "pointer" }}
        >
          {loading ? "Optimizando…" : "Optimizar ruta"}
        </button>
        {route && (
          <span style={{ padding: "6px 12px", borderRadius: 999, background: "rgba(22,32,43,.85)", color: "#fff", font: "600 13px system-ui, sans-serif" }}>
            {route.km} km · {route.minutes} min
          </span>
        )}
        {usingMock && (
          <span style={{ padding: "6px 12px", borderRadius: 999, background: "#fff", color: "#16202b", font: "600 12px system-ui, sans-serif" }}>
            Datos de ejemplo
          </span>
        )}
      </div>
      {status.text && (
        <div
          role="status"
          style={{ position: "absolute", left: 10, right: 10, bottom: 24, zIndex: 1000, padding: "8px 12px", borderRadius: 10, background: status.error ? "#ffe9e7" : "#e8f6ee", color: status.error ? "#8a1c12" : "#145a32", font: "500 13px system-ui, sans-serif" }}
        >
          {status.text}
        </div>
      )}
    </div>
  );
}
