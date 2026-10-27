// Ruta Escáner: sugerencias y búsqueda de direcciones con TomTom, HERE, Geoapify y LocationIQ.
// Las claves quedan en Supabase (Edge Functions > Secrets), nadie las ve desde el teléfono.
// Va probando los servicios en el orden de la tabla «api_servicios» y, cuando uno llega a su cupo
// del día (tabla «api_uso»), pasa al siguiente. Si no queda ninguno, la app usa Photon/Nominatim.
// Se pega en Supabase > Edge Functions > Deploy a new function > Via Editor, con el nombre «buscar-direccion».
// Secrets: TOMTOM_KEY, HERE_KEY, GEOAPIFY_KEY, LOCATIONIQ_KEY (los que no estén se saltean).
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Hit = { street: string; place: string; lat: number; lng: number };
type Ask = { tipo: "sugerir" | "ubicar"; q: string; lat?: number; lon?: number; pais: string; n: number };
class Agotado extends Error {}

const KEYS: Record<string, string | undefined> = {
  tomtom: Deno.env.get("TOMTOM_KEY"),
  here: Deno.env.get("HERE_KEY"),
  geoapify: Deno.env.get("GEOAPIFY_KEY"),
  locationiq: Deno.env.get("LOCATIONIQ_KEY"),
};
const ISO3: Record<string, string> = { AR: "ARG", UY: "URY", CL: "CHL", PY: "PRY", BO: "BOL", BR: "BRA", PE: "PER", MX: "MEX", ES: "ESP", CO: "COL" };
const near = (a: Ask) => typeof a.lat === "number" && typeof a.lon === "number";
const uniq = (xs: (string | undefined)[], skip = "") => xs.filter((x, i, l) => x && x !== skip && l.indexOf(x) === i).join(", ");

async function get(url: string) {
  const r = await fetch(url, { headers: { "Accept-Language": "es" } });
  if (r.status === 429 || r.status === 401 || r.status === 403) throw new Agotado(String(r.status));
  if (!r.ok) throw new Error("respondió " + r.status);
  return r.json();
}

const SERVICIOS: Record<string, (a: Ask, key: string) => Promise<Hit[]>> = {
  async tomtom(a, key) {
    const u = new URL(`https://api.tomtom.com/search/2/${a.tipo === "sugerir" ? "search" : "geocode"}/${encodeURIComponent(a.q)}.json`);
    u.searchParams.set("key", key); u.searchParams.set("limit", String(a.n)); u.searchParams.set("language", "es-419");
    u.searchParams.set("countrySet", a.pais);
    if (a.tipo === "sugerir") { u.searchParams.set("typeahead", "true"); u.searchParams.set("idxSet", "PAD,Addr,Str,Geo"); }
    if (near(a)) { u.searchParams.set("lat", String(a.lat)); u.searchParams.set("lon", String(a.lon)); }
    const j = await get(u.toString());
    return (j.results || []).filter((r: any) => r.position).map((r: any) => {
      const ad = r.address || {};
      const street = ad.streetName ? ad.streetName + (ad.streetNumber ? " " + ad.streetNumber : "") : (ad.freeformAddress || "");
      return { street, place: uniq([ad.municipalitySubdivision, ad.municipality, ad.countrySubdivision], street), lat: r.position.lat, lng: r.position.lon };
    });
  },
  async here(a, key) {
    const sug = a.tipo === "sugerir";
    const u = new URL(sug ? "https://autosuggest.search.hereapi.com/v1/autosuggest" : "https://geocode.search.hereapi.com/v1/geocode");
    u.searchParams.set("apiKey", key); u.searchParams.set("q", a.q); u.searchParams.set("limit", String(a.n)); u.searchParams.set("lang", "es");
    if (ISO3[a.pais]) u.searchParams.set("in", "countryCode:" + ISO3[a.pais]);
    if (sug) u.searchParams.set("at", near(a) ? `${a.lat},${a.lon}` : "-34.6037,-58.3816");
    const j = await get(u.toString());
    return (j.items || []).filter((r: any) => r.position).map((r: any) => {
      const ad = r.address || {};
      const street = ad.street ? ad.street + (ad.houseNumber ? " " + ad.houseNumber : "") : (r.title || ad.label || "");
      return { street, place: uniq([ad.district, ad.city, ad.state], street), lat: r.position.lat, lng: r.position.lng };
    });
  },
  async geoapify(a, key) {
    const u = new URL(`https://api.geoapify.com/v1/geocode/${a.tipo === "sugerir" ? "autocomplete" : "search"}`);
    u.searchParams.set("apiKey", key); u.searchParams.set("text", a.q); u.searchParams.set("limit", String(a.n));
    u.searchParams.set("lang", "es"); u.searchParams.set("format", "json"); u.searchParams.set("filter", "countrycode:" + a.pais.toLowerCase());
    if (near(a)) u.searchParams.set("bias", `proximity:${a.lon},${a.lat}`);
    const j = await get(u.toString());
    return (j.results || []).map((r: any) => {
      const street = r.street ? r.street + (r.housenumber ? " " + r.housenumber : "") : (r.address_line1 || r.formatted || "");
      return { street, place: uniq([r.suburb, r.city, r.state], street), lat: r.lat, lng: r.lon };
    });
  },
  async locationiq(a, key) {
    const u = new URL(`https://api.locationiq.com/v1/${a.tipo === "sugerir" ? "autocomplete" : "search"}`);
    u.searchParams.set("key", key); u.searchParams.set("q", a.q); u.searchParams.set("limit", String(a.n));
    u.searchParams.set("countrycodes", a.pais.toLowerCase()); u.searchParams.set("accept-language", "es"); u.searchParams.set("format", "json");
    u.searchParams.set("addressdetails", "1");
    const j = await get(u.toString());
    return (Array.isArray(j) ? j : []).map((r: any) => {
      const ad = r.address || {};
      const street = ad.road ? ad.road + (ad.house_number ? " " + ad.house_number : "") : (r.display_place || String(r.display_name || "").split(",")[0]);
      return { street, place: uniq([ad.suburb || ad.neighbourhood, ad.city || ad.town || ad.village, ad.state], street), lat: Number(r.lat), lng: Number(r.lon) };
    });
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return answer(405, { error: "solo POST" });

  // quién es y si su cuenta está activa
  const url = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data: u } = await sb.auth.getUser();
  if (!u || !u.user) return answer(401, { error: "sin sesión" });
  const { data: perfil } = await sb.from("perfiles").select("activo").eq("id", u.user.id).maybeSingle();
  if (!perfil || !perfil.activo) return answer(403, { error: "cuenta no activa" });

  let b: any;
  try { b = await req.json(); } catch { return answer(400, { error: "pedido inválido" }); }
  const q = String(b?.q || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (q.length < 3 || !["sugerir", "ubicar"].includes(b?.tipo)) return answer(400, { error: "pedido inválido" });
  const pais = /^[A-Za-z]{2}$/.test(String(b?.pais || "")) ? String(b.pais).toUpperCase() : "AR";
  const ask: Ask = { tipo: b.tipo, q, pais, n: b.tipo === "sugerir" ? 5 : 1 };
  if (Number.isFinite(b?.lat) && Number.isFinite(b?.lon)) { ask.lat = Number(b.lat); ask.lon = Number(b.lon); }

  // los cupos se cuentan con la llave de servicio (solo existe acá adentro)
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: lista } = await admin.from("api_servicios").select("servicio").eq("activo", true).order("orden");
  for (const { servicio } of lista || []) {
    const key = KEYS[servicio], fn = SERVICIOS[servicio];
    if (!key || !fn) continue;
    const { data: ok } = await admin.rpc("usar_api", { p: servicio });
    if (!ok) continue;
    try {
      const hits = (await fn(ask, key)).filter(h => h.street && Number.isFinite(h.lat) && Number.isFinite(h.lng));
      if (hits.length || ask.tipo === "sugerir") return answer(200, { fuente: servicio, resultados: hits });
    } catch (e) {
      if (e instanceof Agotado) await admin.rpc("agotar_api", { p: servicio });
    }
  }
  return answer(200, { fuente: null, resultados: [] });
});
