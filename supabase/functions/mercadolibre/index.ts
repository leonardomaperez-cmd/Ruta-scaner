// Ruta Escáner: vendedores de Mercado Libre vinculados y dirección de los envíos Flex.
// Se pega en Supabase > Edge Functions > Deploy a new function > Via Editor, con el nombre «mercadolibre».
// IMPORTANTE: en la función, apagar «Verify JWT» (Enforce JWT verification): el vendedor que toca el link
// no tiene cuenta en la app. La función revisa la sesión del chofer ella misma donde hace falta.
// Secrets: ML_CLIENT_SECRET (la Secret Key de la app en developers.mercadolibre). ML_CLIENT_ID es opcional.
//
// Acciones (POST con {accion, ...}):
//   link         (chofer con sesión)  → { url } para mandarle al vendedor
//   canjear      (vendedor, sin sesión) { code, state } → { ok, apodo }
//   envio        (chofer con sesión)  { id, sender_id? } → { address, ref, lat, lng, receptor } o { encontrado: false }
//   vendedores   (chofer con sesión)  → { vendedores: [{ id, apodo }] }
//   desvincular  (chofer con sesión)  { ml_user_id } → { ok }
import { createClient } from "jsr:@supabase/supabase-js@2";

const CLIENT_ID = Deno.env.get("ML_CLIENT_ID") || "1243284537530435";
const CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET") || "";
const REDIRECT = "https://leonardomaperez-cmd.github.io/Ruta-scaner/";
const AUTH_URL = "https://auth.mercadolibre.com.ar/authorization";
const API = "https://api.mercadolibre.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const challenge = async (v: string) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))));

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function chofer(req: Request) {
  const sb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data } = await sb.auth.getUser();
  return data && data.user ? data.user.id : null;
}

async function token(form: Record<string, string>) {
  const r = await fetch(API + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...form }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.message || j.error || "Mercado Libre respondió " + r.status);
  return j as { access_token: string; refresh_token?: string; expires_in: number; user_id: number };
}

// token vigente de un vendedor; si está por vencer, lo renueva con el refresh_token
async function tokenDe(v: any) {
  if (new Date(v.vence).getTime() - Date.now() > 120000) return v.access_token as string;
  if (!v.refresh_token) return null;
  try {
    const t = await token({ grant_type: "refresh_token", refresh_token: v.refresh_token });
    await admin.from("ml_vendedores").update({
      access_token: t.access_token, refresh_token: t.refresh_token || v.refresh_token,
      vence: new Date(Date.now() + t.expires_in * 1000).toISOString(), actualizado: new Date().toISOString(),
    }).eq("ml_user_id", v.ml_user_id);
    return t.access_token;
  } catch { return null; }
}

const nombre = (x: any) => (x && typeof x === "object" ? x.name : x) || "";
const junta = (xs: string[]) => xs.map(s => String(s || "").trim()).filter((s, i, l) => s && l.indexOf(s) === i).join(", ");

// la dirección del destinatario, en el formato nuevo (destination.shipping_address) o el viejo (receiver_address)
function direccion(s: any) {
  const a = (s.destination && s.destination.shipping_address) || s.receiver_address || {};
  const calle = a.street_name ? (a.street_name + (a.street_number ? " " + a.street_number : "")) : (a.address_line || "");
  const piso = a.floor || a.apartment ? [a.floor ? "Piso " + a.floor : "", a.apartment ? "Dpto " + a.apartment : ""].filter(Boolean).join(" ") : "";
  const lat = Number(a.geolocation_latitude ?? a.latitude), lng = Number(a.geolocation_longitude ?? a.longitude);
  return {
    address: junta([calle, nombre(a.neighborhood), nombre(a.city), nombre(a.state)]),
    cp: a.zip_code || "",
    ref: junta([piso, a.comment || ""]),
    lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
    lng: Number.isFinite(lng) && lng !== 0 ? lng : null,
    receptor: (s.destination && s.destination.receiver_name) || a.receiver_name || "",
    estado: s.status || "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return answer(405, { error: "solo POST" });
  if (!CLIENT_SECRET) return answer(500, { error: "falta el secret ML_CLIENT_SECRET en Supabase" });
  let b: any;
  try { b = await req.json(); } catch { return answer(400, { error: "pedido inválido" }); }
  const accion = String(b?.accion || "");

  // el vendedor vuelve de Mercado Libre con un código: se cambia por sus tokens
  if (accion === "canjear") {
    const code = String(b?.code || ""), state = String(b?.state || "");
    if (!code || !state) return answer(400, { error: "faltan datos" });
    const { data: e } = await admin.from("ml_estados").select("*").eq("estado", state).maybeSingle();
    if (!e) return answer(400, { error: "el link ya se usó o no es válido; pedile uno nuevo al repartidor" });
    await admin.from("ml_estados").delete().eq("estado", state);
    if (Date.now() - new Date(e.creado).getTime() > 7 * 864e5) return answer(400, { error: "el link venció; pedile uno nuevo al repartidor" });
    let t;
    try { t = await token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: e.verificador }); }
    catch (err) { return answer(400, { error: String((err as Error).message) }); }
    let apodo = "";
    try { const me = await (await fetch(API + "/users/me", { headers: { Authorization: "Bearer " + t.access_token } })).json(); apodo = me.nickname || ""; } catch {}
    await admin.from("ml_vendedores").upsert({
      ml_user_id: t.user_id, apodo, access_token: t.access_token, refresh_token: t.refresh_token || null,
      vence: new Date(Date.now() + t.expires_in * 1000).toISOString(), actualizado: new Date().toISOString(),
    });
    await admin.from("ml_vinculos").upsert({ chofer: e.chofer, ml_user_id: t.user_id });
    return answer(200, { ok: true, apodo });
  }

  const quien = await chofer(req);
  if (!quien) return answer(401, { error: "sin sesión" });

  if (accion === "link") {
    const estado = random(24), verificador = random(48);
    await admin.from("ml_estados").delete().lt("creado", new Date(Date.now() - 7 * 864e5).toISOString());
    const { error } = await admin.from("ml_estados").insert({ estado, verificador, chofer: quien });
    if (error) return answer(500, { error: "no se pudo crear el link" });
    const u = new URL(AUTH_URL);
    u.searchParams.set("response_type", "code"); u.searchParams.set("client_id", CLIENT_ID);
    u.searchParams.set("redirect_uri", REDIRECT); u.searchParams.set("state", estado);
    u.searchParams.set("code_challenge", await challenge(verificador)); u.searchParams.set("code_challenge_method", "S256");
    return answer(200, { url: u.toString() });
  }

  if (accion === "vendedores") {
    const { data } = await admin.from("ml_vinculos").select("ml_user_id, ml_vendedores(apodo)").eq("chofer", quien);
    return answer(200, { vendedores: (data || []).map((v: any) => ({ id: v.ml_user_id, apodo: v.ml_vendedores?.apodo || String(v.ml_user_id) })) });
  }

  if (accion === "desvincular") {
    await admin.from("ml_vinculos").delete().eq("chofer", quien).eq("ml_user_id", Number(b?.ml_user_id));
    return answer(200, { ok: true });
  }

  if (accion === "envio") {
    const id = String(b?.id || "").replace(/\D/g, ""), sender = String(b?.sender_id || "").replace(/\D/g, "");
    if (!id) return answer(400, { error: "falta el número de envío" });
    let q = admin.from("ml_vinculos").select("ml_user_id, ml_vendedores(*)").eq("chofer", quien);
    if (sender) q = q.eq("ml_user_id", Number(sender));
    const { data: vs } = await q;
    for (const v of vs || []) {
      const vend = (v as any).ml_vendedores; if (!vend) continue;
      const tk = await tokenDe(vend); if (!tk) continue;
      const r = await fetch(`${API}/shipments/${id}`, { headers: { Authorization: "Bearer " + tk, "x-format-new": "true" } });
      if (!r.ok) continue;
      const d = direccion(await r.json());
      if (d.address) return answer(200, { encontrado: true, vendedor: vend.apodo || "", ...d });
    }
    return answer(200, { encontrado: false, vinculado: (vs || []).length > 0 });
  }

  return answer(400, { error: "acción desconocida" });
});
