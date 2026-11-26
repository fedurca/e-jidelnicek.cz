import { cookieHeader, readCookies } from "./_lib/access.js";
import { addLocalBindings, addProjectGap } from "./_lib/bindings.js";
import { createCallLog, renderCalls } from "./_lib/calls.js";
import { esc, messagePage, BUILD } from "./_lib/render.js";
import { SECRET_FIELDS, collectSecrets, storeSecrets } from "./_lib/store-secrets.js";

function secure(request) {
  return new URL(request.url).protocol === "https:";
}

function page(csrf, notice = "", calls = [], ok = true) {
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
    ${notice ? `<p class="flash flash-${ok ? "ok" : "bad"}">${esc(notice)}</p>` : ""}
    <p>Prázdné pole se nepřepíše. Vyplněná hodnota se hned zapíše do úložiště, ze kterého tahle stránka čte při každém otevření. Stejná hodnota jde i do GitHub secrets a do nastavení projektu Cloudflare. Samotné nastavení projektu se do běžícího nasazení nedostane, dokud nevyjde nové. Do gitu se nezapíše.</p>
    <form method="post" action="/hesla">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      ${fields}
      <button type="submit" class="btn btn-primary">Uložit do secrets</button>
    </form>
    <h2>Co je ve funkci teď</h2>
    ${renderCalls(calls)}
    <p class="school-meta">Nasazení ${BUILD}</p>
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

async function report(env, data, prior = []) {
  const log = createCallLog();
  for (const entry of prior) log.entries.push(entry);
  addLocalBindings(env, data, log);
  await addProjectGap(env, log);
  return log.entries;
}

export async function onRequestGet({ request, env, data }) {
  const url = new URL(request.url);
  const csrf = crypto.randomUUID();
  const notice = url.searchParams.get("ulozeno") || "";
  const calls = await report(env, data, data?.runtimeCalls || []);
  return html(page(csrf, notice, calls), 200, [cookieHeader("obed_csrf", csrf, { secure: secure(request) })]);
}

export async function onRequestPost({ request, env, data }) {
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
    const view = { ...(data?.runtime || {}) };
    for (const [name, value] of pairs) {
      if (saved.stored.includes(name)) view[name] = value;
    }
    const calls = await report(env, { runtime: view }, [...(data?.runtimeCalls || []), ...saved.calls]);
    const parts = [];
    if (saved.stored.length) parts.push(`Úložiště, které stránka čte hned: ${saved.stored.join(", ")}`);
    if (saved.github.length) parts.push(`GitHub: ${saved.github.join(", ")}`);
    if (saved.cloudflare.length) parts.push(`Projekt Cloudflare, až v dalším nasazení: ${saved.cloudflare.join(", ")}`);
    if (!saved.githubReady) parts.push("GitHub token ve funkci chybí");
    if (saved.errors.length) parts.push(saved.errors.join(". "));
    return html(page(fresh, parts.join(". ") || "Nic se neuložilo.", calls, saved.errors.length === 0 && saved.stored.length > 0), 200, [cookie]);
  } catch {
    return html(page(fresh, ""), 502, [cookie]);
  }
}
