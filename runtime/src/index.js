import { SECRET_NAMES } from "../../functions/_lib/names.js";

const ALLOWED = new Set(SECRET_NAMES);
const MAX_VALUE = 500;

async function gateMatches(left, right) {
  if (!right) return false;
  const enc = new TextEncoder();
  const digest = async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
  const [a, b] = await Promise.all([digest(String(left || "")), digest(right)]);
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

function no() {
  return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
}

export default {
  async fetch(request, env) {
    if (!(await gateMatches(request.headers.get("x-runtime-gate") || "", String(env.GATE || "")))) return no();
    const url = new URL(request.url);
    if (url.pathname !== "/secrets") return no();
    if (request.method === "GET") {
      const out = {};
      for (const name of SECRET_NAMES) {
        const value = await env.SECRETS.get(name);
        if (value) out[name] = value;
      }
      return Response.json(out, { headers: { "cache-control": "no-store" } });
    }
    if (request.method === "PUT") {
      const text = await request.text();
      if (text.length > 8000) return new Response(null, { status: 413, headers: { "cache-control": "no-store" } });
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return new Response(null, { status: 400, headers: { "cache-control": "no-store" } });
      }
      const saved = [];
      for (const [name, value] of Object.entries(body || {})) {
        if (!ALLOWED.has(name)) continue;
        const clean = String(value || "").trim();
        if (!clean || clean.length > MAX_VALUE) continue;
        await env.SECRETS.put(name, clean);
        saved.push(name);
      }
      return Response.json({ saved }, { headers: { "cache-control": "no-store" } });
    }
    return no();
  },
};
