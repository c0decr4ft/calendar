import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  HttpError,
  changeBoard,
  cleanCall,
  cleanPerson,
  cleanStroke,
  cleanVisit,
  createPgStore,
  fileStore,
  freshSeed,
} from "./store.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/view.mjs": ["view.mjs", "text/javascript; charset=utf-8"],
  "/seed.mjs": ["seed.mjs", "text/javascript; charset=utf-8"],
  "/board.mjs": ["board.mjs", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
  "/fonts/atkinson-hyperlegible-400.woff2": ["fonts/atkinson-hyperlegible-400.woff2", "font/woff2"],
  "/fonts/atkinson-hyperlegible-700.woff2": ["fonts/atkinson-hyperlegible-700.woff2", "font/woff2"],
};

export function currentMode() {
  if (process.env.DATABASE_URL && process.env.BOARD_KEY) return "shared";
  if (process.env.DATABASE_URL) return "preview";
  return "local";
}

function keyMatches(req, expected) {
  if (!expected) return false;
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ") || header.length > 240) return false;
  const got = header.slice("Bearer ".length);
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(got).digest();
  return crypto.timingSafeEqual(a, b);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 100_000) {
        reject(new HttpError(413, "That was too big."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "That could not be read."));
      }
    });
    req.on("error", () => reject(new HttpError(400, "That could not be read.")));
  });
}

function newId() {
  return crypto.randomBytes(4).toString("hex");
}

async function openStore() {
  if (currentMode() === "shared") {
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    return createPgStore(pool);
  }
  if (currentMode() === "preview") return null;
  const file = process.env.BOARD_FILE || path.join(root, "data", "board.json");
  return fileStore(file);
}

export function createServer(options = {}) {
  const getMode = options.getMode || currentMode;
  let storePromise = options.store ? Promise.resolve(options.store) : null;
  const hits = new Map();
  const expectedKey = () =>
    Object.prototype.hasOwnProperty.call(options, "key") ? options.key || "" : process.env.BOARD_KEY || "";

  function limited(ip, bucket, max) {
    const now = Date.now();
    const key = ip + ":" + bucket;
    const row = hits.get(key);
    if (!row || now - row.start > 60_000) {
      hits.set(key, { start: now, n: 1 });
      if (hits.size > 2000) hits.clear();
      return false;
    }
    row.n += 1;
    return row.n > max;
  }

  async function storeFor(mode) {
    if (mode === "preview") return null;
    if (options.store) return options.store;
    if (!storePromise) storePromise = openStore();
    return storePromise;
  }

  return http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error("request failed", err && err.code ? err.code : "error");
      if (!res.headersSent) {
        sendJson(res, status, { error: err instanceof HttpError ? err.message : "Something went wrong." });
      }
    }
  });

  async function route(req, res) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const ip = req.socket.remoteAddress || "local";
    const mode = getMode();
    const writing = req.method !== "GET" && req.method !== "HEAD";
    const strokeWrite = writing && url.pathname === "/api/strokes";
    const bucket = !writing ? "read" : strokeWrite ? "stroke" : "write";
    const max = bucket === "write" ? 30 : 120;
    if (limited(ip, bucket, max)) {
      throw new HttpError(429, "Slow down a moment.");
    }

    if (url.pathname === "/api/board" && req.method === "GET") {
      if (mode === "preview") {
        sendJson(res, 200, { mode, board: freshSeed() });
        return;
      }
      if (mode === "shared" && !keyMatches(req, expectedKey())) {
        sendJson(res, 401, { mode: "shared", error: "That code didn't match." });
        return;
      }
      const store = await storeFor(mode);
      sendJson(res, 200, { mode: mode === "shared" ? "shared" : "local", board: await store.read() });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      if (mode === "preview") throw new HttpError(403, "Shared saving isn't on yet.");
      if (mode === "shared" && !keyMatches(req, expectedKey())) {
        sendJson(res, 401, { mode: "shared", error: "That code didn't match." });
        return;
      }
      const type = String(req.headers["content-type"] || "");
      if ((req.method === "PUT" || req.method === "POST") && !type.includes("application/json")) {
        throw new HttpError(400, "That could not be read.");
      }
      const store = await storeFor(mode);
      sendJson(res, 200, { mode: mode === "shared" ? "shared" : "local", board: await handleWrite(req, url, store) });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Not found.");
    const file = STATIC[url.pathname];
    if (!file || file[0].includes("..")) throw new HttpError(404, "Not found.");
    const full = path.resolve(root, file[0]);
    if (!full.startsWith(root + path.sep) && full !== path.join(root, "index.html")) {
      throw new HttpError(404, "Not found.");
    }
    res.writeHead(req.method === "HEAD" ? 200 : 200, {
      "content-type": file[1],
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-cache",
      "content-security-policy":
        "default-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; script-src 'self'; connect-src 'self' https://api.npoint.io; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    await new Promise((resolve, reject) => {
      const stream = createReadStream(full);
      stream.on("error", () => {
        if (!res.headersSent) reject(new HttpError(404, "Not found."));
        else res.end();
        resolve();
      });
      stream.on("end", resolve);
      stream.pipe(res);
    });
  }
}

async function handleWrite(req, url, store) {
  const personMatch = url.pathname.match(/^\/api\/people\/(left|right)$/);
  if (personMatch && req.method === "PUT") {
    const id = personMatch[1];
    const person = cleanPerson(await readBody(req), id);
    return changeBoard(store, (board) => {
      board.people = board.people.map((item) => (item.id === id ? person : item));
      return board;
    });
  }

  if (url.pathname === "/api/calls" && req.method === "POST") {
    const call = cleanCall({ ...(await readBody(req)), id: newId() });
    return changeBoard(store, (board) => {
      if (board.calls.length >= 20) throw new HttpError(400, "Take down an old call first.");
      board.calls.push(call);
      return board;
    });
  }

  const callMatch = url.pathname.match(/^\/api\/calls\/([a-z0-9-]{4,24})$/);
  if (callMatch && req.method === "DELETE") {
    const id = callMatch[1];
    return changeBoard(store, (board) => {
      const next = board.calls.filter((call) => call.id !== id);
      if (next.length === board.calls.length) throw new HttpError(404, "That call is already down.");
      board.calls = next;
      return board;
    });
  }

  if (url.pathname === "/api/visit" && req.method === "PUT") {
    const visit = cleanVisit(await readBody(req));
    return changeBoard(store, (board) => {
      board.visit = visit;
      return board;
    });
  }

  if (url.pathname === "/api/strokes" && req.method === "POST") {
    const raw = await readBody(req);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new HttpError(400, "That stroke could not be saved.");
    }
    const stroke = cleanStroke({ ...raw, id: raw.id || newId() });
    return changeBoard(store, (board) => {
      const strokes = Array.isArray(board.strokes) ? board.strokes : [];
      board.strokes = strokes.concat(stroke);
      return board;
    });
  }

  if (url.pathname === "/api/strokes" && req.method === "DELETE") {
    return changeBoard(store, (board) => {
      board.strokes = [];
      return board;
    });
  }

  throw new HttpError(404, "Not found.");
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || "0.0.0.0";
  createServer()
    .listen(port, host, () => {
      console.log("wall listening on " + port);
    })
    .on("error", (err) => {
      console.error("server failed", err && err.code ? err.code : "error");
      process.exit(1);
    });
}
