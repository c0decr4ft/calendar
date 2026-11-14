import { cleanCall, cleanPerson, validateBoard } from "./board.mjs";
import { freshSeed, PUBLIC_BOARD_URL } from "./seed.mjs";
import {
  DAYS,
  ZONES,
  apartLabel,
  blockWhen,
  callInstant,
  dayStatus,
  statusLine,
  untilLabel,
  zonedParts,
} from "./view.mjs";

const CODE_KEY = "side-by-side-code";
const live = [];
let saveChain = Promise.resolve();
let transport = "pending";

const state = {
  mode: "local",
  board: null,
  locked: false,
  lockError: "",
  editing: null,
  draft: null,
  panel: null,
  focusId: "",
};

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function storedCode() {
  try {
    return localStorage.getItem(CODE_KEY) || "";
  } catch {
    return "";
  }
}

function storeCode(value) {
  try {
    if (value) localStorage.setItem(CODE_KEY, value);
    else localStorage.removeItem(CODE_KEY);
  } catch {
    // The browser can refuse storage. The code still works for this request.
  }
}

function watch(node, fn) {
  live.push({ node, fn });
  node.textContent = fn(new Date());
  return node;
}

function newId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function flash(message) {
  const node = document.getElementById("notice");
  if (!node) return;
  node.textContent = message;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => {
    node.textContent = "";
  }, 2500);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const code = storedCode();
  if (code) headers.authorization = "Bearer " + code;
  const res = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (res.status === 401) {
    storeCode("");
    state.locked = true;
    state.mode = "shared";
    state.board = null;
    state.lockError = data.error || "That code didn't match.";
    state.editing = null;
    state.draft = null;
    state.panel = null;
    render();
    const error = new Error("locked");
    error.locked = true;
    throw error;
  }
  if (!res.ok) {
    const error = new Error(data.error || "Could not save.");
    error.locked = false;
    throw error;
  }
  return data;
}

function personById(id) {
  return state.board.people.find((person) => person.id === id);
}

function personClock(person, now) {
  if (!person.timezone) return "Time zone not set";
  const where = ZONES.find((zone) => zone[0] === person.timezone);
  const parts = zonedParts(now, person.timezone);
  return (where ? where[1] : person.timezone) + " · " + parts.clockLabel;
}

function personStatus(person, now) {
  if (!person.timezone) return "Set a time zone so this note knows the time.";
  const parts = zonedParts(now, person.timezone);
  const day = person.days.find((item) => item.id === parts.weekday.toLowerCase());
  if (!day) return "";
  return statusLine(day.blocks, parts.minutes);
}

function render() {
  live.length = 0;
  const app = document.getElementById("app");
  app.replaceChildren();
  if (state.locked || !state.board) {
    app.append(lockNote());
    return;
  }
  if (state.mode === "local") {
    app.append(el("p", { class: "banner" }, "Saved on this computer only. The other phone won’t see a change until this wall is shared."));
  } else if (state.mode === "preview") {
    app.append(el("p", { class: "banner" }, "This is the starting week. Shared saving isn’t on yet, so the notes can’t be changed from here."));
  } else if (state.mode === "memory") {
    app.append(el("p", { class: "banner" }, "This tab has the starting week. A change here stays in this tab."));
  }
  app.append(clocks(), actions(), wall(), el("p", { class: "footnote" }, "Each note keeps its own time zone. A pinned call stays up until you take it down."));
  paintLive();
  if (state.focusId) {
    const target = document.querySelector('[data-block="' + state.focusId + '"] input[name="title"]');
    state.focusId = "";
    if (target) target.focus();
  }
}

function clocks() {
  const line = watch(el("p", { class: "clock-line" }), (now) =>
    state.board.people
      .map((person) => (person.timezone ? person.name + " · " + zonedParts(now, person.timezone).clockLabel : person.name + " · set a time zone"))
      .join("  ·  ")
  );
  const apart = watch(el("p", { class: "apart" }), (now) => apartLabel(now, state.board.people[0], state.board.people[1]));
  return el("div", { class: "clocks" }, line, apart);
}

function actions() {
  const off = state.mode === "preview";
  return el("div", { class: "actions" }, el("button", { type: "button", disabled: off, onClick: () => openPanel("call") }, "Plan a call"));
}

function openPanel(panel) {
  if (state.mode === "preview") return;
  state.panel = panel;
  state.editing = null;
  state.draft = null;
  render();
}

function wall() {
  const [left, right] = state.board.people;
  return el("div", { class: "wall" }, personColumn(left), center(), personColumn(right));
}

function personColumn(person) {
  if (state.editing === person.id) return editor(state.draft);
  return personNote(person);
}

function personNote(person) {
  const any = person.days.some((day) => day.blocks.length);
  return el(
    "article",
    { class: "note note-" + person.id, dataset: { person: person.id, zone: person.timezone } },
    el("h2", {}, person.name),
    watch(el("p", { class: "note-clock" }), (now) => personClock(person, now)),
    watch(el("p", { class: "now-line" }), (now) => personStatus(person, now)),
    any ? el("div", { class: "days" }, person.days.filter((day) => day.blocks.length).map((day) => dayView(day))) : el("p", { class: "clear" }, "Nothing written on this note yet."),
    state.mode === "preview"
      ? null
      : el("div", { class: "note-actions" }, el("button", { type: "button", class: "text-btn", onClick: () => startEdit(person) }, "Write on this note"))
  );
}

function dayView(day) {
  const meta = DAYS.find((item) => item.id === day.id);
  return el(
    "section",
    { class: "day", dataset: { day: day.id } },
    el("h3", {}, meta.short),
    el(
      "ul",
      {},
      day.blocks.map((block) => {
        const when = blockWhen(block);
        return el(
          "li",
          { class: "line", dataset: { id: block.id } },
          el("p", { class: "line-title" }, when ? block.title + " — " + when : block.title),
          block.note ? el("p", { class: "line-note" }, block.note) : null
        );
      })
    )
  );
}

function startEdit(person) {
  state.editing = person.id;
  state.draft = structuredClone(person);
  state.panel = null;
  render();
}

function zoneSelect(value) {
  const select = el("select", { "aria-label": "Time zone" });
  const blank = el("option", { value: "" }, "Choose a time zone");
  if (!value) blank.selected = true;
  select.append(blank);
  for (const [id, label] of ZONES) {
    const option = el("option", { value: id }, label);
    if (id === value) option.selected = true;
    select.append(option);
  }
  if (value && !ZONES.some((zone) => zone[0] === value)) {
    const extra = el("option", { value }, value);
    extra.selected = true;
    select.append(extra);
  }
  return select;
}

function editor(person) {
  const error = el("p", { class: "form-error", role: "alert" });
  const name = el("input", {
    class: "editor-name",
    type: "text",
    value: person.name,
    maxlength: "40",
    "aria-label": "Name on this note",
    spellcheck: "false",
  });
  name.addEventListener("input", () => {
    person.name = name.value;
  });
  const zone = zoneSelect(person.timezone);
  zone.addEventListener("change", () => {
    person.timezone = zone.value;
  });
  const form = el(
    "form",
    { class: "editor" },
    name,
    zone,
    person.days.map((day) => dayEditor(person, day)),
    error,
    el(
      "div",
      { class: "form-row" },
      el("button", { type: "submit" }, "Save"),
      el("button", { type: "button", class: "text-btn", onClick: cancelEdit }, "Cancel")
    )
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    const body = structuredClone(person);
    body.name = name.value.trim();
    body.timezone = zone.value;
    for (const day of body.days) {
      day.blocks = day.blocks.filter((block) => block.title.trim() || block.start || block.end || block.note.trim());
    }
    try {
      const saved = await persistPerson(body);
      state.board = saved.board;
      state.editing = null;
      state.draft = null;
      render();
      flash("Saved. The other note is unchanged.");
    } catch (err) {
      if (!err.locked) error.textContent = err.message;
    }
  });
  return el("article", { class: "note note-" + person.id + " is-editing" }, form);
}

function dayEditor(person, day) {
  const meta = DAYS.find((item) => item.id === day.id);
  return el(
    "section",
    { class: "day-edit" },
    el("h3", {}, meta.name),
    day.blocks.map((block) => lineEditor(person, day, block)),
    el(
      "button",
      {
        type: "button",
        class: "text-btn",
        onClick: () => {
          const id = newId();
          day.blocks.push({ id, title: "", start: "", end: "", note: "" });
          state.focusId = id;
          render();
        },
      },
      "Add a line"
    )
  );
}

function lineEditor(person, day, block) {
  const title = el("input", { type: "text", name: "title", value: block.title, maxlength: "80", placeholder: "School, call, free…", "aria-label": "Line" });
  const start = el("input", { type: "time", name: "start", value: block.start, "aria-label": "Start" });
  const end = el("input", { type: "time", name: "end", value: block.end, "aria-label": "End" });
  const note = el("input", { type: "text", name: "note", value: block.note, maxlength: "120", placeholder: "Note", "aria-label": "Note" });
  title.addEventListener("input", () => {
    block.title = title.value;
  });
  start.addEventListener("input", () => {
    block.start = start.value;
  });
  end.addEventListener("input", () => {
    block.end = end.value;
  });
  note.addEventListener("input", () => {
    block.note = note.value;
  });
  return el(
    "div",
    { class: "line-edit", dataset: { block: block.id } },
    title,
    start,
    end,
    note,
    el(
      "button",
      {
        type: "button",
        class: "text-btn remove",
        onClick: () => {
          day.blocks = day.blocks.filter((item) => item.id !== block.id);
          render();
        },
      },
      "Remove"
    )
  );
}

function cancelEdit() {
  state.editing = null;
  state.draft = null;
  render();
}

function center() {
  const kids = [];
  if (state.panel === "call") kids.push(callForm());
  const calls = sortedCalls();
  if (!calls.length && state.panel !== "call") kids.push(el("p", { class: "empty-call" }, "No call pinned."));
  kids.push(...calls.map((call) => callNote(call)));
  return el("div", { class: "center" }, kids);
}

function sortedCalls(now = new Date()) {
  const mark = now.getTime() - 60_000;
  const decorated = state.board.calls.map((call) => ({ call, at: callInstant(call).getTime() }));
  const ahead = decorated.filter((item) => item.at >= mark).sort((a, b) => a.at - b.at);
  const past = decorated.filter((item) => item.at < mark).sort((a, b) => b.at - a.at);
  return [...ahead, ...past].map((item) => item.call);
}

function callForm() {
  const error = el("p", { class: "form-error", role: "alert" });
  const select = el("select", { name: "zone", "aria-label": "Time zone of this call" });
  const seen = new Set();
  for (const person of state.board.people) {
    if (!person.timezone || seen.has(person.timezone)) continue;
    seen.add(person.timezone);
    select.append(el("option", { value: person.timezone }, person.name + "’s time"));
  }
  let browserZone = "";
  try {
    browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    browserZone = "";
  }
  if (browserZone && !seen.has(browserZone)) select.append(el("option", { value: browserZone }, "This phone’s time"));
  const form = el(
    "form",
    { class: "sheet-form note note-call" },
    el("h2", {}, "Plan a call"),
    labeled("Date", el("input", { type: "date", name: "date", required: "true" })),
    labeled("Time", el("input", { type: "time", name: "time", required: "true" })),
    labeled("This time is in", select),
    labeled("Note", el("input", { type: "text", name: "note", maxlength: "80", placeholder: "Goodnight, after dancing…" })),
    error,
    el(
      "div",
      { class: "form-row" },
      el("button", { type: "submit" }, "Pin it"),
      el("button", { type: "button", class: "text-btn", onClick: closePanel }, "Cancel")
    )
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    const data = Object.fromEntries(new FormData(form));
    if (!data.zone) {
      error.textContent = "Pick which time zone that call is in.";
      return;
    }
    try {
      const saved = await persistCall({ date: data.date, time: data.time, zone: data.zone, note: data.note || "" });
      state.board = saved.board;
      state.panel = null;
      render();
      flash("Call pinned.");
    } catch (err) {
      if (!err.locked) error.textContent = err.message;
    }
  });
  return form;
}

function labeled(text, field) {
  return el("label", {}, text, field);
}

function closePanel() {
  state.panel = null;
  render();
}

function callNote(call) {
  const at = callInstant(call);
  const times = state.board.people
    .filter((person) => person.timezone)
    .map((person) =>
      watch(el("p", { class: "call-time" }), () => {
        const parts = zonedParts(at, person.timezone);
        return person.name + " · " + parts.dateLabel + " · " + parts.clockLabel;
      })
    );
  return el(
    "article",
    { class: "note note-call" },
    el("p", { class: "kicker" }, "Call"),
    watch(el("p", { class: "remain" }), (now) => untilLabel(now, at)),
    ...times,
    call.note ? el("p", { class: "call-note" }, call.note) : null,
    state.mode === "preview"
      ? null
      : el(
          "div",
          { class: "note-actions" },
          el("button", { type: "button", class: "text-btn", onClick: () => removeCall(call.id) }, "Take down")
        )
  );
}

async function removeCall(id) {
  try {
    const saved = await persistRemoveCall(id);
    state.board = saved.board;
    render();
    flash("Taken down.");
  } catch (err) {
    if (!err.locked) flash(err.message);
  }
}

function lockNote() {
  const error = el("p", { class: "form-error", role: "alert" }, state.lockError);
  const input = el("input", {
    type: "text",
    autocomplete: "off",
    spellcheck: "false",
    maxlength: "80",
    "aria-label": "The code you both know",
  });
  const form = el(
    "form",
    { class: "note note-lock" },
    el("h2", {}, "This wall is locked"),
    el("p", {}, "Type the code you both know."),
    input,
    error,
    el("button", { type: "submit" }, "Open")
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = input.value.trim();
    if (!code) {
      error.textContent = "Type the code.";
      return;
    }
    storeCode(code);
    state.lockError = "";
    try {
      await load();
    } catch (err) {
      if (!err.locked) error.textContent = err.message;
    }
  });
  return el("div", { class: "lock-wrap" }, form);
}

function enqueueSave(fn) {
  const run = saveChain.then(fn, fn);
  saveChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

function paintLive() {
  const now = new Date();
  for (const item of live) item.node.textContent = item.fn(now);
  if (!state.board) return;
  for (const note of document.querySelectorAll(".note[data-person]")) {
    const person = personById(note.dataset.person);
    if (!person || !person.timezone) continue;
    const parts = zonedParts(now, person.timezone);
    const weekday = parts.weekday.toLowerCase();
    const day = person.days.find((item) => item.id === weekday);
    const status = day ? dayStatus(day.blocks, parts.minutes) : { blockId: null };
    for (const section of note.querySelectorAll(".day")) {
      section.classList.toggle("is-today", section.dataset.day === weekday);
    }
    for (const line of note.querySelectorAll(".line")) {
      line.classList.toggle("is-now", line.dataset.id === status.blockId);
    }
  }
}

function plainError(message) {
  const error = new Error(message);
  error.locked = false;
  return error;
}

function adopt(board, mode) {
  state.board = board;
  state.mode = mode;
  state.locked = false;
  state.editing = null;
  state.draft = null;
  state.panel = null;
  if (!Array.isArray(state.board.strokes)) state.board.strokes = [];
  if (!Array.isArray(state.board.calls)) state.board.calls = [];
  render();
}

function httpFailure(status) {
  const error = plainError("Could not save.");
  error.status = status;
  return error;
}

async function attempt(fn) {
  let last = null;
  for (let i = 0; i < 3; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const status = err && err.status;
      if (err && err.locked) throw err;
      if (status && status < 500) throw err;
      if (i < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (i + 1)));
    }
  }
  throw last;
}

function documentReadUrl() {
  // This host caches a bare GET for an hour. A new query reads the latest board.
  const join = PUBLIC_BOARD_URL.includes("?") ? "&" : "?";
  return PUBLIC_BOARD_URL + join + "t=" + Date.now();
}

async function readDocument() {
  return attempt(async () => {
    const res = await fetch(documentReadUrl(), {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw httpFailure(res.status);
    const data = await res.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw plainError("Could not save.");
    return validateBoard({
      people: data.people,
      calls: data.calls,
      visit: data.visit || { date: "", place: "" },
      strokes: data.strokes,
    });
  });
}

async function writeDocument(board) {
  if (transport === "server") throw plainError("Could not save.");
  const payload = {
    people: board.people,
    calls: board.calls,
    visit: board.visit || { date: "", place: "" },
    strokes: board.strokes || [],
  };
  await attempt(async () => {
    const res = await fetch(PUBLIC_BOARD_URL, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw httpFailure(res.status);
  });
  return payload;
}

async function readWall() {
  if (transport === "server") return api("/api/board");
  if (transport === "document") return { mode: "shared", board: await readDocument() };
  throw plainError("Could not save.");
}

async function changeShared(mutator) {
  if (transport === "memory") {
    const next = validateBoard(mutator(structuredClone(state.board)));
    return { mode: "memory", board: next };
  }
  if (transport !== "document") throw plainError("Could not save.");
  const remote = await readDocument();
  const next = validateBoard(mutator(structuredClone(remote)));
  await writeDocument(next);
  return { mode: "shared", board: next };
}

async function persistPerson(person) {
  if (transport === "server") return api("/api/people/" + person.id, { method: "PUT", body: person });
  const cleaned = cleanPerson(person, person.id);
  return enqueueSave(() =>
    changeShared((board) => {
      board.people = board.people.map((item) => (item.id === cleaned.id ? cleaned : item));
      return board;
    })
  );
}

async function persistCall(input) {
  if (transport === "server") return api("/api/calls", { method: "POST", body: input });
  const call = cleanCall({ ...input, id: newId() });
  return enqueueSave(() =>
    changeShared((board) => {
      if (board.calls.length >= 20) throw plainError("Take down an old call first.");
      board.calls.push(call);
      return board;
    })
  );
}

async function persistRemoveCall(id) {
  if (transport === "server") return api("/api/calls/" + id, { method: "DELETE" });
  return enqueueSave(() =>
    changeShared((board) => {
      const next = board.calls.filter((call) => call.id !== id);
      if (next.length === board.calls.length) throw plainError("That call is already down.");
      board.calls = next;
      return board;
    })
  );
}

async function load() {
  try {
    const data = await api("/api/board");
    if (!data || !data.board || !Array.isArray(data.board.people)) throw plainError("Could not save.");
    transport = "server";
    adopt(data.board, data.mode);
    return;
  } catch (err) {
    if (err && err.locked) throw err;
  }
  try {
    const board = await readDocument();
    transport = "document";
    adopt(board, "shared");
    return;
  } catch {
    transport = "memory";
    adopt(freshSeed(), "memory");
  }
}

load().catch((err) => {
  if (err && err.locked) return;
  const app = document.getElementById("app");
  if (app && !state.board) app.textContent = "The wall didn’t open.";
});

setInterval(() => {
  if (!state.editing && !state.panel) paintLive();
}, 30000);


setInterval(async () => {
  if (transport === "pending" || transport === "memory") return;
  if (state.locked || state.editing || state.panel || !state.board) return;
  try {
    const data = await readWall();
    if (JSON.stringify(data.board) !== JSON.stringify(state.board)) {
      state.board = data.board;
      state.mode = data.mode;
      render();
    }
  } catch {
    // Keep the wall that’s already on screen.
  }
}, 15000);
