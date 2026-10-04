---
name: legg-til-spill
description: Legger nye HTML5-spill fra itch.io inn i SpillSide-biblioteket som lokale kopier, med cover, credits, oppføring i games.json, hentescript, test i nettleser og deploy til Cloudflare. Bruk denne skillen hver gang brukeren limer inn én eller flere itch.io-lenker (<noe>.itch.io/<spill>), skriver ting som «legg inn denne», «legg til disse også», «kan du ta med dette spillet», «nytt spill i biblioteket», eller vil fjerne, oppdatere eller hente et spill på nytt i SpillSide – også når de ikke nevner skillen eller sier «spill» eksplisitt.
---

# Legg til spill i SpillSide

SpillSide er et statisk spillbibliotek (`public/`) som spiller **lokale kopier** av HTML5-spill fra itch.io og kjører på Cloudflare Workers (<https://spillside.tlbonnerud.workers.dev/>). Et spill er ferdig lagt inn når det:

1. ligger nedlastet i `public/lokal/<slug>/` og kan hentes på nytt med `public/lokal/hent.sh <slug>` (manifest + blokk i hent.sh),
2. har en oppføring i `public/data/games.json` og et cover i `public/covers/<slug>.webp`,
3. faktisk kan spilles (eller er ærlig merket som blokkert), testet i nettleser,
4. står i tabellene i `README.md` og `public/lokal/README.md`,
5. er deployet og sjekket på den publiserte siden.

## Grunnregler, og hvorfor

- **Bare lokale kopier, aldri itch-embed.** Brukeren valgte bort embed. itch.io skal bare finnes som lenker i credits og på låste skjermer.
- **Ikke omgå sperrer.** Noen spill har sitelock eller sjekker adressen (Idle Breakout viser «HOST ERROR», PolyTrack viser «unofficial version» og skjuler menyen). Det er utviklerens eget vern. Merk spillet med `blocked` i games.json i stedet, så biblioteket viser en låst skjerm med «Spill på itch.io». Å fjerne `static.itch.io/htmlgame.js` (itch sitt hotlink-skript) og annonseskript er derimot greit og gjøres alltid, fordi det bare er itch sin innpakning.
- **Bevis før du påstår.** Et spill «virker» først når du har sett det på et skjermbilde og, der det er mulig, startet det med et klikk på noe som er *synlig*. En knapp som finnes i DOM kan være skjult; å kalle `.click()` på den via JavaScript beviser ingenting (det var slik PolyTrack feilaktig ble meldt som spillbart).
- **Spillfilene tilhører utviklerne.** `public/lokal/*` og `public/covers/` er i `.gitignore`; bare manifestet, hent.sh og README sjekkes inn. Ikke commit med mindre brukeren ber om det.
- **Siden er i drift.** Brukeren forventer at nye spill ligger ute når du er ferdig, så avslutt med deploy og en sjekk av den publiserte siden.

## Arbeidsflyt

Skriptene ligger i `.claude/skills/legg-til-spill/scripts/` (under kalt `$SK`). Kjør alt fra repo-roten. Flere lenker kan kartlegges samlet og hentes etter hverandre.

### 1. Kartlegg

```bash
python3 $SK/kartlegg.py <itch-url> [<itch-url> ...] > /tmp/kart.jsonl
```

Én JSON-linje per spill: `title`, `authors` (navn + profil-URL), `genres`, `madeWith`, `inputs`, `playerCount`, `description`, `coverSource`, `itchSize` (bredde/høyde itch viser spillet i), `base` (mappen til HTML5-builden), `engineHints`, `externalScripts` og `sitelockHints`. `index.html` til builden lagres så du kan lese den.

- Har linjen `feil` med «fant ingen HTML5-build», er spillet bare til nedlasting og kan ikke legges inn. Si det til brukeren og gå videre med resten.
- Slug er siste del av itch-adressen. Sjekk at den ikke allerede finnes i games.json; finnes den, er oppgaven å oppdatere, ikke legge til.
- Har utvikleren byttet brukernavn, videresender itch den gamle lenken. Skriptet følger videresendingen og legger den nye adressen i `itch` (og den gamle i `videresendtFra`). Bruk den nye i games.json, og nevn det kort for brukeren.
- Brukeren limer av og til inn lenker med ekstra tegn (f.eks. `bobbys-bugs@`); skriptet rydder bort det vanligste, men se over slug.

### 2. Hent

```bash
python3 $SK/hent_spill.py <slug> <base>
```

Crawler builden inn i `public/lokal/<slug>/`, følger referanser i HTML/JS/CSS/JSON (inkludert Unity-, Godot- og GameMaker-mønstre), fjerner itch sitt hotlink-skript og annonseskript, og skriver `public/lokal/manifest/<slug>.txt` (base-URL på første linje). Rapporten viser hva som mangler, filer over 25 MiB, gz-filer og filnavn med spesialtegn.

Les rapporten og **les [references/motorer.md](references/motorer.md) for motoren spillet bruker** før du går videre. Der står det hvilke filer som bare hentes ved kjøring og hvilke tilpasninger som trengs (f.eks. Unity-filer som må pakkes ut, GameMaker-partikler, FMOD-lydbanker, filnavn med apostrof).

«Mangler» i rapporten er ofte ufarlig (strenger i JS som ser ut som filnavn). Det som teller, er hva spillet faktisk ber om når det kjører, se steg 3.

### 3. Test i nettleser og hent det som mangler

Start en lokal server hvis ingen kjører (`lsof -iTCP:8080 -sTCP:LISTEN`):

```bash
python3 -m http.server 8080 --bind 127.0.0.1 -d public
```

Kjør den med Bash-verktøyets `run_in_background: true` (eller `nohup … >/dev/null 2>&1 &`). En server som bare startes med `&` holder verktøykallet åpent til det går ut på tid, og da står du og venter på ingenting.

Oppsett av Playwright første gang: se toppen av `$SK/sjekk_spill.mjs` (installeres i `/tmp/spillside-pw`; Chromium ligger som regel allerede i cachen). Kjør:

```bash
PW_DIR=/tmp/spillside-pw node $SK/sjekk_spill.mjs <slug> --vent 25
```

- `direkte.mangler` er filer under spillmappen som svarte 404 mens spillet kjørte. Hent dem med `python3 $SK/hent_spill.py <slug> <base> --extra <fil> <fil> ...` (legges til i manifestet) og kjør sjekken igjen til listen er tom eller bare inneholder lagringsfiler spillet lager selv (f.eks. `save.dat`, `GFMsettings`). Noen spill ber om nye filer først når man starter et brett eller åpner en meny; da må du klikke deg inn (se under).
- **Se på begge skjermbildene med Read.** Tittelskjerm eller meny = bra. Svart skjerm, feilmelding, «HOST ERROR», «unofficial version», «You should be using itch.io» eller en meny som mangler = undersøk. `sperreTekst` fanger sperrer som står i DOM, men tekst som tegnes i canvas (som «HOST ERROR») ser du bare på skjermbildet.
- Prøv å starte spillet der det er mulig: finn en synlig Start/Play-knapp på skjermbildet og klikk på koordinatene med `page.mouse.click`, vent og ta nytt skjermbilde. Kjør 404-sjekken igjen etterpå.
- **Får spillet plass i rammen?** `bibliotek.kuttet` måler om spillet går utenfor iframen i biblioteket (1280x800). Spill med fast størrelse blir ofte kuttet: PICO-8-eksporter (580 px), eldre HTML5-spill med fast lerret (f.eks. 960x540) og stående spill med fast bredde. Alle de tre første testspillene for skillen trengte dette. Er `utenforHoyre` eller `utenforNede` over 0, skaler spillet med det felles skriptet og legg samme linje i hent.sh-blokken:
  ```bash
  cd public/lokal && python3 skaler.py <slug>/index.html '<css-selektor>' [--pixel] [--bare-ned] [--storrelse BxH]
  ```
  Selektoren er elementet som holder hele spillet med fast størrelse (se i index.html: typisk `#stage`, `#game_container`, `#gameContainer`, `canvas`, eller `body > div` for PICO-8). `--pixel` gir skarpe piksler, `--bare-ned` hindrer oppskalering (fint for tekst- og DOM-baserte spill). Tar beholderen størrelse fra vinduet (prosent-høyde, slik DOM-baserte mobilspill ofte gjør), blir den målt for lav i en lav ramme og bunnen legger seg over innholdet; lås den da til størrelsen itch viser spillet i med `--storrelse 360x640` (`itchSize` fra kartleggingen). Kjør sjekken igjen (skal gi 0), se på skjermbildet, og test at klikk og tastatur fortsatt treffer. Passer ikke det generelle skriptet, skriv en liten spilltilpasset CSS/JS-blokk i stedet, med en markør så den kan kjøres flere ganger.
- `eksterneVerter` viser om spillet henter ting fra nettet (CDN-er, topplister). Det er greit, men nevn det i `notes`.
- Enkelte spill krasjer headless Chromium (Generic Fighter Maybe gjorde det). Da tester du i nettleserpanelet i stedet (`mcp__Claude_Browser__*`, eller Claude in Chrome), der de virker.
- Er spillet sperret, skal det ikke omgås: bruk `--blokkert` i steg 5 med en kort forklaring på norsk.

### 4. Store filer

Cloudflare tar ikke filer over 25 MiB. Hvis rapporten eller `find public/lokal/<slug> -size +25M` viser slike:

```bash
python3 $SK/store_filer.py <slug>
```

Det lager `<fil>.br` (brotli, for filer som komprimerer godt) eller `<fil>.part0…` (for allerede komprimerte filer som Unity-data, `.unityweb` og FMOD-banker), og legger originalen i `public/.assetsignore`. `src/worker.js` serverer begge deler under originalnavnet; ikke endre den. (Den bruker `encodeBody: 'manual'` for .br og `IdentityTransformStream` for biter fordi gratisplanen bare gir 10 ms CPU per forespørsel; vanlige JS-strømmer ble kuttet av.) Skriptet skriver ut en `stor …`-linje til hent.sh.

### 5. Legg spillet i games.json og hent coveret

Skriv beskrivelsen selv: én naturlig setning på norsk bokmål om hva spillet går ut på (itch sin engelske tekst er utgangspunkt, ikke fasit). Unngå særskriving og direkte oversatte vendinger. Velg 1–2 kategorier fra `categories` i games.json (itch-sjanger → kategori: Puzzle→puslespill, Action/Platformer/Fighting→action, Racing→racing, Sports→sport, Card Game→kortspill, Role Playing→rollespill, Strategy→strategi, Simulation→simulering; arkade og idle ut fra taggene). Legg bare til en ny kategori i `categories` hvis ingen passer (f.eks. «Fortelling» for historiefortellende spill). En ny kategori trenger også et ikon i `public/app.js`: legg id-en i `CAT_ICON` og, hvis ingen av de eksisterende ikonene i `ICONS` passer, et nytt inline-SVG-ikon i samme stil (24x24, strek). Uten det viser menyen et generisk rutenett-ikon.

```bash
grep '"slug": "<slug>"' /tmp/kart.jsonl > /tmp/kart-<slug>.json
python3 $SK/legg_til_i_games_json.py --kart /tmp/kart-<slug>.json \
  --beskrivelse "..." --kategorier puslespill,arkade --motor "Unity" \
  --notater "Unity WebGL-build. ..." [--pixel] [--advarsel "..."] [--blokkert "..."] [--bredde 1280 --forhold "16 / 9"]
public/lokal/hent.sh covers <slug>
```

- `--motor`: det spillet faktisk er laget med (Unity, Godot 4, GameMaker, Construct 2, LÖVE (love.js), PixiJS, Three.js …), ikke verktøy som Photoshop fra «Made with».
- `--notater`: korte tekniske notater på norsk (filer som er pakket ut eller omdøpt, store filer som er delt eller brotli-komprimert, eksterne avhengigheter). De vises i credits-fanen.
- `--advarsel`: bare når brukeren bør vite noe før de starter, f.eks. «Stor nedlasting på rundt 250 MB, så første oppstart tar litt tid.», eller en innholdsadvarsel når spillet selv advarer om vold eller tunge temaer.
- `--pixel`: bare når coveret er lite pikselkunst som blir forstørret (under ca. 300 px bredt).
- Sjekk at sideforholdet stemmer med spillets canvas. Stemmer ikke itch sin størrelse, overstyr med `--bredde` og `--forhold`.
- `hent.sh covers <slug>` laster ned `coverSource`, konverterer til WebP (maks 630 px bredt, animert GIF → animert WebP) og oppdaterer `coverSize`. Krever `cwebp`, `gif2webp` og `ffmpeg`.

### 6. Legg spillet i hent.sh

Legg en blokk rett før `echo "ferdig"` nederst i `public/lokal/hent.sh`, så spillet kan hentes på nytt etter en fersk kloning:

```sh
if vil <slug>; then
  hent_manifest <slug>; rens <slug>/index.html
  # bare hvis spillet trenger det (se references/motorer.md og steg 3):
  # python3 skaler.py <slug>/index.html '<selektor>' [--pixel] [--bare-ned] [--storrelse BxH]   spill med fast størrelse
  # unity_pakk_ut <slug>                       Unity-filer med .gz som må pakkes ut
  # python3 - <slug>/index.html <<'EOF' ...    omdøping av filnavn, samme som du gjorde for hånd
  # stor <slug>/<fil> ...                      linjen fra store_filer.py
fi
```

Test at blokken virker: `sh -n public/lokal/hent.sh`, og helst `public/lokal/hent.sh <slug>` i en kopi av mappen hvis du gjorde spesialtilpasninger.

### 7. README

Legg en rad i spilltabellen i `README.md` (Spill | Av | Motor | Mappe | itch.io) og i tabellen i `public/lokal/README.md` (Mappe | Spill | Hentet). Nevn spesielle forhold under «Notater» i README (sperrer, filer som hentes ved kjøring, eksterne avhengigheter).

### 8. Sjekk i biblioteket

Åpne `http://127.0.0.1:8080/#/spill/<slug>` (sjekk_spill.mjs gjør det i steg 3, men kjør den igjen nå som oppføringen finnes). Kortet skal vises på forsiden med cover, spillvisningen skal ha én iframe som får plass i vinduet, og Credits-fanen skal vise riktige skapere og itch-lenken. For blokkerte spill: låst skjerm uten iframe.

### 9. Deploy og sjekk live

```bash
wrangler deploy
```

Får du «Asset too large», har du glemt steg 4. Etterpå:

```bash
PW_DIR=/tmp/spillside-pw node $SK/sjekk_spill.mjs <slug> --url https://spillside.tlbonnerud.workers.dev --vent 30
```

Se på skjermbildene. Store filer går via workeren; en `curl -sI <url-til-original>` skal gi `x-spillside: br` eller `parts=N`.

## Rapport til brukeren

Svar på norsk, kort. Led med utfallet: hvilke spill som er lagt inn og ligger ute, og hvilke som ikke kunne legges inn og hvorfor (bare nedlasting, sperre). Nevn det brukeren merker (stor nedlasting, spill som bare kan spilles på itch.io, ting som ikke virker utenfor itch som topplister). Tekniske detaljer bare der de betyr noe. Ingenting committes med mindre brukeren ber om det.

## Fjerne eller hente et spill på nytt

- **Hente på nytt** (f.eks. ny versjon på itch): kjør steg 1 for å få ny `base`, oppdater første linje i manifestet, kjør `hent_spill.py` på nytt, test, deploy.
- **Fjerne:** slett oppføringen i games.json, blokken i hent.sh, manifestet, raden i begge README-tabellene, eventuelle linjer i `public/.assetsignore`, og mappene `public/lokal/<slug>/` og `public/covers/<slug>.webp` (spør først, sletting kan ikke angres), og deploy.
