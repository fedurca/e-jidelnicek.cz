import assert from "node:assert/strict";
import test from "node:test";
import { ipAllowed, sessionValue } from "../functions/_lib/access.js";
import { buildBoard } from "../functions/_lib/board.js";
import { onRequest as guard } from "../functions/_middleware.js";
import { onRequestGet, onRequestPost } from "../functions/vstup.js";
import { pragueInstant, pragueYmd } from "../functions/_lib/time.js";

function request(url, headers = {}) {
  return new Request(url, { headers });
}

test("cloudflare pages accepts only the home ip", () => {
  const env = { ALLOWED_IPS: "185.22.236.11" };
  assert.equal(ipAllowed(request("http://127.0.0.1:8741/"), env), true);
  assert.equal(ipAllowed(request("https://obedy.pages.dev/", { "CF-Connecting-IP": "185.22.236.11" }), env), true);
  assert.equal(ipAllowed(request("https://obedy.pages.dev/", { "CF-Connecting-IP": "8.8.8.8", "X-Forwarded-For": "185.22.236.11" }), env), false);
});

function month(year, monthNumber, days, marks) {
  let out = "";
  for (let day = 1; day <= days; day += 1) {
    const ymd = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const js = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
    out += marks[ymd] || (js === 0 || js === 6 ? "*" : "N");
  }
  return out;
}

test("the access code opens the page and a foreign ip does not", async () => {
  const env = { ACCESS_UUID: "test-code", ALLOWED_IPS: "185.22.236.11" };
  const headers = { "CF-Connecting-IP": "185.22.236.11" };
  const login = await onRequestGet({ request: new Request("https://obedy.pages.dev/vstup", { headers }), env });
  const csrf = decodeURIComponent(/obed_csrf=([^;]+)/.exec(login.headers.get("set-cookie"))[1]);
  const posted = await onRequestPost({
    request: new Request("https://obedy.pages.dev/vstup", {
      method: "POST",
      headers: { ...headers, cookie: `obed_csrf=${encodeURIComponent(csrf)}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf, kod: "test-code" }),
    }),
    env,
  });
  const session = posted.headers.getSetCookie().find((item) => item.startsWith("obed_vstup="));
  const opened = await guard({
    request: new Request("https://obedy.pages.dev/", { headers: { ...headers, cookie: session.split(";")[0] } }),
    env,
    next: () => new Response("ok"),
  });
  assert.equal(await opened.text(), "ok");
  const foreign = await guard({
    request: new Request("https://obedy.pages.dev/", { headers: { "CF-Connecting-IP": "1.1.1.1", cookie: session.split(";")[0] } }),
    env,
    next: () => new Response("ok"),
  });
  assert.equal(foreign.status, 403);
  assert.equal(await sessionValue("test-code"), decodeURIComponent(session.slice("obed_vstup=".length).split(";")[0]));
});

test("board keeps friday closed and monday open on thursday evening", () => {
  const child = {
    id: 7,
    given_name: "Ema",
    full_name: "Nováková Ema",
    class_label: "5. třída",
    account: "80",
    meal_price: 40,
    canteen_id: 3,
    canteen_name: "Školní jídelna",
    ordering_active: true,
    skip_closed: true,
    prefer_global: false,
    diets: [{
      id: 607,
      name: "Oběd",
      order_limit_order: 1,
      order_limit_change: 1,
      order_limit_cancel: 1,
      order_time_to: "16:00:00",
      change_time_to: "16:00:00",
      cancel_time_to: "16:00:00",
    }],
    menu_types: [
      { id: 10, name: "Polévka", order_code: 0, can_be_ordered: false, display_order: 1 },
      { id: 11, name: "Menu 1", order_code: 1, can_be_ordered: true, display_order: 2 },
    ],
  };
  const menu = (ymd, typeId, name) => ({
    menu_id: Number(ymd.replaceAll("-", "")) + typeId,
    menu_type_id: typeId,
    diet_id: 607,
    canteen_id: 3,
    date: pragueInstant(ymd, "00:00:00").toISOString(),
    names: [{ language: "cs", name }],
  });
  const orders = [
    { visitor_id: 7, diet_id: 607, date: "2026-10-31T23:00:00.000Z", data_ordered: month(2026, 11, 30, {}) },
    { visitor_id: 7, diet_id: 607, date: "2026-11-30T23:00:00.000Z", data_ordered: month(2026, 12, 31, { "2026-12-02": "1" }) },
  ];
  const menus = [
    menu("2026-11-27", 11, "Čevabčiči"),
    menu("2026-11-30", 11, "Dukátové buchtičky"),
    menu("2026-12-02", 11, "Karbanátek"),
  ];
  const board = buildBoard([child], orders, menus, pragueInstant("2026-11-26", "18:00:00"));
  const thisWeek = Object.fromEntries(board.weeks[0].rows.map((row) => [row.date, row.cells[0]]));
  const nextWeek = Object.fromEntries(board.weeks[1].rows.map((row) => [row.date, row.cells[0]]));
  assert.equal(thisWeek["2026-11-27"].tone, "closed");
  assert.equal(thisWeek["2026-11-27"].mains[0].name, "Čevabčiči");
  assert.equal(nextWeek["2026-11-30"].tone, "open");
  assert.equal(nextWeek["2026-12-02"].tone, "ordered");
  assert.equal(nextWeek["2026-12-02"].mains[0].name, "Karbanátek");
  assert.equal(board.still_open.some((item) => item.dish === "Dukátové buchtičky"), true);
  assert.equal(pragueYmd(new Date("2026-10-31T23:00:00.000Z")), "2026-11-01");
});
