-- Leaderboard for SpillSide. Tider er unix-sekunder.
CREATE TABLE IF NOT EXISTS brukere (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  navn TEXT NOT NULL,                 -- slik brukeren skrev det
  navn_lc TEXT NOT NULL UNIQUE,       -- normalisert (små bokstaver) for unikhet og innlogging
  passord TEXT NOT NULL,              -- pbkdf2$<iterasjoner>$<salt b64>$<hash b64>
  opprettet INTEGER NOT NULL,
  sist_sett INTEGER NOT NULL,
  utestengt INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS okter (
  token_hash TEXT PRIMARY KEY,        -- sha256 av kapselverdien
  bruker_id INTEGER NOT NULL REFERENCES brukere(id) ON DELETE CASCADE,
  opprettet INTEGER NOT NULL,
  utloper INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS okter_bruker ON okter(bruker_id);

-- Én rad per gang et spill åpnes av en innlogget bruker. Poeng må vise til en slik rad,
-- og den må være gammel nok (minste spilletid) før poeng godtas.
CREATE TABLE IF NOT EXISTS spilleokter (
  id TEXT PRIMARY KEY,
  bruker_id INTEGER NOT NULL REFERENCES brukere(id) ON DELETE CASCADE,
  spill TEXT NOT NULL,
  startet INTEGER NOT NULL,
  innsendinger INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS spilleokter_bruker ON spilleokter(bruker_id, startet);

-- Beste resultat per bruker per spill. Det er dette tavla viser.
CREATE TABLE IF NOT EXISTS rekorder (
  bruker_id INTEGER NOT NULL REFERENCES brukere(id) ON DELETE CASCADE,
  spill TEXT NOT NULL,
  poeng INTEGER NOT NULL,
  satt INTEGER NOT NULL,
  PRIMARY KEY (bruker_id, spill)
);
CREATE INDEX IF NOT EXISTS rekorder_tavle ON rekorder(spill, poeng DESC, satt ASC);

-- Alle innsendinger, også de som ikke ble ny rekord. For å kunne ettergå juks.
CREATE TABLE IF NOT EXISTS poenglogg (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bruker_id INTEGER NOT NULL,
  spill TEXT NOT NULL,
  poeng INTEGER NOT NULL,
  spilletid INTEGER NOT NULL,         -- sekunder siden spilleøkten startet
  ip_hash TEXT,
  tid INTEGER NOT NULL,
  godtatt INTEGER NOT NULL,           -- 1 = ny rekord, 0 = avvist eller ikke bedre
  grunn TEXT
);
CREATE INDEX IF NOT EXISTS poenglogg_bruker ON poenglogg(bruker_id, tid);

-- Enkel sperre mot gjetting av passord og masseoppretting av brukere, per IP (hashet).
CREATE TABLE IF NOT EXISTS forsok (
  ip_hash TEXT NOT NULL,
  type TEXT NOT NULL,                 -- 'innlogging' | 'registrering'
  tid INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS forsok_ip ON forsok(ip_hash, type, tid);
