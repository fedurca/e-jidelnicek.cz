import { createCallLog, safeUrl } from "./calls.js";
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

function schoolBase(env) {
  const value = String(env.EDOOKIT_BASE_URL || "https://zsmsene.edookit.net").replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.edookit\.net$/.test(value)) throw new EdookitError("config");
  return value;
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
    if (!clientId || !oidc || !redirectUri) throw new EdookitError("login");
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
    if (home.text.includes("plus4ULoginButton") || !home.text.includes("lesson-entry")) throw new EdookitError("login");
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

export async function loadSchool(env) {
  const log = createCallLog();
  const code1 = String(env.EDOOKIT_ACCESS_CODE_1 || "");
  const code2 = String(env.EDOOKIT_ACCESS_CODE_2 || "");
  log.add({
    where: "Cloudflare Pages",
    method: "env",
    url: "EDOOKIT_ACCESS_CODE_1",
    status: code1 ? "je" : "chybí",
    ok: Boolean(code1),
    ms: 0,
    note: code1 ? `délka ${code1.length}` : "hodnota ve funkci není",
  });
  log.add({
    where: "Cloudflare Pages",
    method: "env",
    url: "EDOOKIT_ACCESS_CODE_2",
    status: code2 ? "je" : "chybí",
    ok: Boolean(code2),
    ms: 0,
    note: code2 ? `délka ${code2.length}` : "hodnota ve funkci není",
  });
  if (!code1 && !code2) return { missing: true, calls: log.entries };
  if (!code1 || !code2) return { error: "Nastavte oba přístupové kódy do Edookitu.", calls: log.entries };
  try {
    const base = schoolBase(env);
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
      return { error: "Edookit přihlášení odmítl. Zkontrolujte oba přístupové kódy.", calls: log.entries };
    }
    log.add({
      where: "Edookit",
      method: "chyba",
      url: schoolBaseSafe(env),
      status: "selhalo",
      ok: false,
      ms: 0,
      note: "načtení spadlo dřív, než přišla odpověď",
    });
    return { error: "Školní portál se teď nepodařilo načíst. Obědy zůstávají.", calls: log.entries };
  }
}

function schoolBaseSafe(env) {
  try {
    return schoolBase(env);
  } catch {
    return "EDOOKIT_BASE_URL";
  }
}
