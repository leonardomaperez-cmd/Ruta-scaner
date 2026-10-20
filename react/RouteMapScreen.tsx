// RouteMapScreen: mapa con Leaflet + react-leaflet. Optimiza el orden con Valhalla (único optimizador) y dibuja
// el depósito (casa), las paradas numeradas en el orden optimizado y la ruta en azul.
// Si Valhalla falla, se usa el orden original.
//   npm i leaflet react-leaflet@4 @mapbox/polyline && npm i -D @types/leaflet @types/mapbox__polyline

import { useEffect, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer } from "react-leaflet";
import L, { type LatLngTuple } from "leaflet";
import polyline from "@mapbox/polyline";
import "leaflet/dist/leaflet.css";

export type Point = { lat: number; lon: number };
export type Stop = Point & { id: string };

type ValhallaResponse = {
  trip?: {
    locations: (Point & { original_index: number })[];
    legs: { shape: string }[];
  };
  error?: string;
};

/** Devuelve las paradas en el orden optimizado y el trazado por calles. */
export async function optimizeWithValhalla(depot: Point, stops: Stop[]): Promise<{ ordered: Stop[]; shape: LatLngTuple[] }> {
  // Valhalla deja fijos el primero y el último: depósito → paradas → depósito
  const locations = [depot, ...stops, depot].map(p => ({ lat: p.lat, lon: p.lon }));
  const url = "https://valhalla1.openstreetmap.de/optimized_route";
  const body = JSON.stringify({ locations, costing: "auto", directions_type: "none" });
  // si el navegador bloquea el POST (CORS), Valhalla acepta lo mismo por GET
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body })
    .catch(() => fetch(url + "?json=" + encodeURIComponent(body)));
  const data: ValhallaResponse = await res.json();
  if (!res.ok || !data.trip) throw new Error(data.error || `Valhalla respondió ${res.status}`);

  const ordered = data.trip.locations.slice(1, -1).map(l => stops[l.original_index - 1]);
  // Valhalla codifica el shape con 6 decimales
  const shape = data.trip.legs.flatMap(leg => polyline.decode(leg.shape, 6) as LatLngTuple[]);
  return { ordered, shape };
}

const houseIcon = L.divIcon({
  className: "",
  html: `<div style="width:34px;height:34px;border-radius:50%;background:#16202b;border:2px solid #fff;display:grid;place-items:center">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z"/></svg></div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

const numberIcon = (n: number) =>
  L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;border-radius:50%;background:#f2b705;border:2px solid #16202b;display:grid;place-items:center;font:700 13px sans-serif">${n}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

export default function RouteMapScreen({ depot, stops }: { depot: Point; stops: Stop[] }) {
  const [ordered, setOrdered] = useState<Stop[]>([]);
  const [shape, setShape] = useState<LatLngTuple[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!stops.length) return;
    setError("");
    optimizeWithValhalla(depot, stops)
      .then(r => { setOrdered(r.ordered); setShape(r.shape); })
      .catch(e => {
        // sin otro optimizador: si Valhalla falla, las paradas quedan en el orden original, unidas en línea recta
        setOrdered(stops);
        setShape([[depot.lat, depot.lon], ...stops.map(s => [s.lat, s.lon] as LatLngTuple)]);
        setError(`Valhalla no respondió (${e.message || e}). Paradas en el orden original.`);
      });
  }, [depot, stops]);

  return (
    <div style={{ position: "relative", height: "100%", minHeight: 400 }}>
      <MapContainer center={[depot.lat, depot.lon]} zoom={13} style={{ height: "100%", width: "100%" }}>
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
        {shape.length > 1 && <Polyline positions={shape} pathOptions={{ color: "#1a73e8", weight: 5 }} />}
        <Marker position={[depot.lat, depot.lon]} icon={houseIcon} />
        {ordered.map((s, i) => (
          <Marker key={s.id} position={[s.lat, s.lon]} icon={numberIcon(i + 1)} />
        ))}
      </MapContainer>
      {error && <div style={{ position: "absolute", left: 10, right: 10, bottom: 20, zIndex: 1000, background: "#ffe9e7", color: "#8a1c12", padding: 8, borderRadius: 8 }}>{error}</div>}
    </div>
  );
}
