import { cookieHeader, readCookies } from "./_lib/access.js";
import { esc, messagePage } from "./_lib/render.js";
import { SECRET_FIELDS, collectSecrets, storeSecrets } from "./_lib/store-secrets.js";

function secure(request) {
  return new URL(request.url).protocol === "https:";
}

function page(csrf, notice = "") {
  const fields = SECRET_FIELDS.map(([name, label]) => `<label for="${esc(name)}">${esc(label)} <code>${esc(name)}</code></label>
    <input id="${esc(name)}" name="${esc(name)}" type="password" autocomplete="off" value="${name === "EDOOKIT_BASE_URL" ? "https://zsmsene.edookit.net" : ""}">`).join("");
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Uložit hesla</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="mast"><div class="wrap mast-inner"><p class="eyebrow">Školní jídelna</p><h1>Uložit hesla</h1></div></header>
  <main class="wrap"><section class="panel">
    ${notice ? `<p class="flash flash-ok">${esc(notice)}</p>` : ""}
    <p>Prázdné pole se nepřepíše. Vyplněné hodnoty se uloží jako GitHub secrets repozitáře fedurca/e-jidelnicek.cz a zároveň do Cloudflare Pages, aby je stránka mohla použít. Do gitu se nezapíšou.</p>
    <form method="post" action="/hesla">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      ${fields}
      <button type="submit" class="btn btn-primary">Uložit do secrets</button>
    </form>
    <p><a class="text-link" href="/">Zpět na přehled</a></p>
  </section></main>
</body>
</html>`;
}

function html(body, status, cookies = []) {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(body, { status, headers });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const csrf = crypto.randomUUID();
  const notice = url.searchParams.get("ulozeno") || "";
  return html(page(csrf, notice), 200, [cookieHeader("obed_csrf", csrf, { secure: secure(request) })]);
}

export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  const csrf = String(form.get("csrf") || "");
  const expected = readCookies(request).obed_csrf || "";
  const fresh = crypto.randomUUID();
  const cookie = cookieHeader("obed_csrf", fresh, { secure: secure(request) });
  if (!expected || expected.length !== csrf.length || expected !== csrf) {
    return html(messagePage("Hesla se neuložila", "Otevřete formulář znovu."), 403, [cookie]);
  }
  const pairs = collectSecrets(form);
  if (!pairs.length) return html(page(fresh, ""), 200, [cookie]);
  try {
    const saved = await storeSecrets(env, pairs);
    const parts = [];
    if (saved.github.length) parts.push(`GitHub: ${saved.github.join(", ")}`);
    if (saved.cloudflare.length) parts.push(`Cloudflare: ${saved.cloudflare.join(", ")}`);
    if (!saved.githubReady) parts.push("GitHub token ve funkci chybí");
    if (saved.errors.length) parts.push(saved.errors.join(". "));
    const url = new URL("/hesla", request.url);
    url.searchParams.set("ulozeno", parts.join(". ") || "Nic se neuložilo.");
    const headers = new Headers({ Location: url.pathname + url.search });
    headers.append("set-cookie", cookie);
    return new Response(null, { status: 303, headers });
  } catch {
    return html(page(fresh, ""), 502, [cookie]);
  }
}
