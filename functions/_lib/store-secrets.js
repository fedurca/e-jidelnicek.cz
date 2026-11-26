import { createCallLog, safeUrl } from "./calls.js";
import { CF_ACCOUNT, CF_PROJECT, SECRET_FIELDS } from "./names.js";
import { pushRuntime } from "./runtime-store.js";
import { base64ToBytes, bytesToBase64, seal } from "./seal.js";

export { SECRET_FIELDS };

const ALLOWED = new Set(SECRET_FIELDS.map(([name]) => name));
const REPO = "fedurca/e-jidelnicek.cz";

export function collectSecrets(form) {
  const out = [];
  for (const [name] of SECRET_FIELDS) {
    const value = String(form.get(name) || "").trim();
    if (value) out.push([name, value]);
  }
  return out;
}

async function traced(log, where, method, url, note, run) {
  const started = Date.now();
  try {
    const response = await run();
    log.add({
      where,
      method,
      url: safeUrl(url),
      status: response.status,
      ok: response.ok || response.status === 201 || response.status === 204,
      ms: Date.now() - started,
      note,
    });
    return response;
  } catch (error) {
    log.add({
      where,
      method,
      url: safeUrl(url),
      status: "selhalo",
      ok: false,
      ms: Date.now() - started,
      note: note || "volání spadlo",
    });
    throw error;
  }
}

async function githubKey(token, log) {
  const url = `https://api.github.com/repos/${REPO}/actions/secrets/public-key`;
  const response = await traced(log, "GitHub", "GET", url, "veřejný klíč pro zašifrování", () => fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "skolni-obedy",
    },
  }));
  if (!response.ok) throw new Error("GitHub klíč pro secrets nevydal.");
  return response.json();
}

async function putGithub(token, name, value, key, log) {
  if (!ALLOWED.has(name)) throw new Error("Neznámé tajemství.");
  const encrypted = seal(new TextEncoder().encode(value), base64ToBytes(key.key));
  const url = `https://api.github.com/repos/${REPO}/actions/secrets/${name}`;
  const response = await traced(log, "GitHub", "PUT", url, `délka ${value.length}`, () => fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "skolni-obedy",
    },
    body: JSON.stringify({
      encrypted_value: bytesToBase64(encrypted),
      key_id: key.key_id,
    }),
  }));
  if (!response.ok && response.status !== 201 && response.status !== 204) {
    throw new Error("GitHub secret se nepodařilo uložit.");
  }
}

async function putCloudflare(token, pairs, log) {
  const projectUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/pages/projects/${CF_PROJECT}`;
  const names = pairs.map(([name]) => name).join(", ");
  const current = await traced(log, "Cloudflare", "GET", projectUrl, "načtení projektu před zápisem", () => fetch(projectUrl, {
    headers: { Authorization: `Bearer ${token}` },
  }));
  if (!current.ok) throw new Error("Cloudflare projekt nešel načíst.");
  const body = await current.json();
  const hash = body?.result?.deployment_configs?.production?.wrangler_config_hash;
  const envVars = {};
  for (const [name, value] of pairs) envVars[name] = { value, type: "secret_text" };
  const response = await traced(log, "Cloudflare", "PATCH", projectUrl, `najednou: ${names}`, () => fetch(projectUrl, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      deployment_configs: {
        production: {
          env_vars: envVars,
          ...(hash ? { wrangler_config_hash: hash } : {}),
        },
      },
    }),
  }));
  if (!response.ok) throw new Error(`Cloudflare secret se nepodařilo uložit (${response.status}).`);
  const payload = await response.json().catch(() => null);
  if (payload && payload.success === false) throw new Error("Cloudflare secret se nepodařilo uložit.");
  const saved = new Set(Object.keys(payload?.result?.deployment_configs?.production?.env_vars || {}));
  const missing = pairs.map(([name]) => name).filter((name) => !saved.has(name));
  if (missing.length) throw new Error(`Cloudflare po zápisu neukazuje: ${missing.join(", ")}`);
}

export async function storeSecrets(env, pairs) {
  const log = createCallLog();
  const github = [];
  const cloudflare = [];
  const errors = [];
  for (const [name, value] of pairs) {
    log.add({
      where: "formulář",
      method: "vstup",
      url: name,
      status: "přijato",
      ok: true,
      ms: 0,
      note: `délka ${value.length}`,
    });
  }
  let key = null;
  if (env.GITHUB_TOKEN) {
    try {
      key = await githubKey(env.GITHUB_TOKEN, log);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "GitHub klíč pro secrets nevydal.");
    }
  } else {
    log.add({ where: "GitHub", method: "env", url: "GITHUB_TOKEN", status: "chybí", ok: false, ms: 0, note: "zápis do GitHub secrets nejde" });
  }
  for (const [name, value] of pairs) {
    if (!key) break;
    try {
      await putGithub(env.GITHUB_TOKEN, name, value, key, log);
      github.push(name);
    } catch {
      errors.push(`${name} se do GitHubu neuložilo`);
    }
  }
  if (env.CLOUDFLARE_API_TOKEN) {
    try {
      await putCloudflare(env.CLOUDFLARE_API_TOKEN, pairs, log);
      cloudflare.push(...pairs.map(([name]) => name));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Cloudflare secrets se nepodařilo uložit najednou");
    }
  } else {
    log.add({ where: "Cloudflare", method: "env", url: "CLOUDFLARE_API_TOKEN", status: "chybí", ok: false, ms: 0, note: "zápis do Pages nejde" });
  }
  let stored = { saved: [] };
  try {
    stored = await pushRuntime(env, pairs, log);
  } catch {
    stored = { saved: [] };
  }
  if (stored.saved.length !== pairs.length) errors.push("Úložiště, ze kterého stránka čte hned, nevzalo všechny hodnoty");
  return { github, cloudflare, stored: stored.saved, errors, calls: log.entries, githubReady: Boolean(key), cloudflareReady: Boolean(env.CLOUDFLARE_API_TOKEN) };
}
