// Ruta Escáner: lee la etiqueta con Gemini usando TU clave, guardada en Supabase (nadie la ve).
// Solo atiende a usuarios con cuenta activa (tabla «perfiles», activo = true).
// Se pega en Supabase > Edge Functions > Deploy a new function > Via Editor, con el nombre «leer-etiqueta».
// La clave va en Edge Functions > Secrets con el nombre GEMINI_API_KEY.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODELS = (Deno.env.get("GEMINI_MODELS") || "gemini-flash-latest,gemini-3.6-flash,gemini-3.5-flash-lite").split(",");
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return answer(405, { error: "solo POST" });

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return answer(500, { error: "falta GEMINI_API_KEY en Secrets" });

  // quién es y si su cuenta está activa
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data: u } = await sb.auth.getUser();
  if (!u || !u.user) return answer(401, { error: "sin sesión" });
  const { data: perfil } = await sb.from("perfiles").select("activo").eq("id", u.user.id).maybeSingle();
  if (!perfil || !perfil.activo) return answer(403, { error: "cuenta no activa" });

  // solo se acepta una foto y el texto de la consulta (no sirve para otra cosa)
  const raw = await req.text();
  if (raw.length > 8_000_000) return answer(413, { error: "foto muy grande" });
  let body: any;
  try { body = JSON.parse(raw); } catch { return answer(400, { error: "pedido inválido" }); }
  const parts = body?.contents?.[0]?.parts;
  const img = Array.isArray(parts) && parts.find((p: any) => p?.inline_data?.data);
  const txt = Array.isArray(parts) && parts.find((p: any) => typeof p?.text === "string");
  if (!img || !txt || String(txt.text).length > 20000) return answer(400, { error: "pedido inválido" });
  const clean = {
    contents: [{ parts: [
      { inline_data: { mime_type: String(img.inline_data.mime_type || "image/jpeg"), data: String(img.inline_data.data) } },
      { text: String(txt.text) },
    ] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };

  let last = "Gemini no respondió";
  for (const model of MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.trim()}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(clean),
    });
    if (r.status === 404) { last = "modelo no disponible"; continue; }
    if (r.status === 429) return answer(429, { error: "se acabó el cupo de Gemini por ahora" });
    if (!r.ok) return answer(502, { error: "Gemini respondió " + r.status });
    return answer(200, await r.json());
  }
  return answer(502, { error: last });
});
