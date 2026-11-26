import { cookieHeader, ipAllowed, readCookies, seenIp, sessionMatches } from "./_lib/access.js";
import { messagePage } from "./_lib/render.js";
import { guardOverlay, pullRuntime, pushRuntime, rememberedPairs, secret } from "./_lib/runtime-store.js";

function html(body, status = 200, extra = {}) {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", ...extra });
  return new Response(body, { status, headers });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const data = context.data || (context.data = {});
  const host = url.hostname;
  const staticFile = url.pathname === "/style.css" || url.pathname === "/favicon.svg";
  if (!staticFile && !data.runtime) {
    try {
      const pulled = await pullRuntime(env);
      const remembered = rememberedPairs(env, pulled.values);
      if (remembered.length) {
        const seeded = await pushRuntime(env, remembered);
        pulled.calls.push(...seeded.calls.filter((entry) => entry.method === "PUT"));
        for (const [name, value] of remembered) {
          if (seeded.saved.includes(name)) pulled.values[name] = value;
        }
      }
      data.runtime = guardOverlay(env, pulled.values, request);
      data.runtimeCalls = pulled.calls;
    } catch {
      data.runtime = {};
      data.runtimeCalls = [];
    }
  }
  const accessEnv = {
    ACCESS_UUID: secret(env, data, "ACCESS_UUID"),
    ALLOWED_IPS: secret(env, data, "ALLOWED_IPS"),
  };
  const local = host === "localhost" || host === "127.0.0.1";
  if (!local && !accessEnv.ACCESS_UUID) {
    return html(messagePage("Chybí přístupový kód", "V Cloudflare nastavte tajnou proměnnou ACCESS_UUID."), 503);
  }
  if (!ipAllowed(request, accessEnv)) {
    const ip = seenIp(request) || "neznámé adresy";
    return html(messagePage("Sem to z téhle adresy nejde", `Připojení z ${ip} sem nepouštíme.`), 403);
  }
  const open = url.pathname === "/vstup" || url.pathname === "/zdravi" || url.pathname === "/style.css" || url.pathname === "/favicon.svg";
  if (open || !accessEnv.ACCESS_UUID) return next();
  const cookies = readCookies(request);
  if (await sessionMatches(cookies.obed_vstup || "", accessEnv.ACCESS_UUID)) return next();
  return new Response(null, {
    status: 303,
    headers: { Location: "/vstup" },
  });
}
