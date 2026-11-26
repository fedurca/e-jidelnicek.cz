const WEEKDAYS = ["pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota", "neděle"];
const MONTHS = [
  "ledna", "února", "března", "dubna", "května", "června",
  "července", "srpna", "září", "října", "listopadu", "prosince",
];

export function pragueYmd(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function pragueClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${pick("hour")}:${pick("minute")}`;
}

function offsetMinutes(instant) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Prague",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const pick = (type) => Number(parts.find((part) => part.type === type).value);
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour"), pick("minute"), pick("second"));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

export function pragueInstant(ymd, time) {
  const [year, month, day] = ymd.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second || 0));
  const utc = new Date(guess.getTime() - offsetMinutes(guess) * 60000);
  const corrected = new Date(guess.getTime() - offsetMinutes(utc) * 60000);
  return corrected;
}

export function addDays(ymd, days) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function weekdayMonday(ymd) {
  const [year, month, day] = ymd.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export function weekdayName(ymd) {
  return WEEKDAYS[weekdayMonday(ymd)];
}

export function monthName(ymd) {
  return MONTHS[Number(ymd.slice(5, 7)) - 1];
}

export function dayLabel(ymd) {
  return `${Number(ymd.slice(8, 10))}. ${Number(ymd.slice(5, 7))}.`;
}

export function whenLabel(ymd) {
  return `${weekdayName(ymd)} ${Number(ymd.slice(8, 10))}. ${Number(ymd.slice(5, 7))}.`;
}

export function rangeLabel(start, end) {
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${Number(start.slice(8))}.–${Number(end.slice(8))}. ${monthName(start)}`;
  }
  return `${Number(start.slice(8))}. ${monthName(start)} – ${Number(end.slice(8))}. ${monthName(end)}`;
}

export function mondayOf(ymd) {
  return addDays(ymd, -weekdayMonday(ymd));
}

export function pragueMidnightIso(ymd) {
  return pragueInstant(ymd, "00:00:00").toISOString();
}

export function compareYmd(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
