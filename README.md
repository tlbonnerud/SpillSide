# SpillSide

Spillbibliotek som spiller HTML5-spill fra itch.io som lokale kopier, med coverbilde for hvert spill og egen credits-side. Siden ligger i `public/`, som er det som publiseres til Cloudflare: <https://spillside.tlbonnerud.workers.dev/>

| Spill | Av | Motor | Mappe | itch.io |
| --- | --- | --- | --- | --- |
| How to Crab to Zero | Four Quarters team | GameMaker | `public/lokal/how-to-crab-to-zero/` | https://fourquarters.itch.io/how-to-crab-to-zero |
| Multi Modal Transit | southlondonsilicon | Vite/JS + wasm | `public/lokal/multi-modal/` | https://southlondonsilicon.itch.io/multi-modal |
| Legendum | Vadeum | Godot 4 | `public/lokal/legendum/` | https://vadeum.itch.io/legendum |
| Rock Declutterer | leafo | LÖVE (love.js) | `public/lokal/rock-declutterer/` | https://leafo.itch.io/rock-declutterer |
| PolyTrack | Kodub | egen motor | `public/lokal/polytrack/` | https://kodub.itch.io/polytrack |
| Die in the Dungeon CLASSIC | Alarts m.fl. | Unity WebGL | `public/lokal/die-in-the-dungeon/` | https://alarts.itch.io/die-in-the-dungeon |
| Idle Breakout | Kodiqi | GameMaker Studio 2 | `public/lokal/idle-breakout/` | https://kodiqi.itch.io/idle-breakout |
| Generic Fighter Maybe | Astrobard Games, Khao Mortadios | GameMaker Studio 2 | `public/lokal/generic-fighter-maybe/` | https://astrobardgames.itch.io/generic-fighter-maybe |
| Pikwip | Cookiecrayon | Unity WebGL | `public/lokal/pikwip/` | https://cookiecrayon.itch.io/pikwip |
| WildFire | Salvador (salvadorpalma) | Unity WebGL | `public/lokal/wildfire/` | https://salvadorpalma.itch.io/wildfire |
| Bobby's Beautiful Bugs | digitarium | Unity WebGL | `public/lokal/bobbys-bugs/` | https://digitarium.itch.io/bobbys-bugs |
| GET YOKED: Extreme Bodybuilding | gregs-games | Unity WebGL | `public/lokal/get-yoked-2/` | https://gregs-games.itch.io/get-yoked-2 |
| Hardware Tycoon | hi (haxor1337) | Construct 2 | `public/lokal/hardware-tycoon/` | https://haxor1337.itch.io/hardware-tycoon |
| Klifur | Torfi | Unity WebGL | `public/lokal/klifur/` | https://torfi.itch.io/klifur |
| Tanuki Sunset Classic | Rewind Games | Unity 2019 WebGL | `public/lokal/tanuki-sunset/` | https://rewindgames.itch.io/tanuki-sunset |
| Dynamine | HexagonNico | Godot 4 | `public/lokal/dynamine/` | https://hexagonnico.itch.io/dynamine |
| Soccer Physics | Otto Ojala | Unity WebGL | `public/lokal/soccer-physics/` | https://ottoojala.itch.io/soccer-physics |
| The MachinEGG | JC / QuantumGames | egen JS-motor (PixiJS) | `public/lokal/the-machinegg/` | https://quantumgames-studio.itch.io/the-machinegg |
| INFINIDLE | DevBanana | Unity WebGL | `public/lokal/infinidle/` | https://devbanana.itch.io/infinidle |

## Biblioteket

Forsiden er et moderne spillbibliotek i stil med Steam og Epic: et fremhevet banner for det nyeste spillet, sidemeny med Hjem, Sist spilt, Favoritter, kategorier og Credits, og et rutenett av kort med coverbilde. Mørk modus er standard, med lys modus via bryteren øverst til høyre. Alle spill spilles fra den lokale kopien; det finnes ingen itch.io-embed. Hvert spill har fanene **Spill** og **Credits**, der Credits viser hvem som har laget spillet med lenker til profilene deres, lenke til spillet på itch.io og tekniske detaljer.

| Fil | Innhold |
| --- | --- |
| `public/index.html`, `public/app.css`, `public/app.js` | Selve siden. Ren HTML, CSS og JavaScript uten byggesteg. Skriften Manrope hentes fra Google Fonts. |
| `public/data/games.json` | Alt om spillene: tittel, skapere med profillenker, itch-lenke, beskrivelse, motor, kategorier, kontroller, spillere, sideforhold, cover, størrelse, notater og eventuelt `score` for toppliste. Kategoriene i sidemenyen står også her. |
| `src/worker.js`, `src/api.js`, `src/ordfilter.js`, `migrations/` | Workeren: setter sammen store filer, og kjører leaderboard-API-et mot D1. |
| `public/covers/<slug>.webp` | Coverbildene, hentet fra itch.io og konvertert til WebP (maks 630 px bredt). |

Adressene er hash-ruter: `#/`, `#/kategori/<id>`, `#/favoritter`, `#/sist-spilt`, `#/credits`, `#/sok/<tekst>`, `#/spill/<slug>` og `#/spill/<slug>/credits`. Gamle lenker som `#polytrack` sendes videre til `#/spill/polytrack`. Favoritter, sist spilt og valgt tema lagres i nettleserens localStorage, etter at brukeren har sagt ja til det. Spill med toppliste har i tillegg fanen **Toppliste** (`#/spill/<slug>/toppliste`), se under.

Et spill kan merkes med `blocked` i games.json. Da viser spillvisningen en forklaring og en lenke til itch.io i stedet for spillet. Det brukes for Idle Breakout og PolyTrack, som begge har en sperre fra utvikleren som bare lar dem kjøre på bestemte nettsteder.

## Topplister og brukere

Spill med feltet `score` i games.json får en **Toppliste**-fane, og sidemenyen har en samlet Topplister-side (`#/topplister`). Brukere logger inn med bare brukernavn og passord (ingen e-post) via knappen øverst til høyre. Brukernavn er 3–16 tegn, må starte med en bokstav, er unike uavhengig av store og små bokstaver, og går gjennom et ordfilter (`src/ordfilter.js`) som også tar leetspeak og understrek-triks.

**Slik hentes poengene.** Spillene kjører i en iframe på samme origin, så `app.js` kan lese det de selv lagrer i nettleseren. Mens et spill med toppliste er åpent og brukeren er innlogget, leses verdien hvert 15. sekund og sendes inn når den er bedre enn brukerens beste på serveren. `score` i games.json sier hva som skal leses:

| Felt | Betydning |
| --- | --- |
| `kilde` | `iframe-tittel` (tall fra iframens vindustittel via regex `monster`), `localStorage` (ett tall under `nokkel`), `localStorage-json` (JSON-objekt under `nokkel`), `love-lua` (serialisert Lua-tabell i IndexedDB `/home/web_user/love/<sti>`), `unity` (PlayerPrefs-filen i IndexedDB `/idbfs`, nøkkel `nokkel`) eller `godot-cfg` (cfg-fil i `/userfs`, `sti`, `seksjon`, `nokkel`). |
| `felt`, `aggreger`, `skaler` | For JSON og Lua: `felt` er en sti i objektet (`state.totalEarnings`) eller en liste med stier som summeres. Peker stien på en liste/tabell, brukes `aggreger`: `maks` (standard) eller `sum`. `skaler` ganger opp før avrunding. |
| `id`, `navn` | Et spill kan ha flere topplister: gjør `score` til en liste der hver har `id` og `navn`. Den første/`standard` bruker bare slug som nøkkel, resten `slug/id`. |
| `format` | `tid` viser verdien som klokkeslett (t:mm:ss) og brukes med `retning: lavest`. |
| `enhet`, `retning` | Tekst etter tallet, og `hoyest` (standard) eller `lavest` (for tider). |
| `maks` | Tak. Alt over avvises av serveren. |
| `minSek` | Minste spilletid før serveren godtar poeng fra en spilleøkt (standard 30). |
| `tekst` | Forklaring som vises øverst i Toppliste-fanen. |

For å finne nøkkelen i et nytt spill: spill litt, og se i nettleserens DevTools under Application → Local Storage / IndexedDB hva som endrer seg. Unity-spill lagrer PlayerPrefs som en binærfil i `/idbfs/<hash>/PlayerPrefs`; `lesPlayerPrefs` i app.js dekoder den (nøkkellengde + nøkkel, så typebyte: under 0x80 kort streng, 0xFD float, 0xFE int, 0xFF lang streng). love.js-spill skriver filsystemet til IndexedDB først ved `beforeunload`, så broen sender et syntetisk beforeunload til iframen før den leser, og venter litt ved lukking.

Spill med toppliste nå, og hvor tallet kommer fra:

| Spill | Måles | Kilde |
| --- | --- | --- |
| Bobby's Beautiful Bugs | Vunne kabaler, alle vanskelighetsgrader | localStorage `digitarium-bbb`, `wins_*` |
| INFINIDLE | Lengste rekke i Unlimited | PlayerPrefs `highscore` |
| The MachinEGG | Endless: samlet inntekt. Speedrun: beste tid | localStorage `chickenIdleEndlessSave_guest` → `state.totalEarnings`, og `pb_speedrun` (sekunder) |
| Rock Declutterer | Beste poengsum i klassisk modus | `/home/web_user/love/rock-declutterer/progress.sav` → `scores.classic` |
| How to Crab to Zero | Høyeste brett nådd | Vindustittelen i iframen («Level N»), kilde `iframe-tittel` med `monster` (regex). Spillet lagrer ingenting selv. |

**Server og database.** `src/api.js` kjører i samme Worker og bruker D1-databasen `spillside-leaderboard` (binding `DB`, skjema i `migrations/`). Passord hashes med PBKDF2-SHA256 (25 000 iterasjoner, som holder seg under 10 ms CPU på gratisplanen). Økten er en HttpOnly-kapsel, så spillene kan ikke lese den, og alle POST-kall må ha headeren `X-Spillside: 1` (CSRF-vern).

| Rute | Gjør |
| --- | --- |
| `POST /api/registrer`, `POST /api/logg-inn`, `POST /api/logg-ut`, `GET /api/meg` | Konto og økt. Maks 5 registreringer per IP per døgn og 10 innloggingsforsøk per kvarter. |
| `POST /api/spilleokt/<slug>` | Åpner en spilleøkt når spillet starter. Poeng må vise til en slik. |
| `POST /api/poeng/<slug>` | Sender inn poeng. Avvises ved for kort spilletid, over `maks`, mer enn 30 per økt eller 60 per time. Bare forbedringer lagres i `rekorder`; alt havner i `poenglogg` med spilletid og IP-hash. |
| `GET /api/tavle/<slug>?antall=N`, `GET /api/tavle` | Topplista for ett spill (med egen plassering når innlogget), eller topp 3 for alle. |

Juks: verdien kommer fra spillerens egen nettleser, så en som leser koden kan sende inn et oppdiktet tall innenfor `maks` etter å ha ventet ut `minSek`. Det kan ikke hindres uten å endre spillene. Derfor logges alt, og mistenkelige rader kan fjernes for hånd:

```bash
wrangler d1 execute spillside-leaderboard --remote --command "SELECT b.navn, p.spill, p.poeng, p.spilletid, p.grunn, datetime(p.tid,'unixepoch') FROM poenglogg p JOIN brukere b ON b.id=p.bruker_id ORDER BY p.id DESC LIMIT 50"
```

```bash
wrangler d1 execute spillside-leaderboard --remote --command "DELETE FROM rekorder WHERE spill='bobbys-bugs' AND bruker_id=(SELECT id FROM brukere WHERE navn_lc='navn')"
```

```bash
wrangler d1 execute spillside-leaderboard --remote --command "UPDATE brukere SET utestengt=1 WHERE navn_lc='navn'"
```

Utestengte brukere vises ikke på tavlene og kan ikke logge inn. Første gang etter en fersk kloning eller før første deploy må skjemaet kjøres: `wrangler d1 migrations apply spillside-leaderboard --local` for `wrangler dev`, og `--remote` for produksjon.

**Lagring i nettleseren.** Første besøk viser et lite felt nederst som forklarer at favoritter, sist spilt og tema lagres i localStorage, og at innlogging setter en kapsel. Velger brukeren «Nei takk», holdes favoritter og historikk bare i minnet for økten (ny ekomlov § 3-15 regner localStorage på linje med informasjonskapsler).

## Kjør lokalt

```bash
python3 -m http.server 8080 -d public
```

Åpne <http://localhost:8080/>. Topplister og innlogging trenger Workeren og D1, så for det (og for å teste nøyaktig slik Cloudflare serverer det, inkludert sammensetting av delte filer) bruk `wrangler dev` og åpne <http://localhost:8787/>. Kjør `wrangler d1 migrations apply spillside-leaderboard --local` først.

## Hente spillfilene

Spillfilene og coverbildene er ikke sjekket inn i git (se `.gitignore`), siden de tilhører utviklerne. Etter en fersk kloning henter dette alt, inkludert coverne:

```bash
public/lokal/hent.sh
```

Fillistene ligger i `public/lokal/manifest/<mappe>.txt` (base-URL på første linje, én fil per linje, `kilde=>mål` for nytt navn lokalt). Scriptet laster ned filene fra itch.zone (ett spill om gangen med `hent.sh <mappe>`), fjerner `static.itch.io/htmlgame.js` (itch sitt hotlink-vern, som ellers viser «You should be using itch.io» utenfor itch.io) og eventuelle annonseskript fra `index.html`, og gjør noen spillspesifikke tilpasninger:

- **Legendum:** filnavn med mellomrom får understrek, og `index.html` patches tilsvarende.
- **Die in the Dungeon og Klifur:** de gz-komprimerte Unity-filene pakkes ut, siden verken Unity-lasterne eller serverne våre håndterer `Content-Encoding` for dem. Die in the Dungeon og Bobby's Beautiful Bugs får i tillegg korte filnavn (`ditd.*`, `bobby.*`) i stedet for navn med mellomrom, klammer og apostrof.
- **Idle Breakout, Generic Fighter Maybe, Get Yoked 2 og Hardware Tycoon:** filer som bare hentes ved kjøring (GameMaker sine innebygde partikkelbilder `html5game/particles/IDR_GIF1–15.png` og lydfiler, FMOD-lydbanker, Construct-media) ble funnet ved å se etter 404 i nettverksloggen og ligger i manifestene.
- Filer over 25 MiB får enten en brotli-komprimert kopi `.br` eller deles i biter `.part0`, `.part1`, … som lastes opp i stedet for originalen (se under). Brotli krever `brotli` (`brew install brotli`).

Bare coverbildene hentes med `public/lokal/hent.sh covers`. Adressen står i `coverSource` i games.json, og konverteringen krever `cwebp`, `gif2webp` og `ffmpeg` (`brew install webp ffmpeg`).

Hvis et spill lastes opp på nytt på itch, finn ny adresse ved å vise kildekoden til spillsiden og søke etter `html_embed`; iframe-en der peker på riktig `itch.zone`-adresse.

## Legge til et spill

Enklest er å lime inn itch.io-lenken til Claude Code i dette repoet. Prosjektskillen `legg-til-spill` (`.claude/skills/legg-til-spill/`) tar hele løypa: kartlegging, nedlasting, test i nettleser (inkludert om spillet blir kuttet i rammen), store filer, games.json, cover, hent.sh, README og deploy. Stegene for hånd:

1. Finn itch.zone-adressen til HTML5-builden (`html_embed`-blokken i kildekoden til itch-siden; noen sider har iframe-en direkte i stedet for `data-iframe`). Lag `public/lokal/manifest/<mappe>.txt` og en blokk i `public/lokal/hent.sh`. Se i `index.html`, JS og CSS etter flere referanser.
2. Kjør scriptet og last siden lokalt. Se etter 404 i nettverksfanen for filer spillet henter ved kjøring, også etter at et brett er startet.
3. Legg spillet til i `public/data/games.json` med samme felt som de andre (slug, tittel, `order` ett høyere enn det høyeste, skapere, itch-lenke, beskrivelse, motor, kategorier, bredde, sideforhold og `coverSource` fra `og:image` på itch-siden). De seks med høyest `order` vises som «Nylig lagt til». Kjør så `public/lokal/hent.sh covers` for coverbildet.
4. Er en fil over 25 MiB, legg originalen i `public/.assetsignore` og la `stor` i hent.sh lage `.br`-kopi eller biter.

## Hosting på Cloudflare

Cloudflare Worker med Static Assets (`wrangler.jsonc`). Alt i `public/` lastes opp som statiske filer, unntatt det som står i `public/.assetsignore`. Cloudflare tar ikke filer over 25 MiB. For slike filer lastes det i stedet opp enten en brotli-komprimert kopi `<fil>.br` (wasm- og pck-filer som komprimerer godt) eller biter `<fil>.part0`, `.part1`, … (allerede komprimerte filer som Unity-data, `.unityweb` og FMOD-banker). `src/worker.js` svarer på originalnavnet: `.br` sendes rett gjennom med `Content-Encoding: br`, biter pumpes sammen med `pipeTo` gjennom en `IdentityTransformStream`. Begge deler går utenom JavaScript per byte, som er avgjørende på gratisplanen (10 ms CPU per forespørsel): en vanlig `TransformStream` eller en pull-basert `ReadableStream` brukte 400–800 ms og ble kuttet av, mens `IdentityTransformStream` bruker 1–3 ms for 39 MB. Worker-en kjører bare for stier som ikke finnes som fil, og lokalt serveres originalene direkte.

```bash
wrangler deploy
```

Spillfilene tilhører utviklerne. Fjern et spill fra opplastingen ved å legge mappen i `public/.assetsignore` hvis det ikke skal ligge offentlig.

## Notater

- PolyTrack starter bare på itch.io og utviklerens egne sider. `main.bundle.js` sjekker adressen, og andre steder viser spillet bare et varsel om uoffisiell versjon og skjuler menyen. Sperren er ikke omgått, så spillet er merket `blocked` i games.json og vises som en låst skjerm med lenke til itch.io, akkurat som Idle Breakout.
- Idle Breakout har en sitelock (`html5game/vph_sitelock.js`) som bare tillater utviklerens godkjente domener og viser «HOST ERROR» ellers. Den er ikke omgått. Spillet er merket `blocked` i games.json, så biblioteket viser en låst skjerm med lenke til itch.io; den lokale kopien ligger der, men starter ikke.
- Get Yoked 2 er over 200 MB og bruker en stund på å laste. Unity-spillenes egne feilmeldinger i konsollen (f.eks. NullReferenceException i Pikwip) er spillenes egne.
- Zip-filen `How_to_Crab_to_Zero_postGMTK26.zip` er en Windows-build (GMTK26.exe + data.win) og kan ikke kjøres i nettleseren. Den er ikke brukt.
