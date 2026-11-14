Two calendars on one page, hers on the left and yours on the right, with a pinned call.

`server.js` stores the board in `data/board.json`, or in Postgres when `DATABASE_URL` is set. Set `BOARD_KEY` as well when both people should write the same board.

GitHub Pages can serve the page only. It does not run `server.js`, so an edit or a call on one browser is not visible on another until that server is hosted. Pages is not turned on yet. Under Settings, Pages, choose GitHub Actions as the source. The workflow in `.github/workflows/pages.yml` publishes the static files after that.

Locally: `npm install`, then `npm start`. `npm test` runs the checks.
