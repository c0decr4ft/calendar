Two calendars on one page, hers on the left and yours on the right, with a pinned call and a drawing.

`server.js` stores the board in `data/board.json`, or in Postgres when `DATABASE_URL` is set. Set `BOARD_KEY` as well when both people should write the same board. GitHub Pages only serves the page. It does not run `server.js`, so edits and drawings stay on one browser until that server is hosted.

Locally: `npm install`, then `npm start`. `npm test` runs the checks.
