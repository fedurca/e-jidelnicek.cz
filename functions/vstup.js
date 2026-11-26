import { codeMatches, cookieHeader, readCookies, sessionValue } from "./_lib/access.js";
import { loginPage } from "./_lib/render.js";

function secure(request) {
  return new URL(request.url).protocol === "https:";
}

function html(body, status, cookies = []) {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(body, { status, headers });
}

export async function onRequestGet({ request, env }) {
  if (!env.ACCESS_UUID) return Response.redirect(new URL("/", request.url), 303);
  const csrf = crypto.randomUUID();
  return html(loginPage({ csrf, error: "" }), 200, [cookieHeader("obed_csrf", csrf, { secure: secure(request) })]);
}

export async function onRequestPost({ request, env }) {
  if (!env.ACCESS_UUID) return Response.redirect(new URL("/", request.url), 303);
  const form = await request.formData();
  const csrf = String(form.get("csrf") || "");
  const code = String(form.get("kod") || "");
  const expected = readCookies(request).obed_csrf || "";
  const csrfOk = expected && expected.length === csrf.length && expected === csrf;
  const fresh = crypto.randomUUID();
  const cookie = cookieHeader("obed_csrf", fresh, { secure: secure(request) });
  if (!csrfOk || !(await codeMatches(code, env.ACCESS_UUID))) {
    return html(loginPage({ csrf: fresh, error: "Kód nesedí." }), csrfOk ? 401 : 403, [cookie]);
  }
  const headers = new Headers({ Location: "/" });
  headers.append("set-cookie", cookie);
  headers.append("set-cookie", cookieHeader("obed_vstup", await sessionValue(env.ACCESS_UUID), {
    secure: secure(request),
    maxAge: 60 * 60 * 24 * 30,
  }));
  return new Response(null, { status: 303, headers });
}
