CREATE TABLE IF NOT EXISTS board (
  id integer PRIMARY KEY CHECK (id = 1),
  doc jsonb NOT NULL
);
