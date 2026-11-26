import { safeUrl } from "./calls.js";
import { CF_ACCOUNT, CF_PROJECT, SECRET_NAMES } from "./names.js";

function pragueWhen(iso) {
  if (!iso) return "";
  const formatted = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
  return `${formatted} Praha`;
}

function addLayer(log, where, method, name, present, note) {
  log.add({
    where,
    method,
    url: name,
    status: present ? "je" : "chybí",
    ok: Boolean(present),
    ms: 0,
    note,
  });
}

export function addLocalBindings(env, data, log, names = SECRET_NAMES) {
  const sha = String(env?.CF_PAGES_COMMIT_SHA || "");
  log.add({
    where: "toto nasazení",
    method: "verze",
    url: sha ? sha.slice(0, 7) : "místní",
    status: "běží",
    ok: true,
    ms: 0,
    note: String(env?.CF_PAGES_URL || "bez adresy nasazení"),
  });
  for (const name of names) {
    const bound = String(env?.[name] || "");
    const stored = data?.runtime ? String(data.runtime[name] || "") : "";
    addLayer(log, "toto nasazení", "env", name, bound, bound ? `délka ${bound.length}` : "v běžícím nasazení hodnota není");
    addLayer(
      log,
      "úložiště",
      "hodnota",
      name,
      stored,
      stored ? `délka ${stored.length}` : (data?.runtime ? "v úložišti hodnota není" : "úložiště se nenačetlo"),
    );
  }
}

export function gapSentence(entries, name) {
  const project = entries.find((entry) => entry.where === "projekt Cloudflare" && entry.url === name);
  const deploy = entries.find((entry) => entry.where === "toto nasazení" && entry.method === "env" && entry.url === name);
  const store = entries.find((entry) => entry.where === "úložiště" && entry.method === "hodnota" && entry.url === name);
  const when = entries.find((entry) => entry.where === "poslední nasazení")?.note || "poslední nasazení";
  if (store?.status === "je" || deploy?.status === "je") return "";
  if (project?.status === "je") {
    return `${name} je v projektu Cloudflare uložený. Nasazení z ${when} ho nemá a v úložišti také není.`;
  }
  if (deploy?.status === "chybí") return `${name} v běžící stránce není.`;
  return "";
}

export async function addProjectGap(env, log, names = SECRET_NAMES) {
  const token = String(env?.CLOUDFLARE_API_TOKEN || "");
  if (!token) {
    log.add({
      where: "projekt Cloudflare",
      method: "env",
      url: "CLOUDFLARE_API_TOKEN",
      status: "chybí",
      ok: false,
      ms: 0,
      note: "nejde porovnat projekt a nasazení",
    });
    return;
  }
  const projectUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/pages/projects/${CF_PROJECT}`;
  const started = Date.now();
  let project;
  let deployment;
  try {
    const response = await fetch(projectUrl, { headers: { Authorization: `Bearer ${token}` } });
    log.add({
      where: "Cloudflare",
      method: "GET",
      url: safeUrl(projectUrl),
      status: response.status,
      ok: response.ok,
      ms: Date.now() - started,
      note: "nastavení projektu",
    });
    if (!response.ok) return;
    project = await response.json();
    const listStarted = Date.now();
    const listUrl = `${projectUrl}/deployments?per_page=10`;
    const listed = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
    log.add({
      where: "Cloudflare",
      method: "GET",
      url: safeUrl(listUrl),
      status: listed.status,
      ok: listed.ok,
      ms: Date.now() - listStarted,
      note: "seznam nasazení",
    });
    if (!listed.ok) return;
    const deployments = (await listed.json())?.result || [];
    deployment = deployments.find((item) => item.environment === "production" && item.latest_stage?.status === "success" && item.aliases?.length)
      || deployments.find((item) => item.environment === "production" && item.latest_stage?.status === "success" && Object.keys(item.env_vars || {}).length);
  } catch {
    log.add({
      where: "Cloudflare",
      method: "GET",
      url: safeUrl(projectUrl),
      status: "selhalo",
      ok: false,
      ms: Date.now() - started,
      note: "porovnání projektu spadlo",
    });
    return;
  }
  const projectNames = new Set(Object.keys(project?.result?.deployment_configs?.production?.env_vars || {}));
  const deployNames = new Set(Object.keys(deployment?.env_vars || {}));
  const short = String(deployment?.id || "").slice(0, 8);
  log.add({
    where: "poslední nasazení",
    method: "env",
    url: short || "neznámé",
    status: deployment ? "běží" : "chybí",
    ok: Boolean(deployment),
    ms: 0,
    note: deployment ? `${pragueWhen(deployment.created_on)}, commit ${(deployment.deployment_trigger?.metadata?.commit_hash || "").slice(0, 7)}` : "nasazení se nenašlo",
  });
  for (const name of names) {
    const inProject = projectNames.has(name);
    const inDeploy = deployNames.has(name);
    let note = "v projektu není";
    if (inProject && inDeploy) note = "projekt i poslední nasazení ho mají";
    if (inProject && !inDeploy) note = "v projektu je, poslední nasazení ho ještě nemá";
    log.add({
      where: "projekt Cloudflare",
      method: "nastavení",
      url: name,
      status: inProject ? "je" : "chybí",
      ok: inProject,
      ms: 0,
      note,
    });
  }
}
