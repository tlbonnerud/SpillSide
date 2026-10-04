# Fallgruver per spillmotor

Alt her er lært av spillene som allerede ligger i SpillSide. Finn motoren i `engineHints` fra kartlegg.py eller i index.html, og les bare den delen som gjelder.

## Innhold

- [Unity](#unity)
- [GameMaker](#gamemaker)
- [Godot](#godot)
- [Construct](#construct)
- [LÖVE (love.js)](#löve-lovejs)
- [PICO-8](#pico-8)
- [Egne JS-motorer (Vite, Three.js, PixiJS)](#egne-js-motorer-vite-threejs-pixijs)
- [Filnavn med spesialtegn](#filnavn-med-spesialtegn)
- [Sperrer](#sperrer)

## Unity

Tre varianter finnes:

- **`createUnityInstance` med `.gz`-filer** (`Build/X.data.gz`, `X.framework.js.gz`, `X.wasm.gz`). Serverne våre (Python lokalt, Cloudflare) setter ikke `Content-Encoding: gzip`, og mange Unity-lastere har ingen reserve i JavaScript. Da feiler spillet med «Unable to parse … framework.js.gz» eller «expected magic word 00 61 73 6d». Løsning: pakk ut alle tre og fjern `.gz` i konfigurasjonen i index.html. `hent.sh` har funksjonen `unity_pakk_ut <slug>` som gjør begge deler; bruk den i hent.sh-blokken. Sjekk etterpå om noen fil nå er over 25 MiB (steg 4). Brotli-varianten `.br` behandles på samme måte (`brotli -d`).
  Merk: `hent_spill.py` henter `.gz` med `Accept-Encoding: gzip`, så filene kommer ukomprimert fra CDN-en. Rapporten viser `ektegzip`; er den `false`, er filen allerede ukomprimert og skal bare omdøpes.
- **`.unityweb`-filer** (`X.data.unityweb` osv.). Disse pakker Unity-lasteren ut selv (den ser etter en Unity-markør), så de kan ligge som de er.
- **Unity 2019 med `UnityLoader.js`** og `Build/X.json` som peker på `dataUrl`, `wasmCodeUrl` og `wasmFrameworkUrl`. Crawleren følger JSON-filen. Virker som den er.

Ting som bare hentes ved kjøring:
- **`StreamingAssets/`**, særlig FMOD-lydbanker (`Master.bank`, `Master.strings.bank`). Get Yoked 2 ga «BankLoadException» til de var hentet. Bankene er ofte store og allerede komprimert, så de blir biter i steg 4.
- En `Build/build.wasm` i «mangler» er en falsk alarm (et navn i lasterkoden).

Konsollfeil som `NullReferenceException` eller FMOD «Event not found» i sekundene før lydbanken er lastet kommer fra spillet selv og er ikke noe å rette.

## GameMaker

- **Eldre eksport** (`html5game/<Navn>.js?cachebust=…`, «Created with GameMaker Studio 2»): teksturer (`<Navn>_texture_N.png`) finnes av crawleren, men **lyd og partikler hentes først ved kjøring**. GameMaker sine innebygde partikkelbilder heter `html5game/particles/IDR_GIF1.png` til `IDR_GIF15.png` og står ikke som vanlige strenger i koden. Lydfilene (`html5game/<lydnavn>.ogg` og `.mp3`) viser seg som 404 i sjekk_spill.mjs. Hent alle 15 partiklene og alle lydfilene med `--extra`, begge formater. Filer som `save.dat`, `GFMsettings` og `HitboxData` kan være lagringsfiler spillet prøver å lese; hent dem hvis de finnes på itch (200), ellers er 404 normalt.
- **Nyere eksport** (`GMTK26.js`, `game.unx`, `music.dat`, `sounds.dat`, `manifestFiles()` i index.html): crawleren leser `manifestFiles()`. MD5-summene i manifestet stemmer ikke med filene, fordi de regnes ut før et siste eksportsteg. Det er normalt.
- **Sitelock:** filer som `html5game/vph_sitelock.js` eller kode som leser `location.ancestorOrigins`/`document.referrer` betyr at spillet sjekker nettstedet. Idle Breakout viser da «HOST ERROR» (tegnet i canvas, så du ser det bare på skjermbildet). Merk med `blocked`.
- Generic Fighter Maybe krasjet headless Chromium, men virker i en ekte nettleser. Test i nettleserpanelet hvis sjekken sier «SIDEN KRASJET».

## Godot

- index.html har `GODOT_CONFIG` med `"executable":"<navn>"`. Crawleren henter `<navn>.js/.wasm/.pck/.png` og worklet-filene; `.worker.js`, `.side.wasm`, `.service.worker.js` osv. finnes bare i enkelte eksporter og kan mangle.
- **Mellomrom i navnet** (Legendum: `Incremental Fantasy.wasm`): omdøp til understrek og bytt `"Incremental Fantasy` til `"Incremental_Fantasy` i index.html. Skriv manifestlinjene som `Incremental Fantasy.wasm=>Incremental_Fantasy.wasm` så hent.sh gjør det samme, og legg omdøpingen i hent.sh-blokken.
- `.wasm` (ofte ~40 MB) komprimeres godt med brotli (til ~7 MB). `.pck` kan være for stor selv komprimert og blir da biter. Begge håndteres av `store_filer.py`.
- `GODOT_THREADS_ENABLED = true` krever cross-origin isolation (COOP/COEP-hoder), som vi ikke setter. Alle spillene hittil har hatt `false`. Møter du `true`, test nøye og nevn det for brukeren.

## Construct

- Construct 2 (`c2runtime.js`, `data.js`) og Construct 3 (`c3runtime.js`). Lydfilene står som `["navn.ogg", størrelse]` i `data.js` men ligger i `media/`. Crawleren finner dem ikke alltid automatisk: sammenlign med `media/`-filer som gir 404 i sjekken, og hent dem med `--extra media/<navn>.ogg`.
- Filer som `sw.js`, `offline.js` og `appmanifest.json` er for offline-bruk og kan ligge med.

## LÖVE (love.js)

- `love.js` + `love.wasm` + `game.js` + `game.data`. Crawleren finner alle. Sjekk om `love.js` inneholder `ENVIRONMENT_IS_PTHREAD` / trenger `SharedArrayBuffer`; Rock Declutterer brukte kompatibilitetsbuilden og virket uten ekstra hoder.

## PICO-8

- Eksporten er bare `index.html` og én stor JS-fil (f.eks. `celeste.js`) der spillet (cart) ligger innebygd. En `pico8.dat` eller lignende i «mangler» er en falsk alarm.
- Siden har fast størrelse (ca. 580 px bred med knapperad under), så den blir kuttet i biblioteket. Skaler med `python3 skaler.py <slug>/index.html 'body > div' --pixel` (se steg 3 i SKILL.md).
- Styres med tastatur (piltaster, X og C/Z). Sett `inputs` til Tastatur hvis itch ikke oppgir noe, og nevn tastene i beskrivelsen eller notatene.
- Coveret er ofte en liten animert GIF (256x256). `hent.sh covers` skalerer bare ned, så den beholder størrelsen; bruk `--pixel` i games.json.

## Egne JS-motorer (Vite, Three.js, PixiJS)

- **Stier bygges ofte ved kjøring**, så de står ikke som hele filnavn i koden. PolyTrack bygde `images/countries/"+kode+".svg"`, `tracks/official/<navn>.track` og `lib/draco/…`. Slike filer finner du bare med 404-listen fra sjekk_spill.mjs etter at spillet er startet og menyer er åpnet, eller ved å lese koden rundt strengen og gjette mønsteret (f.eks. alle tobokstavs landkoder, eller ett banenavn per miniatyrbilde). Store fillister går fint i manifestet (PolyTrack har 529 filer).
- **Stier i JS er relative til siden, ikke til skriptfilen.** The MachinEGG hadde `scenarios/farm/script.js` som refererte til `pixelart_design/…` fra rota. `hent_spill.py` prøver begge stier, men se etter dette mønsteret hvis mye mangler.
- Eksterne avhengigheter (PixiJS fra cdnjs, Google Fonts, egne topplister/servere) virker som regel, men nevn dem i `notes`. Online-funksjoner som topplister kan feile utenfor utviklerens domener; det er ikke noe vi retter.
- Eldre HTML5-spill med fast lerret (We Become What We Behold: PixiJS 4, 960x540) og DOM-baserte spill med fast bredde (Coming Out Simulator: 360 px) blir kuttet i rammen. Skaler dem som beskrevet i steg 3 i SKILL.md (`#stage` for det første; `#game_container --bare-ned --storrelse 360x640` for det andre, fordi beholderen der har prosent-høyde og ellers blir målt for lav).
- Vite-bygde apper (`assets/main-<hash>.js`, `modulepreload`) er enkle: hent `assets/` og eventuelle `wasm/`-filer som `fetch("./wasm/…")` peker på.

## Filnavn med spesialtegn

Mellomrom fungerer både lokalt og på Cloudflare (Idle Breakout har `html5game/Idle Breakout.js`). **Apostrof og klammer** kan gi trøbbel i URL-er og er lettest å unngå: Bobby's Beautiful Bugs ble til `Build/bobby.*` og Die in the Dungeon til `Build/ditd.*`. Gjør slik:

1. Gi filene korte navn lokalt og bytt navnene i index.html (eller loader-konfigurasjonen).
2. Skriv manifestet med `kilde=>mål`, f.eks. `Build/Bobby's Beautiful Bugs.loader.js=>Build/bobby.loader.js`. Base-URL-en på første linje må være prosentkodet (`Bobby%27s%20Beautiful%20Bugs`); `kartlegg.py` gjør det for deg.
3. Legg samme navnebytte i hent.sh-blokken (se blokkene for `bobbys-bugs` og `die-in-the-dungeon` som eksempel).

## Sperrer

Tegn på at spillet sjekker hvor det kjører: `sitelockHints` fra kartlegg.py, `sperreTekst` fra sjekk_spill.mjs, eller et skjermbilde med «HOST ERROR», «unofficial version», «Iframe is not allowed», «You should be using itch.io» (den siste er bare itch sitt hotlink-skript, som `rens` fjerner) eller en tittelskjerm der menyen mangler. Når utvikleren selv har lagt inn sperren: ikke omgå den. Legg spillet inn med `--blokkert "Kort forklaring på norsk. Vi omgår ikke denne sperren, så spill det heller på itch.io."`, og fortell brukeren det tydelig.
