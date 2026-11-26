import { AppError, currentBoard } from "./_lib/service.js";
import { loadSchool } from "./_lib/edookit.js";
import { boardPage, flashText, messagePage } from "./_lib/render.js";
import { cookieHeader } from "./_lib/access.js";

function secure(request) {
  return new URL(request.url).protocol === "https:";
}

export async function onRequestGet({ request, env, data }) {
  const url = new URL(request.url);
  const csrf = crypto.randomUUID();
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  headers.append("set-cookie", cookieHeader("obed_csrf", csrf, { secure: secure(request) }));
  try {
    const [{ board }, school] = await Promise.all([currentBoard(env, data), loadSchool(env, data)]);
    if (data?.runtimeCalls?.length) school.calls = [...data.runtimeCalls, ...(school.calls || [])];
    return new Response(boardPage(board, { csrf, flash: flashText(url, board), school }), { headers });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "canteen";
    const text = code === "credentials"
      ? "V Cloudflare nastavte tajné proměnné EJIDELNICEK_EMAIL a EJIDELNICEK_PASSWORD. Do repozitáře heslo nepatří."
      : code === "login"
        ? "Jídelna přihlášení odmítla. Zkontrolujte e-mail a heslo v tajných proměnných."
        : "Spojení s e-Jídelníčkem se nepovedlo. Zkuste stránku obnovit.";
    const title = code === "credentials" ? "Chybí přihlášení do jídelny" : code === "login" ? "Jídelna přihlášení odmítla" : "Jídelna teď neodpovídá";
    return new Response(messagePage(title, text), { status: code === "credentials" ? 200 : 502, headers });
  }
}
