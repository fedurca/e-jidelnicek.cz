const SESSION = "obedy-vstup-v1";

export function allowedIps(env) {
  return String(env.ALLOWED_IPS || "185.22.236.11")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function seenIp(request) {
  return (request.headers.get("cf-connecting-ip") || "").trim();
}

export function ipAllowed(request, env) {
  const host = new URL(request.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;
  return allowedIps(env).includes(seenIp(request));
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return hex(digest);
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function same(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export async function codeMatches(code, expected) {
  if (!expected) return false;
  return same(await sha256(String(code || "").trim()), await sha256(expected));
}

export async function sessionValue(uuid) {
  return hmac(uuid, SESSION);
}

export async function sessionMatches(token, uuid) {
  if (!uuid || !token) return false;
  return same(token, await sessionValue(uuid));
}

export function readCookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const text = part.trim();
    if (!text) continue;
    const eq = text.indexOf("=");
    if (eq < 0) continue;
    out[text.slice(0, eq)] = decodeURIComponent(text.slice(eq + 1));
  }
  return out;
}

export function cookieHeader(name, value, { secure = false, maxAge = 60 * 60 * 24 * 14 } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
