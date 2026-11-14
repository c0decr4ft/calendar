export const DAYS = [
  { id: "monday", name: "Monday", short: "Mon" },
  { id: "tuesday", name: "Tuesday", short: "Tue" },
  { id: "wednesday", name: "Wednesday", short: "Wed" },
  { id: "thursday", name: "Thursday", short: "Thu" },
  { id: "friday", name: "Friday", short: "Fri" },
  { id: "saturday", name: "Saturday", short: "Sat" },
  { id: "sunday", name: "Sunday", short: "Sun" },
];

export const STROKE_COLORS = ["#14211c", "#0f6e56", "#b4532a", "#1d4e89"];
export const STROKE_WIDTHS = [2, 4, 8];
export const MAX_STROKES = 400;
export const MAX_POINTS = 500;

export const ZONES = [
  ["Europe/Dublin", "Ireland"],
  ["Europe/London", "UK"],
  ["Europe/Lisbon", "Portugal"],
  ["Europe/Madrid", "Spain"],
  ["Europe/Paris", "France"],
  ["Europe/Rome", "Italy"],
  ["Europe/Berlin", "Germany"],
  ["Europe/Athens", "Greece"],
  ["America/New_York", "US Eastern"],
  ["America/Chicago", "US Central"],
  ["America/Denver", "US Mountain"],
  ["America/Los_Angeles", "US Pacific"],
  ["Australia/Sydney", "Sydney"],
];

export function toMins(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function formatTime(mins) {
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  if (m === 0) return h + " " + ap;
  return h + ":" + String(m).padStart(2, "0") + " " + ap;
}

export function formatRange(start, end) {
  const sameHalf = (start >= 12 * 60) === (end >= 12 * 60);
  const onHour = start % 60 === 0 && end % 60 === 0;
  if (sameHalf && onHour) {
    const sh = (Math.floor(start / 60) % 12) || 12;
    const eh = (Math.floor(end / 60) % 12) || 12;
    return sh + "–" + eh + " " + (end >= 12 * 60 ? "pm" : "am");
  }
  if (sameHalf) return formatTime(start).replace(/ (am|pm)$/, "") + "–" + formatTime(end);
  return formatTime(start) + " – " + formatTime(end);
}

export function formatDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const parts = [];
  if (h === 1) parts.push("1 hr");
  else if (h > 1) parts.push(h + " hr");
  if (m === 1) parts.push("1 min");
  else if (m > 1) parts.push(m + " min");
  return parts.join(" ") || "0 min";
}

export function blockWhen(block) {
  if (block.start && block.end) return formatRange(toMins(block.start), toMins(block.end));
  if (block.start) return formatTime(toMins(block.start)) + " onwards";
  return "";
}

function nextStart(blocks, after) {
  const later = blocks.filter((block) => block.start && toMins(block.start) > after).map((block) => toMins(block.start));
  return later.length ? Math.min(...later) : null;
}

export function dayStatus(blocks, minutes) {
  const active = blocks.filter((block) => {
    if (!block.start) return false;
    const start = toMins(block.start);
    if (minutes < start) return false;
    if (block.end) return minutes < toMins(block.end);
    const next = nextStart(blocks, start);
    return next == null || minutes < next;
  });
  active.sort((a, b) => toMins(b.start) - toMins(a.start));
  const current = active[0];
  if (current) {
    return {
      kind: "during",
      title: current.title,
      detail: current.end ? "until " + formatTime(toMins(current.end)) : current.note || "onwards",
      blockId: current.id,
    };
  }
  const upcoming = blocks
    .filter((block) => block.start && toMins(block.start) > minutes)
    .sort((a, b) => toMins(a.start) - toMins(b.start));
  if (upcoming[0]) {
    const gap = toMins(upcoming[0].start) - minutes;
    return {
      kind: "before",
      title: gap >= 30 ? "Free for now" : "Up next",
      detail: upcoming[0].title + " at " + formatTime(toMins(upcoming[0].start)),
      blockId: null,
    };
  }
  const untimed = blocks.filter((block) => !block.start && block.title);
  if (untimed.length && blocks.every((block) => !block.start)) {
    return { kind: "all-day", title: untimed[0].title, detail: untimed[0].note || "", blockId: untimed[0].id };
  }
  if (!blocks.length) return { kind: "empty", title: "Nothing written yet", detail: "", blockId: null };
  return { kind: "after", title: "Nothing else today", detail: "", blockId: null };
}

export function statusLine(blocks, minutes) {
  const status = dayStatus(blocks, minutes);
  return status.detail ? status.title + " · " + status.detail : status.title;
}

function bagFrom(date, timeZone, withDate) {
  const fmt = new Intl.DateTimeFormat("en-IE", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(withDate
      ? { year: "numeric", month: "2-digit", day: "2-digit", second: "2-digit" }
      : { day: "numeric", month: "long" }),
  });
  const bag = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return bag;
}

export function zonedParts(date, timeZone) {
  const bag = bagFrom(date, timeZone, false);
  const minutes = Number(bag.hour) * 60 + Number(bag.minute);
  return {
    weekday: bag.weekday,
    minutes,
    clockLabel: formatTime(minutes),
    dateLabel: bag.weekday + " " + bag.day + " " + bag.month,
  };
}

export function zonedISODate(date, timeZone) {
  const bag = bagFrom(date, timeZone, true);
  return bag.year + "-" + bag.month + "-" + bag.day;
}

export function offsetMinutes(date, timeZone) {
  const bag = bagFrom(date, timeZone, true);
  const asUTC = Date.UTC(+bag.year, +bag.month - 1, +bag.day, +bag.hour, +bag.minute, +bag.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

export function zonedTimeToUtc(isoDate, hhmm, timeZone) {
  const [y, mo, d] = isoDate.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  let utc = Date.UTC(y, mo - 1, d, h, mi, 0);
  for (let i = 0; i < 2; i += 1) {
    utc = Date.UTC(y, mo - 1, d, h, mi, 0) - offsetMinutes(new Date(utc), timeZone) * 60000;
  }
  return new Date(utc);
}

export function apartLabel(date, personA, personB) {
  if (!personA.timezone || !personB.timezone) return "";
  const diff = offsetMinutes(date, personB.timezone) - offsetMinutes(date, personA.timezone);
  if (diff === 0) return "Same time right now";
  const ahead = diff > 0 ? personB : personA;
  return ahead.name + " · " + formatDuration(Math.abs(diff)) + " ahead";
}

export function untilLabel(from, to) {
  const diff = Math.round((to.getTime() - from.getTime()) / 60000);
  if (Math.abs(diff) > 60 * 36) {
    const days = Math.round(Math.abs(diff) / (60 * 24));
    if (diff > 0) return days === 1 ? "in 1 day" : "in " + days + " days";
    return days === 1 ? "1 day ago" : days + " days ago";
  }
  if (diff > 0) return "in " + formatDuration(diff);
  if (diff >= -1) return "Now";
  return formatDuration(-diff) + " ago";
}

export function daysUntil(isoDate, timeZone, now) {
  const today = zonedISODate(now, timeZone || "UTC");
  return Math.round((Date.parse(isoDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
}

export function visitLine(days) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1) return "In " + days + " days";
  return "That day has passed";
}

export function callInstant(call) {
  return zonedTimeToUtc(call.date, call.time, call.zone);
}
