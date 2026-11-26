import assert from "node:assert/strict";
import test from "node:test";
import { parseGrades, parseMessages, parsePayments, parseStudents, parseTimetable } from "../functions/_lib/school-parse.js";
import { schoolSection } from "../functions/_lib/school-render.js";

const HOME = `
<div id="student-switcher" class="students">
  <div class="student" id="switch11">
    <span class="dot" style="background-color: #3D7B21;">A</span>
    <span class="name">Anna</span>
  </div>
  <div class="student" id="switch22">
    <span class="dot" style="background-color: #F970A9;">B</span>
    <span class="name">Beata</span>
  </div>
</div>`;

const TIMETABLE = `
<h2 class="heading">Anna Nováková 6.B Tisk do PDF</h2>
<div id="snippet-familyTimetable-personTimetable-11">
  <span class="lesson-entry">Po 23. 11. 2026, <span class="date_time">10:20</span> Dějepis (D - 6.B)</span>
  <span class="lesson-entry">Po 23. 11. 2026, <span class="date_time">7:25</span> Český jazyk (Čj - 6.B)</span>
</div>
<h2 class="heading">Beata Nováková 5. Tisk do PDF</h2>
<div id="snippet-familyTimetable-personTimetable-22">
  <span class="lesson-entry">Út 24. 11. 2026, <span class="date_time">9:25</span> Zrušeno Přírodověda (Přv - 5.)</span>
  <span class="lesson-entry"><span class="date-today" title="26.&#8201;11.&#8201;2026">Dnes</span>, <span class="date_time">8:20</span> Hudební výchova (Hv - 5.)</span>
</div>`;

const PAYMENTS = `
<div class="payments">
  <div class="item">
    <div class="dots"><div class="dot" title="Beata Nováková">B</div></div>
    <div class="column c1"><div class="heading"><div class="text">Kroužek</div><div class="tag">úplata</div></div>
      <div class="duedate">Zaplatit do 30. 9. 2026</div></div>
    <div class="column c2"><div class="status-text"><div class="action-required">Nezaplaceno</div></div></div>
    <div class="column c4 desktop"><div class="amount">500 Kč</div></div>
    <table><tr><th>Variabilní symbol:</th><td>142900</td></tr></table>
  </div>
  <div class="item">
    <div class="dots"><div class="dot" title="Anna Nováková">A</div></div>
    <div class="column c1"><div class="heading"><div class="text">Sešit</div></div></div>
    <div class="column c2"><div class="status-text">Zaplaceno</div></div>
    <div class="column c4 desktop"><div class="amount">298 Kč</div></div>
  </div>
</div>`;

const MESSAGES = `
<div class="item message unread">
  <div class="dots"><div class="dot" title="Já">L</div></div>
  <div class="object-name">Omluva z TV</div>
  <div class="description">Krátký text. ----------------- původní zpráva</div>
  <div class="creator">Učitelka</div>
  <div class="time">24. 11. 2026, 8:12</div>
</div>`;

const GRADES = `
<div class="evaluation_course_summary">
  <div class="cssHack-box">
    <p><a class="main-highlight" href="/courses/detail">Matematika</a> <span class="link_info">M - 6.B</span></p>
    <ul class="table_row"><li class="c1">
      <p><small>Novák Jan</small></p>
      <ul><li><small>1. pololetí 26/27: 85 %</small></li></ul>
    </li></ul>
    <span class="summary-list">
      <span title="Písemka, Váha: 1"><a>1</a></span>
      <span title="Ústní">2</span>
    </span>
  </div>
</div>`;

test("students keep the portal color and id", () => {
  const students = parseStudents(HOME);
  assert.deepEqual(students.map((student) => student.id), ["11", "22"]);
  assert.equal(students[0].shortName, "Anna");
  assert.equal(students[0].color, "#3D7B21");
});

test("timetable sorts lessons by clock time and names both children", () => {
  const { week, byStudent } = parseTimetable(TIMETABLE);
  assert.match(week, /23\. 11\./);
  assert.equal(byStudent["11"].name, "Anna Nováková 6.B");
  assert.equal(byStudent["11"].days[0].lessons[0].time, "7:25");
  assert.equal(byStudent["22"].days[0].lessons[0].cancelled, true);
  assert.equal(byStudent["22"].days[1].today, true);
  assert.equal(byStudent["22"].days[1].day, "Čt");
});

test("unpaid payments stay first and messages drop the quoted reply", () => {
  const payments = parsePayments(PAYMENTS);
  assert.equal(payments[0].unpaid, true);
  assert.deepEqual(payments[0].children, ["Beata Nováková"]);
  assert.equal(payments[0].details[0].value, "142900");
  assert.equal(payments[1].unpaid, false);
  const messages = parseMessages(MESSAGES);
  assert.equal(messages[0].title, "Omluva z TV");
  assert.equal(messages[0].unread, true);
  assert.equal(messages[0].preview, "Krátký text.");
});

test("grades and the school section escape html", () => {
  const grades = parseGrades(GRADES);
  assert.equal(grades[0].subject, "Matematika");
  assert.deepEqual(grades[0].marks.map((mark) => mark.value), ["1", "2"]);
  assert.deepEqual(grades[0].attendance, ["1. pololetí 26/27: 85 %"]);
  const html = schoolSection({
    data: {
      school: "ZŠ <test>",
      base: "https://zsmsene.edookit.net",
      week: "",
      payments: [],
      messages: [],
      children: [],
    },
  });
  assert.match(html, /ZŠ &lt;test&gt;/);
  assert.doesNotMatch(html, /ZŠ <test>/);
});
