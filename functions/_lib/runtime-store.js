import { seenIp } from "./access.js";
import { createCallLog, safeUrl } from "./calls.js";
import { RUNTIME_URL, SECRET_NAMES } from "./names.js";

const ALLOWED = new Set(SECRET_NAMES);

export function sanitizeSecrets(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [name, value] of Object.entries(input)) {
    if (!ALLOWED.has(name)) continue;
    const text = String(value || "").trim();
    if (text) out[name] = text;
  }
  return out;
}

export function secret(env, data, name) {
  const overlay = data?.runtime?.[name];
  if (overlay) return String(overlay);
  return String(env?.[name] ?? "");
}

export function guardOverlay(env, values, request) {
  const out = { ...sanitizeSecrets(values) };
  const stored = out.ALLOWED_IPS;
  if (!stored) return out;
  const ip = seenIp(request);
  const listed = stored.split(",").map((item) => item.trim()).filter(Boolean);
  const current = String(env?.ALLOWED_IPS || "185.22.236.11").split(",").map((item) => item.trim()).filter(Boolean);
  if (ip && !listed.includes(ip) && current.includes(ip)) delete out.ALLOWED_IPS;
  return out;
}

async function send(env, method, body) {
  const gate = String(env?.RUNTIME_GATE || "");
  if (!gate && !env?.RUNTIME) return { skipped: true };
  const headers = { accept: "application/json", "user-agent": "skolni-obedy" };
  if (gate) headers["x-runtime-gate"] = gate;
  if (body) headers["content-type"] = "application/json";
  const init = { method, headers, body: body ? JSON.stringify(body) : undefined };
  const started = Date.now();
  try {
    const response = env?.RUNTIME
      ? await env.RUNTIME.fetch("https://runtime.internal/secrets", init)
      : await fetch(`${RUNTIME_URL}/secrets`, init);
    const text = await response.text();
    return { response, text, ms: Date.now() - started, via: env?.RUNTIME ? "binding" : "https" };
  } catch {
    return { failed: true, ms: Date.now() - started, via: env?.RUNTIME ? "binding" : "https" };
  }
}

export async function pullRuntime(env) {
  const log = createCallLog();
  log.add({
    where: "úložiště",
    method: "binding",
    url: "RUNTIME",
    status: env?.RUNTIME ? "je" : "chybí",
    ok: Boolean(env?.RUNTIME),
    ms: 0,
    note: env?.RUNTIME ? "volá se uvnitř Cloudflare" : "volá se po adrese úložiště",
  });
  if (!env?.RUNTIME_GATE && !env?.RUNTIME) {
    log.add({
      where: "úložiště",
      method: "env",
      url: "RUNTIME_GATE",
      status: "chybí",
      ok: false,
      ms: 0,
      note: "tohle nasazení úložiště nevolá, platí jen hodnoty z nasazení",
    });
    return { values: {}, calls: log.entries };
  }
  const result = await send(env, "GET");
  if (result.failed) {
    log.add({
      where: "úložiště",
      method: "GET",
      url: safeUrl(`${RUNTIME_URL}/secrets`),
      status: "selhalo",
      ok: false,
      ms: result.ms,
      note: "spojení spadlo, platí hodnoty z nasazení",
    });
    return { values: {}, calls: log.entries };
  }
  let values = {};
  if (result.response.ok) {
    try {
      values = sanitizeSecrets(JSON.parse(result.text));
    } catch {
      values = {};
    }
  }
  const present = SECRET_NAMES.filter((name) => values[name]).length;
  log.add({
    where: "úložiště",
    method: "GET",
    url: safeUrl(`${RUNTIME_URL}/secrets`),
    status: result.response.status,
    ok: result.response.ok,
    ms: result.ms,
    note: `${result.via || "https"}; ${result.response.ok ? `načteno ${present} z ${SECRET_NAMES.length}` : "čtení selhalo, platí hodnoty z nasazení"}`,
  });
  return { values, calls: log.entries };
}

export async function pushRuntime(env, pairs, log = createCallLog()) {
  const clean = pairs.filter(([name, value]) => ALLOWED.has(name) && String(value || "").trim());
  if (!env?.RUNTIME_GATE && !env?.RUNTIME) {
    log.add({
      where: "úložiště",
      method: "PUT",
      url: safeUrl(`${RUNTIME_URL}/secrets`),
      status: "chybí",
      ok: false,
      ms: 0,
      note: "RUNTIME_GATE v nasazení není, zápis počká na další vydání",
    });
    return { saved: [], calls: log.entries };
  }
  if (!clean.length) return { saved: [], calls: log.entries };
  const body = Object.fromEntries(clean.map(([name, value]) => [name, String(value).trim()]));
  const result = await send(env, "PUT", body);
  if (result.failed || !result.response) {
    log.add({
      where: "úložiště",
      method: "PUT",
      url: safeUrl(`${RUNTIME_URL}/secrets`),
      status: "selhalo",
      ok: false,
      ms: result.ms || 0,
      note: clean.map(([name]) => name).join(", "),
    });
    return { saved: [], calls: log.entries };
  }
  let saved = [];
  try {
    saved = JSON.parse(result.text).saved || [];
  } catch {
    saved = [];
  }
  log.add({
    where: "úložiště",
    method: "PUT",
    url: safeUrl(`${RUNTIME_URL}/secrets`),
    status: result.response.status,
    ok: result.response.ok && saved.length === clean.length,
    ms: result.ms,
    note: saved.length ? `uloženo ${saved.join(", ")}` : "úložiště zápis nevzalo",
  });
  return { saved, calls: log.entries };
}

export function rememberedPairs(env, values) {
  return SECRET_NAMES
    .filter((name) => String(env?.[name] || "").trim() && !values?.[name])
    .map((name) => [name, String(env[name]).trim()]);
}
