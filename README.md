Two calendars on one page, hers on the left and yours on the right, with a pinned call and a drawing.

`server.js` stores the board in `data/board.json`, or in Postgres when `DATABASE_URL` is set. Set `BOARD_KEY` as well when both people should write the same board.

GitHub Pages serves the static page and does not run `server.js`. When `/api/board` is missing, the page reads and writes the shared board at the public JSON document in `seed.mjs`, so an edit, a call, or a drawing on one browser shows up on the other. If that document cannot be reached, the page still shows the seeded week. A same-origin server keeps using `/api/board`. The workflow in `.github/workflows/pages.yml` publishes the static files.

Locally: `npm install`, then `npm start`. `npm test` runs the checks.
