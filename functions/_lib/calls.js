export function pragueStamp(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(value || "").split("?")[0];
  }
}

export function createCallLog() {
  const entries = [];
  return {
    entries,
    add(entry) {
      entries.push({ at: pragueStamp(), ...entry });
    },
  };
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderCalls(entries) {
  if (!entries?.length) return "";
  const rows = entries.map((entry) => `<tr>
    <td>${esc(entry.at)}</td>
    <td>${esc(entry.where)}</td>
    <td>${esc(entry.method)}</td>
    <td>${esc(entry.url)}</td>
    <td class="${entry.ok === false ? "bad" : ""}">${esc(entry.status ?? "")}</td>
    <td>${esc(entry.ms ?? "")} ms</td>
    <td>${esc(entry.note || "")}</td>
  </tr>`).join("");
  return `<h3 class="school-sub">Volání</h3>
    <div class="table-scroll"><table class="debug">
      <thead><tr><th>Čas</th><th>Kam</th><th>Jak</th><th>Adresa</th><th>Stav</th><th>Trvání</th><th>Co</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}
