import { createRoot } from "react-dom/client";
import RouteMapScreen from "./RouteMapScreen";
// Prueba: depósito y 10 paradas de ejemplo en Mar del Plata
const depot = { lat: -38.0001, lon: -57.5562 };
const stops = [
  [-38.0047, -57.5497], [-38.0152, -57.5413], [-38.0003, -57.5471], [-37.9978, -57.5525], [-37.9710, -57.5621],
  [-38.0113, -57.5558], [-38.0302, -57.5468], [-37.9990, -57.5446], [-37.9930, -57.5720], [-38.0440, -57.5420],
].map(([lat, lon], i) => ({ id: String(i + 1).padStart(4, "0"), lat, lon }));
createRoot(document.getElementById("root")!).render(<div style={{ height: "100dvh" }}><RouteMapScreen depot={depot} stops={stops} /></div>);
