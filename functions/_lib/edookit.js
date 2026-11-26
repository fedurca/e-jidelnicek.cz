import { addLocalBindings, addProjectGap, gapSentence } from "./bindings.js";
import { createCallLog, safeUrl } from "./calls.js";
import { secret } from "./runtime-store.js";
import {
  parseAbsenceSummary,
  parseExcused,
  parseGrades,
  parseMessages,
  parsePayments,
  parseStudents,
  parseTimetable,
} from "./school-parse.js";

const REALM = "uuIdentityAccessCodesAuthNRealm";
const AUTHENTICATE = "https://uuidentity.plus4u.net/uu-oidc-maing02/bb977a99f4cc4c37a2afce3fd599d0a7/authAccessCodes/authenticate";

export class EdookitError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function schoolBase(value) {
  const base = String(value || "https://zsmsene.edookit.net").replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.edookit\.net$/.test(base)) throw new EdookitError("config");
  return base;
}

class Session {
  constructor(log) {
    this.jar = new Map();
    this.log = log;
  }

  store(url, response) {
    const host = new URL(url).hostname;
    for (const line of response.headers.getSetCookie?.() || []) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      this.jar.set(`${host}|${name}`, { host, name, value: pair.slice(eq + 1).trim() });
    }
  }

  header(url) {
    const host = new URL(url).hostname;
    return [...this.jar.values()]
      .filter((cookie) => host === cookie.host || host.endsWith(`.${cookie.host}`))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  }

  async send(url, { method = "GET", body, headers = {} } = {}) {
    const requestHeaders = { accept: "text/html,application/json", "user-agent": "Mozilla/5.0", ...headers };
    const cookie = this.header(url);
    if (cookie) requestHeaders.cookie = cookie;
    const started = Date.now();
    const response = await fetch(url, { method, headers: requestHeaders, body, redirect: "manual" });
    this.store(url, response);
    this.log?.add({
      where: "Edookit",
      method,
      url: safeUrl(url),
      status: response.status,
      ok: response.status < 400,
      ms: Date.now() - started,
      note: response.status >= 300 && response.status < 400 ? "přesměrování" : "",
    });
    return response;
  }

  async follow(url) {
    let current = url;
    for (let hop = 0; hop < 15; hop += 1) {
      const response = await this.send(current);
      if (response.status >= 300 && response.status < 400) {
        current = new URL(response.headers.get("location"), current).href;
        continue;
      }
      return { url: current, status: response.status, text: await response.text() };
    }
    throw new EdookitError("login");
  }

  async login(base, code1, code2) {
    const login = await this.follow(`${base}/user/login`);
    const clientId = /uu_app_oidc_providers_oidcg02_client_id:\s*"([^"]+)"/.exec(login.text)?.[1];
    const oidc = /uu_app_oidc_providers_oidcg02_uri:\s*"([^"]+)"/.exec(login.text)?.[1];
    const redirectUri = /uu_app_oidc_redirect_uri:\s*'([^']+)'/.exec(login.text)?.[1];
    if (!clientId || !oidc || !redirectUri) {
      this.log?.add({
        where: "Edookit",
        method: "kontrola",
        url: safeUrl(`${base}/user/login`),
        status: login.status,
        ok: false,
        ms: 0,
        note: "na přihlašovací stránce chybí oidc údaje",
      });
      throw new EdookitError("login");
    }
    const auth = new URL(`${oidc.replace(/\/$/, "")}/auth`);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("client_id", clientId);
    auth.searchParams.set("redirect_uri", redirectUri);
    auth.searchParams.set("scope", `openid ${base}`);
    auth.searchParams.set("state", crypto.randomUUID());
    auth.searchParams.set("nonce", crypto.randomUUID());
    const landed = await this.follow(auth.href);
    const landedUrl = new URL(landed.url);
    const form = new URLSearchParams({
      clientId: landedUrl.searchParams.get("clientId") || clientId,
      state: landedUrl.searchParams.get("state") || "",
      rememberMe: "true",
      realmCode: REALM,
      accessCode1: code1,
      autoCompleteName2: "accessCode2",
      accessCode2: code2,
    });
    let current = AUTHENTICATE;
    let response = await this.send(current, {
      method: "POST",
      body: form,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://uuidentity.plus4u.net",
        referer: landed.url,
      },
    });
    for (let hop = 0; hop < 12 && response.status >= 300 && response.status < 400; hop += 1) {
      current = new URL(response.headers.get("location"), current).href;
      response = await this.send(current);
    }
    const home = await this.follow(`${base}/`);
    if (home.text.includes("plus4ULoginButton") || !home.text.includes("lesson-entry")) {
      const note = home.text.includes("plus4ULoginButton") ? "pořád přihlašovací obrazovka" : "v odpovědi není rozvrh";
      this.log?.add({
        where: "Edookit",
        method: "kontrola",
        url: safeUrl(`${base}/`),
        status: home.status,
        ok: false,
        ms: 0,
        note,
      });
      throw new EdookitError("login");
    }
  }

  async page(base, path) {
    const result = await this.follow(`${base}${path}`);
    if (result.text.includes("plus4ULoginButton")) throw new EdookitError("login");
    return result.text;
  }
}

function labelFor(base) {
  return base === "https://zsmsene.edookit.net" ? "ZŠ a MŠ Mšené-lázně" : new URL(base).hostname;
}

const EDOOKIT_NAMES = ["EDOOKIT_ACCESS_CODE_1", "EDOOKIT_ACCESS_CODE_2", "EDOOKIT_BASE_URL"];

export async function loadSchool(env, data) {
  const log = createCallLog();
  addLocalBindings(env, data, log, EDOOKIT_NAMES);
  const code1 = secret(env, data, "EDOOKIT_ACCESS_CODE_1");
  const code2 = secret(env, data, "EDOOKIT_ACCESS_CODE_2");
  if (!code1 || !code2) await addProjectGap(env, log, EDOOKIT_NAMES);
  if (!code1 && !code2) {
    const why = EDOOKIT_NAMES.slice(0, 2).map((name) => gapSentence(log.entries, name)).filter(Boolean).join(" ");
    if (why) return { error: why, calls: log.entries };
    return { missing: true, calls: log.entries };
  }
  if (!code1 || !code2) {
    const name = code1 ? "EDOOKIT_ACCESS_CODE_2" : "EDOOKIT_ACCESS_CODE_1";
    const why = gapSentence(log.entries, name) || "Doplňte ho ve formuláři hesel.";
    return { error: `Chybí ${name}. ${why}`, calls: log.entries };
  }
  let base;
  try {
    base = schoolBase(secret(env, data, "EDOOKIT_BASE_URL"));
    const session = new Session(log);
    await session.login(base, code1, code2);
    const [timetableHtml, paymentsHtml, updatesHtml] = await Promise.all([
      session.page(base, "/timetable/"),
      session.page(base, "/payments/"),
      session.page(base, "/overview/updates"),
    ]);
    const { week, byStudent } = parseTimetable(timetableHtml);
    const known = new Set(Object.keys(byStudent));
    let students = parseStudents(paymentsHtml).filter((student) => known.has(student.id));
    if (!students.length) students = parseStudents(timetableHtml).filter((student) => known.has(student.id));
    if (!students.length) {
      students = Object.entries(byStudent).map(([id, item]) => ({ id, shortName: item.name, color: "#1c6b43", name: item.name }));
    }
    const children = [];
    for (const student of students) {
      const [gradesHtml, excusedHtml, statsHtml] = await Promise.all([
        session.page(base, `/evaluation/?studentToShow=${encodeURIComponent(student.id)}`),
        session.page(base, `/attendance/excused?studentToShow=${encodeURIComponent(student.id)}`),
        session.page(base, `/attendance/stats?studentToShow=${encodeURIComponent(student.id)}`),
      ]);
      const timetable = byStudent[student.id] || { name: student.shortName, days: [] };
      children.push({
        id: student.id,
        name: timetable.name || student.shortName,
        color: student.color,
        days: timetable.days,
        grades: parseGrades(gradesHtml),
        absences: parseExcused(excusedHtml),
        absenceSummary: parseAbsenceSummary(statsHtml),
      });
    }
    return {
      data: {
        school: labelFor(base),
        base,
        week,
        payments: parsePayments(paymentsHtml),
        messages: parseMessages(updatesHtml),
        children,
      },
      calls: log.entries,
    };
  } catch (error) {
    if (error instanceof EdookitError && error.code === "login") {
      return { error: "Edookit přihlášení odmítl. V tabulce volání je krok, na kterém to skončilo.", calls: log.entries };
    }
    if (error instanceof EdookitError && error.code === "config") {
      return { error: "Adresa Edookitu má být ve tvaru https://něco.edookit.net.", calls: log.entries };
    }
    log.add({
      where: "Edookit",
      method: "chyba",
      url: schoolBaseSafe(secret(env, data, "EDOOKIT_BASE_URL")),
      status: "selhalo",
      ok: false,
      ms: 0,
      note: "načtení spadlo dřív, než přišla odpověď",
    });
    return { error: "Školní portál se teď nepodařilo načíst. Obědy zůstávají.", calls: log.entries };
  }
}

function schoolBaseSafe(value) {
  try {
    return schoolBase(value);
  } catch {
    return "EDOOKIT_BASE_URL";
  }
}
