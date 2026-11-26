import { schoolSection } from "./school-render.js";

const PROBLEMS = {
  uzavreno: "Tahle objednávka už není otevřená. Stránka ukazuje aktuální stav.",
  jidelna: "Jídelna objednávku odmítla. Zkuste to znovu.",
  spojeni: "Spojení s jídelnou vypadlo. Zkuste to znovu.",
  ":ORDERS_NOT_ALLOWED": "Objednávky na tento měsíc ještě nejsou povolené.",
  ":ORDERS_BLOCKED": "Objednávky na tento den jsou blokované.",
  ":ORDERS_NOT_COOKING_DAY": "Tento den se nevaří.",
  ":ORDERS_TOO_LATE": "Na tento den už objednat nejde.",
  ":ORDERS_MAX_MENU": "Tohle menu pro dítě objednat nejde.",
  ":ORDERS_CANNOT_ORDER": "Objednat už nejde, termín vypršel.",
  ":ORDERS_CANNOT_CHANGE": "Objednávku už nejde změnit.",
  ":ORDERS_CANNOT_CANCEL": "Objednávku už nejde zrušit.",
  ":ORDERS_FORBIDDEN_FOR_CANTEEN": "Jídelna teď objednávání pozastavila. Zkuste to za chvíli.",
  ":ORDERS_NO_MONEY": "Na účtě není dost kreditu.",
};

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(title)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,650&family=Outfit:wght@420;560;640&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
${body}
</body>
</html>`;
}

export function messagePage(title, text) {
  return page(title, `<header class="mast"><div class="wrap mast-inner"><p class="eyebrow">Školní jídelna</p><h1>${esc(title)}</h1></div></header>
<main class="wrap"><section class="panel"><p>${esc(text)}</p></section></main>`);
}

export function loginPage({ csrf, error = "" }) {
  return page("Vstup k obědům", `<header class="mast"><div class="wrap mast-inner"><p class="eyebrow">Školní jídelna</p><h1>Vstup k obědům</h1></div></header>
<main class="wrap"><section class="panel">
${error ? `<p class="flash flash-bad">${esc(error)}</p>` : ""}
<form method="post" action="/vstup">
  <input type="hidden" name="csrf" value="${esc(csrf)}">
  <label for="kod">Přístupový kód</label>
  <input id="kod" name="kod" type="password" autocomplete="current-password" required>
  <button type="submit" class="btn btn-primary">Vstoupit</button>
</form>
</section></main>`);
}

function buttonForm(button, cell, row, csrf) {
  const menu = button.menu_type_id == null
    ? ""
    : `<input type="hidden" name="menu_type_id" value="${esc(button.menu_type_id)}">`;
  return `<form method="post" action="/objednat" data-confirm="${esc(button.confirm)}">
    <input type="hidden" name="csrf" value="${esc(csrf)}">
    <input type="hidden" name="visitor_id" value="${esc(cell.visitor_id)}">
    <input type="hidden" name="day" value="${esc(row.iso)}">
    <input type="hidden" name="action" value="${esc(button.action)}">
    ${menu}
    <button type="submit" class="btn btn-${esc(button.kind)}">${esc(button.label)}</button>
  </form>`;
}

export function boardPage(board, { csrf, flash = "", school = null } = {}) {
  const credits = board.children.map((child) => `<article class="credit${child.low_credit ? " is-low" : ""}">
    <p class="credit-name">${esc(child.given_name)}</p>
    <p class="credit-meta">${esc(child.full_name)}${child.class_label ? ` · ${esc(child.class_label)}` : ""}</p>
    <p class="credit-amount">${esc(child.credit_label)}</p>
    <p class="credit-label">${child.low_credit ? "Kredit je nižší než cena oběda" : "Kredit na účtě"}</p>
  </article>`).join("");
  const open = board.still_open.length
    ? `<ul>${board.still_open.map((item) => `<li>
        <a href="#${esc(item.anchor)}"><strong>${esc(item.child_name)}</strong><span>${esc(item.when)}</span><em>${esc(item.dish)}</em></a>
        <form method="post" action="/objednat" data-confirm="${esc(item.confirm)}">
          <input type="hidden" name="csrf" value="${esc(csrf)}">
          <input type="hidden" name="visitor_id" value="${esc(item.visitor_id)}">
          <input type="hidden" name="day" value="${esc(item.iso)}">
          <input type="hidden" name="action" value="order">
          <input type="hidden" name="menu_type_id" value="${esc(item.menu_type_id)}">
          <button type="submit" class="btn btn-primary">Objednat</button>
        </form>
      </li>`).join("")}</ul>`
    : "<p>V těchto dvou týdnech není otevřený žádný neobjednaný oběd.</p>";
  const weeks = board.weeks.map((week) => `<section class="week" aria-labelledby="${esc(week.key)}">
    <div class="week-head"><div><h2 id="${esc(week.key)}">${esc(week.title)}</h2><p class="range">${esc(week.range_label)}</p></div><p class="score">${esc(week.score)}</p></div>
    <p class="lead">${esc(week.lead)}</p>
    <div class="table-scroll"><table>
      <thead><tr><th scope="col">Den</th>${board.children.map((child) => `<th scope="col">${esc(child.given_name)}</th>`).join("")}</tr></thead>
      <tbody>${week.rows.map((row) => `<tr id="den-${esc(row.iso)}" class="${row.is_today ? "is-today" : ""}">
        <th scope="row"><span class="weekday">${esc(row.weekday)}</span><span class="daynum">${esc(row.day_label)}</span>${row.is_today ? '<span class="today-mark">dnes</span>' : ""}</th>
        ${row.cells.map((cell) => `<td data-child="${esc(cell.child_name)}" data-date="${esc(row.iso)}" data-state="${esc(cell.tone)}">
          <p class="status status-${esc(cell.tone)}">${esc(cell.status)}</p>
          ${cell.mains.map((dish) => `<p class="dish${dish.selected ? " is-selected" : ""}">${esc(dish.name)}</p>`).join("")}
          ${cell.extras.length ? `<ul class="extras">${cell.extras.map((extra) => `<li><span>${esc(extra.type_name)}</span> ${esc(extra.name)}</li>`).join("")}</ul>` : ""}
          ${cell.note ? `<p class="note">${esc(cell.note)}</p>` : ""}
          ${cell.buttons.map((button) => buttonForm(button, cell, row, csrf)).join("")}
        </td>`).join("")}
      </tr>`).join("")}</tbody>
    </table></div>
  </section>`).join("");
  const body = board.empty
    ? `<section class="panel"><h2>U účtu nejsou žádné děti</h2><p>V e-Jídelníčku k tomuto e-mailu není přidaný strávník.</p></section>`
    : `<section class="credits" aria-label="Kredit dětí">${credits}</section>
      <section class="open-list"><h2>Ještě k objednání</h2>${open}</section>
      ${board.rule ? `<p class="rule">${esc(board.rule)}</p>` : ""}
      ${schoolSection(school)}
      ${weeks}`;
  return page("Obědy · tento a příští týden", `<header class="mast"><div class="wrap mast-inner">
      <p class="eyebrow">Školní jídelna</p>
      <h1>Obědy na tento a příští týden</h1>
      <p class="lede">${esc(board.canteen_name)}</p>
      <p class="updated">Aktualizováno ${esc(board.updated_label)}</p>
    </div></header>
    <main class="wrap">
      ${flash ? `<p class="flash flash-${flash.startsWith("chyba:") ? "bad" : "ok"}" role="status">${esc(flash.replace(/^chyba:/, ""))}</p>` : ""}
      ${body}
    </main>
    <footer class="wrap foot"><p>Údaje i objednávky jdou rovnou do e-Jídelníčku. Zrušení i změna platí, jen dokud je jídelna pustí. <a class="text-link" href="/hesla">Uložit hesla</a></p></footer>
    <script>
      document.querySelectorAll("form[data-confirm]").forEach(function (form) {
        form.addEventListener("submit", function (event) {
          if (!window.confirm(form.dataset.confirm)) { event.preventDefault(); return; }
          var button = form.querySelector("button");
          if (button) button.disabled = true;
        });
      });
    </script>`);
}

export function flashText(url, board) {
  const code = url.searchParams.get("zprava") || "";
  const problem = url.searchParams.get("kod") || "";
  const childId = Number(url.searchParams.get("dite"));
  const child = board?.children?.find((item) => item.visitor_id === childId);
  const name = child?.given_name || "";
  if (code === "objednano") return `${name} má oběd objednaný.`.trim();
  if (code === "zmeneno") return `${name} má objednávku změněnou.`.trim();
  if (code === "zruseno") return `${name} má objednávku zrušenou.`.trim();
  if (code === "chyba") return `chyba:${PROBLEMS[problem] || PROBLEMS.jidelna}`;
  return "";
}

export function problemText(code) {
  return PROBLEMS[code] || PROBLEMS.jidelna;
}
