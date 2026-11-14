import { DAYS, MAX_POINTS, MAX_STROKES, STROKE_COLORS, STROKE_WIDTHS } from "./view.mjs";

const DAY_IDS = DAYS.map((day) => day.id);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}

function validZone(zone) {
  if (zone === "") return true;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function normTime(value, required) {
  if (value == null || value === "") {
    if (required) throw new HttpError(400, "Add a time.");
    return "";
  }
  if (typeof value !== "string") throw new HttpError(400, "Add a time.");
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) throw new HttpError(400, "Use a real time.");
  return match[1] + ":" + match[2];
}

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (y < 2024 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function cleanId(value) {
  if (typeof value !== "string" || !/^[a-z0-9-]{4,24}$/.test(value)) {
    throw new HttpError(400, "That line could not be saved.");
  }
  return value;
}

export function cleanPerson(input, id) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "That note could not be saved.");
  }
  if (input.id !== id) throw new HttpError(400, "That note could not be saved.");
  const name = cleanText(input.name, 40);
  if (!name) throw new HttpError(400, "The note needs a name.");
  const timezone = typeof input.timezone === "string" ? input.timezone.trim() : "";
  if (!validZone(timezone)) throw new HttpError(400, "Pick a time zone from the list.");
  if (!Array.isArray(input.days)) throw new HttpError(400, "The week could not be saved.");

  const byId = new Map();
  for (const day of input.days) {
    if (!day || typeof day !== "object" || !DAY_IDS.includes(day.id) || byId.has(day.id)) {
      throw new HttpError(400, "The week could not be saved.");
    }
    if (!Array.isArray(day.blocks) || day.blocks.length > 8) {
      throw new HttpError(400, day.blocks && day.blocks.length > 8 ? "Keep a day to 8 lines." : "The week could not be saved.");
    }
    const blocks = [];
    const seen = new Set();
    for (const raw of day.blocks) {
      if (!raw || typeof raw !== "object") throw new HttpError(400, "A line could not be saved.");
      const title = cleanText(raw.title, 80);
      const start = normTime(raw.start, false);
      const end = normTime(raw.end, false);
      const note = cleanText(raw.note, 120);
      if (!title && !start && !end && !note) continue;
      if (!title) throw new HttpError(400, "Name each line you add.");
      if (start && end && end <= start) throw new HttpError(400, "The end time has to be after the start.");
      const blockId = cleanId(raw.id);
      if (seen.has(blockId)) throw new HttpError(400, "A line could not be saved.");
      seen.add(blockId);
      blocks.push({ id: blockId, title, start, end, note });
    }
    byId.set(day.id, { id: day.id, blocks });
  }
  if (byId.size !== DAY_IDS.length) throw new HttpError(400, "The week is missing a day.");
  return { id, name, timezone, days: DAY_IDS.map((dayId) => byId.get(dayId)) };
}

export function cleanCall(input) {
  if (!input || typeof input !== "object") throw new HttpError(400, "That call could not be saved.");
  if (!validDate(input.date)) throw new HttpError(400, "Pick a date.");
  const time = normTime(input.time, true);
  const zone = typeof input.zone === "string" ? input.zone.trim() : "";
  if (!zone || !validZone(zone)) throw new HttpError(400, "Pick which time zone that call is in.");
  return { id: cleanId(input.id), date: input.date, time, zone, note: cleanText(input.note, 80) };
}

export function cleanVisit(input) {
  if (!input || typeof input !== "object") throw new HttpError(400, "That day could not be saved.");
  const date = input.date == null || input.date === "" ? "" : input.date;
  if (date !== "" && !validDate(date)) throw new HttpError(400, "Pick a date.");
  return { date, place: date ? cleanText(input.place, 80) : "" };
}

function unitInterval(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new HttpError(400, "That stroke could not be saved.");
  }
  return Math.round(value * 10000) / 10000;
}

export function cleanStroke(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "That stroke could not be saved.");
  }
  if (typeof input.id !== "string" || !/^[a-z0-9-]{4,24}$/.test(input.id)) {
    throw new HttpError(400, "That stroke could not be saved.");
  }
  if (!STROKE_COLORS.includes(input.color) || !STROKE_WIDTHS.includes(input.width)) {
    throw new HttpError(400, "That stroke could not be saved.");
  }
  if (!Array.isArray(input.points) || input.points.length < 1 || input.points.length > MAX_POINTS) {
    throw new HttpError(400, "That stroke could not be saved.");
  }
  const points = input.points.map((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) throw new HttpError(400, "That stroke could not be saved.");
    return [unitInterval(pair[0]), unitInterval(pair[1])];
  });
  return { id: input.id, color: input.color, width: input.width, points };
}

function cleanStrokes(input) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > MAX_STROKES) {
    throw new HttpError(400, input && input.length > MAX_STROKES ? "Clear the wall before drawing more." : "The drawing could not be saved.");
  }
  const strokes = input.map((stroke) => cleanStroke(stroke));
  if (new Set(strokes.map((stroke) => stroke.id)).size !== strokes.length) {
    throw new HttpError(400, "That stroke could not be saved.");
  }
  return strokes;
}

export function validateBoard(board) {
  if (!board || !Array.isArray(board.people)) throw new HttpError(400, "The wall could not be saved.");
  const left = cleanPerson(board.people.find((person) => person.id === "left"), "left");
  const right = cleanPerson(board.people.find((person) => person.id === "right"), "right");
  if (!Array.isArray(board.calls) || board.calls.length > 20) throw new HttpError(400, "Take down an old call first.");
  const calls = board.calls.map((call) => cleanCall(call));
  if (new Set(calls.map((call) => call.id)).size !== calls.length) throw new HttpError(400, "That call could not be saved.");
  return {
    people: [left, right],
    calls,
    visit: cleanVisit(board.visit || { date: "", place: "" }),
    strokes: cleanStrokes(board.strokes),
  };
}
