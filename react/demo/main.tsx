import { createRoot } from "react-dom/client";
import RouteMapScreen, { type Point, type Stop } from "./RouteMapScreen";

// Lee las paradas reales que guardó la app (mismo sitio, mismo teléfono): las que tienen ubicación y no están entregadas.
// El depósito es el punto de partida de la última ruta optimizada; si no hay, la primera parada.
type Item = { num: number; lat?: number; lng?: number; done?: boolean };
const read = <T,>(k: string): T | null => { try { return JSON.parse(localStorage.getItem("ruta-escaner-v1:" + k) || "null"); } catch { return null; } };
const items = (read<Item[]>("items") || []).filter(it => typeof it.lat === "number" && typeof it.lng === "number" && !it.done);
const savedStart = read<{ start?: { lat: number; lng: number } | null }>("route")?.start;

let depot: Point, stops: Stop[], note = "";
if (items.length >= 2) {
  depot = savedStart ? { lat: savedStart.lat, lon: savedStart.lng } : { lat: items[0].lat!, lon: items[0].lng! };
  stops = items.map(it => ({ id: String(it.num).padStart(4, "0"), lat: it.lat!, lon: it.lng! }));
  note = `${stops.length} paradas de tu lista`;
} else {
  // ejemplo en Mar del Plata
  depot = { lat: -38.0001, lon: -57.5562 };
  stops = [
    [-38.0047, -57.5497], [-38.0152, -57.5413], [-38.0003, -57.5471], [-37.9978, -57.5525], [-37.9710, -57.5621],
    [-38.0113, -57.5558], [-38.0302, -57.5468], [-37.9990, -57.5446], [-37.9930, -57.5720], [-38.0440, -57.5420],
  ].map(([lat, lon], i) => ({ id: String(i + 1).padStart(4, "0"), lat, lon }));
  note = "Ejemplo (no hay al menos 2 paradas ubicadas en tu lista)";
}

createRoot(document.getElementById("root")!).render(
  <div style={{ height: "100dvh", position: "relative" }}>
    <RouteMapScreen depot={depot} stops={stops} />
    <div style={{ position: "absolute", top: 10, left: 56, zIndex: 1000, background: "rgba(22,32,43,.85)", color: "#fff", padding: "6px 12px", borderRadius: 999, font: "600 13px sans-serif" }}>{note}</div>
  </div>,
);
