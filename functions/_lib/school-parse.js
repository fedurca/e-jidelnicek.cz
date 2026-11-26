import { load } from "cheerio";

const DAY_ORDER = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
const ENTRY_RE = /^(Po|Út|St|Čt|Pá|So|Ne)\s+(.+?),\s*(\d{1,2}:\d{2})\s+(.+)$/;
const DATE_RE = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/;

function clean(value) {
  return String(value || "").replace(/[\u2009\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim();
}

function text(node) {
  if (!node || node.length === 0) return "";
  return clean(node.text());
}

function parseDate(value) {
  const match = DATE_RE.exec(clean(value));
  if (!match) return null;
  const [, day, month, year] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function weekday(date) {
  return DAY_ORDER[(date.getUTCDay() + 6) % 7];
}

function stamp(date) {
  return date.toISOString().slice(0, 10);
}

function czechDate(date, withYear) {
  const day = `${date.getUTCDate()}. ${date.getUTCMonth() + 1}.`;
  return withYear ? `${day} ${date.getUTCFullYear()}` : day;
}

function minutes(value) {
  const [hour, minute] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

function lessonFrom(entry) {
  const $ = entry;
  const time = text($.find(".date_time").first());
  if (!time) return null;
  const marker = $.find(".date-today, .date-yesterday, .date-tomorrow").first();
  let parsed = marker.length ? parseDate(marker.attr("title") || "") : null;
  const raw = text($);
  if (!parsed) {
    const match = ENTRY_RE.exec(raw);
    parsed = match ? parseDate(match[2]) : null;
    if (!parsed) return null;
  }
  let subject = raw;
  for (const token of ["Dnes", "Včera", "Zítra", ...DAY_ORDER]) {
    if (subject.startsWith(token)) {
      subject = subject.slice(token.length).replace(/^[\s,]+/, "");
      break;
    }
  }
  subject = subject.replace(DATE_RE, "").replace(/^[\s,]+/, "");
  if (subject.startsWith(time)) subject = subject.slice(time.length).replace(/^[\s,]+/, "");
  subject = subject.replace(/^[\s,]+|[\s,]+$/g, "");
  if (!subject) return null;
  const classes = String($.attr("class") || "");
  return {
    day: weekday(parsed),
    date: czechDate(parsed, true),
    sort: stamp(parsed),
    time,
    subject,
    cancelled: subject.includes("Zrušeno") || classes.includes("cancelled"),
    today: marker.length > 0 && String(marker.attr("class") || "").includes("date-today"),
  };
}

export function parseStudents(html) {
  const $ = load(html);
  const students = [];
  $("#student-switcher .student").each((_, element) => {
    const node = $(element);
    const rawId = node.attr("id") || "";
    if (!rawId.startsWith("switch")) return;
    const style = node.find(".dot").attr("style") || "";
    const color = /#[0-9A-Fa-f]{3,8}/.exec(style)?.[0] || "#1c6b43";
    students.push({ id: rawId.slice("switch".length), shortName: text(node.find(".name").first()), color, name: "" });
  });
  return students;
}

export function parseTimetable(html) {
  const $ = load(html);
  const byStudent = {};
  const dates = [];
  $("[id^='snippet-familyTimetable-personTimetable-']").each((_, element) => {
    const snippet = $(element);
    const studentId = (snippet.attr("id") || "").split("-").at(-1);
    const heading = text(snippet.prevAll("h2").first()).replace(/\s*Tisk do PDF\s*$/, "").trim();
    const lessons = [];
    const seen = new Set();
    snippet.find(".lesson-entry").each((__, entry) => {
      const lesson = lessonFrom($(entry));
      if (!lesson) return;
      const key = `${lesson.sort}|${lesson.time}|${lesson.subject}`;
      if (seen.has(key)) return;
      seen.add(key);
      lessons.push(lesson);
      dates.push(lesson.sort);
    });
    const grouped = new Map();
    for (const lesson of lessons) {
      if (!grouped.has(lesson.sort)) grouped.set(lesson.sort, []);
      grouped.get(lesson.sort).push(lesson);
    }
    const days = [...grouped.keys()].sort().map((key) => {
      const items = grouped.get(key).sort((a, b) => minutes(a.time) - minutes(b.time));
      return { day: items[0].day, date: items[0].date, today: items.some((item) => item.today), lessons: items };
    });
    byStudent[studentId] = { name: heading, days };
  });
  let week = "";
  if (dates.length) {
    const start = new Date(`${dates.sort()[0]}T00:00:00Z`);
    const end = new Date(`${dates.sort().at(-1)}T00:00:00Z`);
    week = `Týden od ${czechDate(start, false)} do ${czechDate(end, false)}`;
  }
  return { week, byStudent };
}

export function parsePayments(html) {
  const $ = load(html);
  const payments = [];
  $(".payments .item").each((_, element) => {
    const item = $(element);
    const title = text(item.find(".heading .text").first());
    if (!title) return;
    const status = text(item.find(".status-text").first());
    const unpaid = item.find(".action-required").length > 0 || status.includes("Nezaplaceno");
    const amount = text(item.find(".column.c4.desktop .amount").first()) || text(item.find(".amount").first());
    const children = [];
    item.find(".dots .dot").each((__, dot) => {
      const label = clean($(dot).attr("title") || text($(dot)));
      if (label && !children.includes(label)) children.push(label);
    });
    const details = [];
    item.find("table tr").each((__, row) => {
      const label = text($(row).find("th").first()).replace(/:$/, "");
      const value = text($(row).find("td").first());
      if (label && value) details.push({ label, value });
    });
    payments.push({
      title,
      tag: text(item.find(".tag").first()),
      status: status || (unpaid ? "Nezaplaceno" : ""),
      unpaid,
      amount,
      due: text(item.find(".duedate").first()),
      children,
      details,
    });
  });
  payments.sort((a, b) => Number(b.unpaid) - Number(a.unpaid) || a.title.localeCompare(b.title, "cs"));
  return payments;
}

export function parseMessages(html, limit = 8) {
  const $ = load(html);
  const messages = [];
  $(".item.message").each((_, element) => {
    if (messages.length >= limit) return;
    const item = $(element);
    const title = text(item.find(".object-name").first());
    if (!title) return;
    let preview = text(item.find(".description").first());
    for (const separator of ["-----------------", "napsal(a):", "napsal:"]) {
      if (preview.includes(separator)) preview = preview.split(separator)[0].replace(/[\s-]+$/, "");
    }
    if (preview.length > 220) preview = `${preview.slice(0, 217).trimEnd()}…`;
    const people = [];
    item.find(".dots .dot").each((__, dot) => {
      const label = clean($(dot).attr("title") || "");
      if (label && !people.includes(label)) people.push(label);
    });
    messages.push({
      title,
      sender: text(item.find(".creator").first()),
      when: text(item.find(".time").first()),
      preview,
      unread: String(item.attr("class") || "").split(/\s+/).includes("unread"),
      people,
    });
  });
  return messages;
}

export function parseGrades(html) {
  const $ = load(html);
  const summary = $(".evaluation_course_summary").first();
  if (!summary.length) return [];
  const grades = [];
  summary.children(".cssHack-box").each((_, element) => {
    const box = $(element);
    const subject = text(box.find("a.main-highlight").first());
    if (!subject) return;
    let teacher = "";
    box.find("li.c1 p small").each((__, small) => {
      if (!teacher) teacher = text($(small));
    });
    const attendance = [];
    box.find("li.c1 li small").each((__, small) => {
      const value = text($(small));
      if (value.includes("%") && attendance.length < 2) attendance.push(value);
    });
    const marks = [];
    box.find(".summary-list > span[title]").each((__, spanNode) => {
      const span = $(spanNode);
      const anchor = span.find("a").first();
      let value = text(anchor);
      if (!value) {
        value = clean(span.contents().toArray().filter((node) => node.type === "text").map((node) => node.data || "").join("")).replace(/^[, ]+|[, ]+$/g, "");
      }
      const title = clean(String(span.attr("title") || "").replace(/<[^>]+>/g, " ")).replace(/^[, ]+|[, ]+$/g, "");
      if (value) marks.push({ value, title });
    });
    grades.push({ subject, code: text(box.find(".link_info").first()), teacher, attendance, marks });
  });
  return grades;
}

export function parseExcused(html, limit = 8) {
  const $ = load(html);
  const table = $(".attendance_table").first();
  if (!table.length) return [];
  const rows = [];
  table.find("ul.table_row").each((_, element) => {
    if (rows.length >= limit) return;
    const row = $(element);
    const day = text(row.find("li.c1 strong").first()) || text(row.find("li.c1 p").first());
    if (!day || day === "Den") return;
    const missed = text(row.find("li.c2").first()).replace(/^Zameškané hodiny\s*/, "").trim();
    rows.push({ day, missed, reason: text(row.find(".attendance-advice").first()) });
  });
  return rows;
}

export function parseAbsenceSummary(html) {
  const $ = load(html);
  const periods = [];
  $("h3.termHeading").each((_, element) => {
    const heading = $(element);
    const block = heading.nextAll("div.boxes1").first();
    const counts = [];
    block.find("ul.table_row").each((__, row) => {
      const kind = text($(row).find("li.c1 p").first());
      const count = text($(row).find("li.c2 b").first());
      if (kind && count) counts.push({ kind, count });
    });
    if (counts.length) periods.push({ label: text(heading), counts });
  });
  return periods;
}
