import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DAYS, MAX_POINTS, MAX_STROKES, STROKE_COLORS, STROKE_WIDTHS } from "./view.mjs";

const DAY_IDS = DAYS.map((day) => day.id);

function block(id, title, start = "", end = "", note = "") {
  return { id, title, start, end, note };
}

const SEED = {
  people: [
    {
      id: "left",
      name: "Teegan",
      timezone: "Europe/Dublin",
      days: [
        {
          id: "monday",
          blocks: [
            block("mon-school", "School", "08:50", "15:45"),
            block("mon-volley", "Volleyball", "16:00", "17:00"),
            block("mon-irish", "Irish dancing", "17:45", "19:45"),
            block("mon-evening", "Eat, chill, and sleep", "19:45", "", "The rest of the night"),
          ],
        },
        {
          id: "tuesday",
          blocks: [
            block("tue-school", "School", "08:50", "15:45"),
            block("tue-athlone", "Athlone", "15:45", "19:00", "After school"),
            block("tue-night", "Panto or youth band", "19:00", "", "One or the other"),
          ],
        },
        {
          id: "wednesday",
          blocks: [
            block("wed-school", "School", "08:50", "15:45"),
            block("wed-free", "Nothing on", "15:45", "", "No plans after school"),
          ],
        },
        {
          id: "thursday",
          blocks: [
            block("thu-school", "School", "08:50", "15:45"),
            block("thu-irish", "Irish dancing", "19:00", "20:30"),
          ],
        },
        {
          id: "friday",
          blocks: [
            block("fri-school", "School", "08:50", "15:45", "Usual hours"),
            block("fri-art", "Art club", "14:00", "15:30", "She called this after school"),
            block("fri-panto", "Panto", "20:00", "21:00"),
          ],
        },
        { id: "saturday", blocks: [block("sat-dance", "Dancing", "14:45", "16:30")] },
        { id: "sunday", blocks: [block("sun-free", "Free", "", "", "Sometimes panto")] },
      ],
    },
    {
      id: "right",
      name: "You",
      timezone: "",
      days: [
        {
          id: "monday",
          blocks: [
            block("mon-school", "School", "07:50", "15:00"),
            block("mon-ball", "Basketball", "18:00", "19:30"),
          ],
        },
        {
          id: "tuesday",
          blocks: [
            block("tue-school", "School", "07:50", "13:50"),
            block("tue-ball", "Basketball", "20:00", "21:30"),
          ],
        },
        {
          id: "wednesday",
          blocks: [
            block("wed-school", "School", "07:50", "13:50"),
            block("wed-free", "Nothing on", "13:50", "", "No plans after school"),
          ],
        },
        {
          id: "thursday",
          blocks: [block("thu-school", "School", "07:50", "17:10")],
        },
        {
          id: "friday",
          blocks: [
            block("fri-school", "School", "07:50", "13:50"),
            block("fri-ball", "Basketball", "18:30", "20:00"),
          ],
        },
        { id: "saturday", blocks: [] },
        { id: "sunday", blocks: [] },
      ],
    },
  ],
  calls: [],
  visit: { date: "", place: "" },
  strokes: [],
};

export function freshSeed() {
  return structuredClone(SEED);
}

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

let queue = Promise.resolve();

function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => {},
    () => {}
  );
  return run;
}

export function memoryStore(initial = freshSeed()) {
  let board = structuredClone(initial);
  return {
    async read() {
      return structuredClone(board);
    },
    async write(next) {
      board = structuredClone(next);
    },
  };
}

export function fileStore(file) {
  return {
    async read() {
      try {
        return JSON.parse(await readFile(file, "utf8"));
      } catch (err) {
        if (err && err.code === "ENOENT") return freshSeed();
        throw err;
      }
    },
    async write(next) {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = file + ".tmp";
      await writeFile(tmp, JSON.stringify(next));
      await rename(tmp, file);
    },
  };
}

export function createPgStore(pool) {
  const ready = pool.query(
    `CREATE TABLE IF NOT EXISTS board (
      id integer PRIMARY KEY CHECK (id = 1),
      doc jsonb NOT NULL
    )`
  );
  return {
    async transact(fn) {
      await ready;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO board (id, doc) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING",
          [JSON.stringify(freshSeed())]
        );
        const found = await client.query("SELECT doc FROM board WHERE id = 1 FOR UPDATE");
        const current = typeof found.rows[0].doc === "string" ? JSON.parse(found.rows[0].doc) : found.rows[0].doc;
        const next = await fn(current);
        await client.query("UPDATE board SET doc = $1::jsonb WHERE id = 1", [JSON.stringify(next)]);
        await client.query("COMMIT");
        return next;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The connection may already be closed.
        }
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export async function changeBoard(store, mutator) {
  const run = async (current) => validateBoard(mutator(structuredClone(current)));
  if (store.transact) return store.transact(run);
  return enqueue(async () => {
    const next = await run(await store.read());
    await store.write(next);
    return next;
  });
}
