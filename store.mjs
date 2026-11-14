import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateBoard } from "./board.mjs";
import { freshSeed } from "./seed.mjs";

export { freshSeed } from "./seed.mjs";
export {
  HttpError,
  validDate,
  cleanPerson,
  cleanCall,
  cleanVisit,
  cleanStroke,
  validateBoard,
} from "./board.mjs";

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
