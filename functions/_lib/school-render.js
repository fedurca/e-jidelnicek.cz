function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function paymentCard(item) {
  const who = item.children.join(", ");
  const details = item.unpaid
    ? `<div class="school-details">${item.details.map((detail) => `<span>${esc(detail.label)}: ${esc(detail.value)}</span>`).join("")}</div>`
    : "";
  return `<article class="school-card${item.unpaid ? " is-unpaid" : ""}">
    <div class="school-row"><strong>${esc(item.title)}</strong><span>${esc(item.amount)}</span></div>
    <p class="school-meta">${esc(who)}${item.due ? ` · ${esc(item.due)}` : ""}${item.status && !item.unpaid ? ` · ${esc(item.status)}` : ""}</p>
    ${item.unpaid ? `<p class="school-meta"><span class="pill pill-bad">${esc(item.status)}</span>${item.tag ? ` <span class="pill">${esc(item.tag)}</span>` : ""}</p>${details}` : ""}
  </article>`;
}

function childBlock(child, base) {
  const days = child.days.length
    ? `<div class="school-days">${child.days.map((day) => `<section class="school-day${day.today ? " is-today" : ""}">
        <h4>${esc(day.day)} <span>${esc(day.date)}${day.today ? " · dnes" : ""}</span></h4>
        ${day.lessons.map((lesson) => `<p><time>${esc(lesson.time)}</time> ${esc(lesson.subject)}</p>`).join("")}
      </section>`).join("")}</div>`
    : "<p class=\"school-meta\">Rozvrh pro tento týden se nepodařilo přečíst.</p>";
  const grades = child.grades.length
    ? child.grades.map((grade) => `<div class="school-line">
        <strong>${esc(grade.subject)}</strong> <span class="school-meta">${esc(grade.code)}</span>
        <p class="school-meta">${esc(grade.teacher)}${grade.attendance.length ? ` · ${esc(grade.attendance.join(" · "))}` : ""}</p>
        <p class="marks">${grade.marks.map((mark) => `<span title="${esc(mark.title)}">${esc(mark.value)}</span>`).join("")}</p>
      </div>`).join("")
    : "<p class=\"school-meta\">Hodnocení zatím není k dispozici.</p>";
  const chips = child.absenceSummary.flatMap((period) => period.counts.map((count) => `<span class="pill">${esc(period.label)}: ${esc(count.kind)} ${esc(count.count)}</span>`)).join("");
  const absences = child.absences.length
    ? child.absences.map((absence) => `<div class="school-line"><strong>${esc(absence.day)}</strong><p class="school-meta">${esc(absence.missed)}${absence.reason ? ` · ${esc(absence.reason)}` : ""}</p></div>`).join("")
    : (chips ? "" : "<p class=\"school-meta\">Žádné absence v tomto období.</p>");
  return `<article class="school-child">
    <h3><i style="background:${esc(child.color)}"></i>${esc(child.name)}</h3>
    <div class="school-head"><h4>Rozvrh</h4></div>
    ${days}
    <div class="school-head"><h4>Hodnocení</h4><a href="${esc(base)}/evaluation/?studentToShow=${esc(child.id)}">V Edookitu</a></div>
    ${grades}
    <div class="school-head"><h4>Absence</h4><a href="${esc(base)}/attendance/excused?studentToShow=${esc(child.id)}">V Edookitu</a></div>
    ${chips ? `<p class="school-pills">${chips}</p>` : ""}
    ${absences}
  </article>`;
}

export function schoolSection(school) {
  if (!school) return "";
  if (school.missing) {
    return `<section class="panel school"><h2>Škola</h2><p>Rozvrh, platby, zprávy, hodnocení a absence se načtou, až budou v nastavení oba přístupové kódy do Edookitu.</p></section>`;
  }
  if (school.error) return `<section class="panel school"><h2>Škola</h2><p>${esc(school.error)}</p></section>`;
  const data = school.data;
  const unpaid = data.payments.filter((item) => item.unpaid);
  const paid = data.payments.filter((item) => !item.unpaid);
  const messages = data.messages.length
    ? data.messages.map((message) => `<article class="school-card${message.unread ? " is-unread" : ""}">
        <div class="school-row"><strong>${esc(message.title)}</strong><span class="school-meta">${esc(message.when)}</span></div>
        <p class="school-meta">${esc(message.sender)}${message.people.length ? ` · ${esc(message.people.join(", "))}` : ""}</p>
        ${message.preview ? `<p>${esc(message.preview)}</p>` : ""}
      </article>`).join("")
    : "<p class=\"school-meta\">Ve schránce teď není žádná zpráva.</p>";
  return `<section class="school" aria-labelledby="skola">
    <div class="school-head"><h2 id="skola">Škola · ${esc(data.school)}</h2>${data.week ? `<p class="school-meta">${esc(data.week)}</p>` : ""}</div>
    <div class="school-head"><h3>Požadované platby</h3><a href="${esc(data.base)}/payments/">Otevřít v Edookitu</a></div>
    ${unpaid.length ? unpaid.map(paymentCard).join("") : "<p class=\"school-meta\">Nic nevisí k zaplacení.</p>"}
    ${paid.length ? `<h3 class="school-sub">Už uhrazené</h3>${paid.map(paymentCard).join("")}` : ""}
    <div class="school-head"><h3>Zprávy</h3><a href="${esc(data.base)}/overview/updates">Schránka v Edookitu</a></div>
    ${messages}
    <div class="school-children">${data.children.map((child) => childBlock(child, data.base)).join("")}</div>
  </section>`;
}
