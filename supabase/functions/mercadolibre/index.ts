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
const REDIRECT = Deno.env.get("ML_REDIRECT") || "https://leonardomaperez-cmd.github.io/Ruta-scaner/"; // si la app cambia de dirección, cargar el Secret ML_REDIRECT
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
    // primero la cuenta del vendedor del QR; después cualquier otra cuenta vinculada por este chofer
    // (por ejemplo su propia cuenta de chofer Flex, por si Mercado Libre le muestra los envíos que tiene asignados)
    const { data: todas } = await admin.from("ml_vinculos").select("ml_user_id, ml_vendedores(*)").eq("chofer", quien);
    // Para no generar errores 4xx de más (Mercado Libre puede bloquear apps con muchos 400/403):
    // en el uso normal solo se pregunta con la cuenta del vendedor del QR; las demás cuentas vinculadas
    // (por ejemplo una cuenta de mensajería) solo se prueban en modo prueba o si el chofer marcó "mensajería".
    const delVendedor = (todas || []).filter((v: any) => String(v.ml_user_id) === sender);
    const vs = delVendedor.length && !b?.prueba && !b?.courier ? delVendedor
      : (todas || []).slice().sort((a: any, b: any) => (String(b.ml_user_id) === sender ? 1 : 0) - (String(a.ml_user_id) === sender ? 1 : 0));
    if (!vs.length || (!delVendedor.length && !b?.prueba && !b?.courier)) return answer(200, { encontrado: false, vinculado: (todas || []).length > 0 });
    let courierError = false;
    const prueba = !!b?.prueba, courier = !!b?.courier, intentos: unknown[] = [];
    for (const v of vs) {
      const vend = (v as any).ml_vendedores; if (!vend) continue;
      const tk = await tokenDe(vend);
      if (!tk) { intentos.push({ cuenta: vend.apodo || v.ml_user_id, estado: "sin token (volver a vincular)" }); continue; }
      if (prueba) {
        // paso de prueba: ¿esta cuenta tiene Flex? (GET /flex/sites/MLA/users/{USER_ID}/subscriptions/v1)
        const rs = await fetch(`${API}/flex/sites/MLA/users/${v.ml_user_id}/subscriptions/v1`, { headers: { Authorization: "Bearer " + tk } });
        const js = await rs.json().catch(() => ({}));
        const tieneFlex = JSON.stringify(js).toUpperCase().includes('"FLEX"');
        intentos.push({ cuenta: (vend.apodo || v.ml_user_id) + " (¿tiene Flex?)", estado: rs.status, mensaje: rs.ok ? (tieneFlex ? "sí, tiene suscripción FLEX" : "respondió pero sin FLEX: " + JSON.stringify(js).slice(0, 150)) : (js.message || js.error || "") });
        // paso de prueba: ¿a qué chofer está asignado este envío? (GET /flex/sites/MLA/shipments/{id}/assignment/v2)
        const ra = await fetch(`${API}/flex/sites/MLA/shipments/${id}/assignment/v2`, { headers: { Authorization: "Bearer " + tk } });
        const ja = await ra.json().catch(() => ({}));
        intentos.push({ cuenta: (vend.apodo || v.ml_user_id) + " (¿asignado a quién?)", estado: ra.status, mensaje: ra.ok ? JSON.stringify(ja).slice(0, 200) : (ra.status === 404 ? "sin chofer asignado o sin ruta abierta: " : ra.status === 403 ? "tu cuenta no tiene acceso: " : "") + (ja.message || ja.error || "") });
      }
      let r = await fetch(`${API}/shipments/${id}`, { headers: { Authorization: "Bearer " + tk, "x-format-new": "true" } });
      let j = await r.json().catch(() => ({}));
      // cuenta de MENSAJERÍA (courier Flex): si todavía no ve el envío, primero lo registra a su nombre
      // (POST /flex/sites/MLA/users/{COURIER_USER_ID}/courier-shipment/v1) y después vuelve a pedir la dirección.
      // Solo cuando el chofer marcó en Ajustes que su cuenta conectada es de mensajería.
      if (!r.ok && courier) {
        const rc = await fetch(`${API}/flex/sites/MLA/users/${v.ml_user_id}/courier-shipment/v1`, {
          method: "POST",
          headers: { Authorization: "Bearer " + tk, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ shipment_id: Number(id) }),
        });
        const jc = await rc.json().catch(() => ({}));
        intentos.push({ cuenta: (vend.apodo || v.ml_user_id) + " (registrar como mensajería)", estado: rc.status, mensaje: rc.ok ? "registrado (aceptado)" : (rc.status === 409 ? "el envío ya está asignado a una mensajería" : rc.status === 403 ? "sin permiso (falta vinculación/autorización como mensajería): " : "") + (rc.ok ? "" : (jc.message || jc.error || JSON.stringify(jc).slice(0, 200))) });
        if (!rc.ok && rc.status >= 400 && rc.status < 500 && rc.status !== 429 && rc.status !== 409) courierError = true;
        if (rc.ok || rc.status === 409) {
          r = await fetch(`${API}/shipments/${id}`, { headers: { Authorization: "Bearer " + tk, "x-format-new": "true" } });
          j = await r.json().catch(() => ({}));
        }
      }
      if (!r.ok) { intentos.push({ cuenta: vend.apodo || v.ml_user_id, estado: r.status, mensaje: j.message || j.error || "" }); continue; }
      const d = direccion(j);
      intentos.push({ cuenta: vend.apodo || v.ml_user_id, estado: r.status, mensaje: (d.address ? "trae dirección" : "sin dirección en la respuesta") + (j.status ? ` (estado: ${j.status}${j.substatus ? " / " + j.substatus : ""})` : "") });
      if (d.address) return answer(200, { encontrado: true, vendedor: vend.apodo || "", ...d, ...(prueba ? { intentos } : {}) });
    }
    return answer(200, { encontrado: false, vinculado: vs.length > 0, ...(courierError ? { courier_error: true } : {}), ...(prueba ? { intentos } : {}) });
  }

  return answer(400, { error: "acción desconocida" });
});
