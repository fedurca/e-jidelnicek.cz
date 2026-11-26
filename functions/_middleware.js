import { cookieHeader, ipAllowed, readCookies, seenIp, sessionMatches } from "./_lib/access.js";
import { messagePage } from "./_lib/render.js";

function html(body, status = 200, extra = {}) {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", ...extra });
  return new Response(body, { status, headers });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const host = url.hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  if (!local && !env.ACCESS_UUID) {
    return html(messagePage("Chybí přístupový kód", "V Cloudflare nastavte tajnou proměnnou ACCESS_UUID."), 503);
  }
  if (!ipAllowed(request, env)) {
    const ip = seenIp(request) || "neznámé adresy";
    return html(messagePage("Sem to z téhle adresy nejde", `Připojení z ${ip} sem nepouštíme.`), 403);
  }
  const open = url.pathname === "/vstup" || url.pathname === "/zdravi" || url.pathname === "/style.css" || url.pathname === "/favicon.svg";
  if (open || !env.ACCESS_UUID) return next();
  const cookies = readCookies(request);
  if (await sessionMatches(cookies.obed_vstup || "", env.ACCESS_UUID)) return next();
  return new Response(null, {
    status: 303,
    headers: { Location: "/vstup" },
  });
}
