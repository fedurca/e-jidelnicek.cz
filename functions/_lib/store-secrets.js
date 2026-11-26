import { base64ToBytes, bytesToBase64, seal } from "./seal.js";

export const SECRET_FIELDS = [
  ["EDOOKIT_ACCESS_CODE_1", "Edookit, první kód"],
  ["EDOOKIT_ACCESS_CODE_2", "Edookit, druhý kód"],
  ["EDOOKIT_BASE_URL", "Adresa Edookitu"],
  ["EJIDELNICEK_EMAIL", "E-mail do jídelny"],
  ["EJIDELNICEK_PASSWORD", "Heslo do jídelny"],
  ["ACCESS_UUID", "Přístupový kód této stránky"],
  ["ALLOWED_IPS", "Povolené IP adresy"],
];

const ALLOWED = new Set(SECRET_FIELDS.map(([name]) => name));
const REPO = "fedurca/e-jidelnicek.cz";
const ACCOUNT = "08036738b61d2eac6a5bb21018ad89cc";
const PROJECT = "skolni-obedy";

export function collectSecrets(form) {
  const out = [];
  for (const [name] of SECRET_FIELDS) {
    const value = String(form.get(name) || "").trim();
    if (value) out.push([name, value]);
  }
  return out;
}

async function githubKey(token) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/public-key`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "skolni-obedy",
    },
  });
  if (!response.ok) throw new Error("GitHub klíč pro secrets nevydal.");
  return response.json();
}

async function putGithub(token, name, value, key) {
  if (!ALLOWED.has(name)) throw new Error("Neznámé tajemství.");
  const encrypted = seal(new TextEncoder().encode(value), base64ToBytes(key.key));
  const response = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/${name}`, {
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
  });
  if (!response.ok && response.status !== 201 && response.status !== 204) {
    throw new Error("GitHub secret se nepodařilo uložit.");
  }
}

async function putCloudflare(token, pairs) {
  const projectUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/${PROJECT}`;
  const current = await fetch(projectUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!current.ok) throw new Error("Cloudflare projekt nešel načíst.");
  const body = await current.json();
  const hash = body?.result?.deployment_configs?.production?.wrangler_config_hash;
  const envVars = {};
  for (const [name, value] of pairs) envVars[name] = { value, type: "secret_text" };
  const response = await fetch(projectUrl, {
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
  });
  if (!response.ok) throw new Error("Cloudflare secret se nepodařilo uložit.");
}

export async function storeSecrets(env, pairs) {
  const github = [];
  const cloudflare = [];
  const errors = [];
  const key = env.GITHUB_TOKEN ? await githubKey(env.GITHUB_TOKEN) : null;
  for (const [name, value] of pairs) {
    if (!key) break;
    try {
      await putGithub(env.GITHUB_TOKEN, name, value, key);
      github.push(name);
    } catch {
      errors.push(`${name} se do GitHubu neuložilo`);
    }
  }
  if (env.CLOUDFLARE_API_TOKEN) {
    try {
      await putCloudflare(env.CLOUDFLARE_API_TOKEN, pairs);
      cloudflare.push(...pairs.map(([name]) => name));
    } catch {
      errors.push("Cloudflare secrets se nepodařilo uložit najednou");
    }
  }
  return { github, cloudflare, errors, githubReady: Boolean(key), cloudflareReady: Boolean(env.CLOUDFLARE_API_TOKEN) };
}
