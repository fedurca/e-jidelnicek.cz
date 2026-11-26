import { readCookies } from "./_lib/access.js";
import { messagePage } from "./_lib/render.js";
import { placeOrder } from "./_lib/service.js";

const SUCCESS = { order: "objednano", change: "zmeneno", cancel: "zruseno" };

export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  const csrf = String(form.get("csrf") || "");
  const expected = readCookies(request).obed_csrf || "";
  if (!expected || expected.length !== csrf.length || expected !== csrf) {
    return new Response(messagePage("Objednávku se nepodařilo odeslat", "Otevřete přehled znovu a akci zopakujte."), {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const action = String(form.get("action") || "");
  const day = String(form.get("day") || "");
  const visitorId = Number(form.get("visitor_id"));
  const menuRaw = String(form.get("menu_type_id") || "");
  const menuTypeId = /^\d+$/.test(menuRaw) ? Number(menuRaw) : null;
  const back = (code, problem = "") => {
    const url = new URL("/", request.url);
    url.searchParams.set("zprava", code);
    if (problem) url.searchParams.set("kod", problem);
    if (Number.isInteger(visitorId)) url.searchParams.set("dite", String(visitorId));
    return Response.redirect(url, 303);
  };
  if (!SUCCESS[action] || !/^\d{4}-\d{2}-\d{2}$/.test(day) || (action !== "cancel" && menuTypeId == null)) {
    return back("chyba", "uzavreno");
  }
  const result = await placeOrder(env, { visitorId, day, action, menuTypeId });
  if (!result.ok) return back("chyba", result.code);
  return back(SUCCESS[action]);
}
