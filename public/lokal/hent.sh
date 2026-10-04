#!/bin/sh
# Henter lokale kopier av HTML5-builds fra itch.zone inn i denne mappen, én undermappe per spill.
# itch.zone-adressene er hentet fra kildekoden til itch-sidene (html_embed-iframen), 24. sep 2026.
# Bruk:  ./hent.sh               (alle spill og coverbilder)
#        ./hent.sh polytrack     (ett spill; mappenavnet)
#        ./hent.sh covers        (bare coverbildene til biblioteket)
#        ./hent.sh covers <slug> (coveret til ett spill)
#
# Fillistene ligger i manifest/<mappe>.txt: base-URL på første linje, deretter én fil per linje.
# En linje kan skrives "kilde=>mål" for å gi filen nytt navn lokalt.
set -eu
cd "$(dirname "$0")"

url_enc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1"; }

# hent_fil <mappe> <base-url> <kilde> [mål]
hent_fil() {
  dir="$1"; base="$2"; src="$3"; dst="${4:-$3}"
  mkdir -p "$dir/$(dirname "$dst")"
  # .gz/.br må hentes med Accept-Encoding, ellers pakker CDN-en dem ut på veien.
  case "$src" in
    *.gz|*.br) curl -fsSL -H 'Accept-Encoding: gzip, br' --raw "$base/$(url_enc "$src")" -o "$dir/$dst" ;;
    *)         curl -fsSL "$base/$(url_enc "$src")" -o "$dir/$dst" ;;
  esac
}

# hent_manifest <mappe>   Henter alt som står i manifest/<mappe>.txt.
hent_manifest() {
  dir="$1"; liste="manifest/$1.txt"; base=$(head -n 1 "$liste")
  echo "$dir: $(( $(wc -l < "$liste") - 1 )) filer fra $base"
  tail -n +2 "$liste" | while IFS= read -r linje; do
    [ -n "$linje" ] || continue
    src="${linje%%=>*}"; dst="${linje#*=>}"
    hent_fil "$dir" "$base" "$src" "$dst" || echo "  FEIL: $src"
  done
}

# rens <index.html>   Fjerner itch sitt hotlink-vern (viser «You should be using itch.io» utenfor itch) og evt. annonseskript.
rens() {
  python3 - "$1" <<'EOF'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text()
s = re.sub(r'\s*<script[^>]*src="https://static\.itch\.io/htmlgame\.js"[^>]*>\s*</script>',
           '\n<!-- static.itch.io/htmlgame.js fjernet: itch sitt hotlink-vern, trengs ikke lokalt -->', s)
s = re.sub(r'<script[^>]*src="https://pagead2\.googlesyndication\.com/pagead/js/adsbygoogle\.js"[^>]*>\s*</script>',
           '<!-- adsbygoogle.js fjernet lokalt -->', s)
p.write_text(s)
EOF
}

# unity_pakk_ut <mappe>   Pakker ut gz-komprimerte Unity-filer i Build/ og retter index.html.
#                         Verken alle Unity-lastere eller serverne våre håndterer Content-Encoding for dem.
unity_pakk_ut() {
  for f in "$1"/Build/*.gz; do
    [ -e "$f" ] || continue
    if gzip -t "$f" 2>/dev/null; then gunzip -f "$f"; else mv "$f" "${f%.gz}"; fi
  done
  python3 - "$1/index.html" <<'EOF'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text()
s = re.sub(r'((?:dataUrl|frameworkUrl|codeUrl|memoryUrl|symbolsUrl)\s*:\s*"[^"]+)\.gz"', r'\1"', s)
p.write_text(s)
EOF
}

# stor <fil>...  Cloudflare tar ikke statiske filer over 25 MiB. Originalen holdes utenfor opplastingen
#                (public/.assetsignore, husk å legge den til der). Filer som komprimerer godt får en
#                brotli-kopi <fil>.br som src/worker.js sender rett gjennom med Content-Encoding: br
#                (krever brotli: brew install brotli). Ellers deles originalen i <fil>.part0, .part1, ...
#                (20 MiB) som workeren setter sammen igjen. Lokalt serveres originalen direkte.
stor() {
  python3 - "$@" <<'EOF'
import pathlib, shutil, subprocess, sys
PART, LIMIT = 20 * 1024 * 1024, 25 * 1024 * 1024
KOMPRIMERT = ('.unityweb', '.bank', '.gz', '.br', '.zip', '.ogg', '.mp3', '.png', '.jpg', '.webp', '.mp4', '.webm')
brotli = shutil.which("brotli")
for name in sys.argv[1:]:
    p = pathlib.Path(name)
    for old in list(p.parent.glob(p.name + '.part*')) + list(p.parent.glob(p.name + '.br')): old.unlink()
    if p.stat().st_size <= LIMIT:
        print(f"  {p}: under 25 MiB, ingen tiltak"); continue
    if brotli and not p.name.lower().endswith(KOMPRIMERT):
        br = p.with_name(p.name + '.br')
        subprocess.run([brotli, "-q", "11", "-f", "-o", str(br), str(p)], check=True)
        if br.stat().st_size <= LIMIT:
            print(f"  {br}: {br.stat().st_size} bytes (brotli, under 25 MiB)"); continue
        print(f"  {br}: fortsatt over 25 MiB, deler i biter i stedet"); br.unlink()
    with p.open('rb') as f:
        i = 0
        while True:
            chunk = f.read(PART)
            if not chunk: break
            p.with_name(f"{p.name}.part{i}").write_bytes(chunk); i += 1
    print(f"  {p}: delt i {i} biter")
EOF
}

# covers [slug]   Henter coverbildene fra itch.io (coverSource i ../data/games.json) til ../covers/<slug>.webp.
#                 Store bilder skaleres ned til 630 px bredde (små skaleres aldri opp), animerte GIF-er blir animert WebP.
#                 Krever cwebp, gif2webp og ffmpeg (brew install webp ffmpeg).
covers() {
  python3 - "${1:-}" <<'EOF'
import json, os, subprocess, sys, tempfile, urllib.request
only = sys.argv[1]
data = json.load(open("../data/games.json"))
os.makedirs("../covers", exist_ok=True)
for g in data["games"]:
    if only and g["slug"] != only: continue
    src = g["coverSource"]; ext = src.rsplit(".", 1)[-1].lower(); dst = os.path.join("..", g["cover"])
    with tempfile.TemporaryDirectory() as t:
        raw = os.path.join(t, "raw." + ext)
        with urllib.request.urlopen(urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r:
            open(raw, "wb").write(r.read())
        if ext == "gif":
            small = os.path.join(t, "small.gif")
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", raw, "-filter_complex",
                            "scale='min(630,iw)':-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none", small], check=True)
            # Tapsfri vinner som regel (pikselkunst og flate farger), men lag begge og behold den minste.
            # -m 6 er 30-60 ganger tregere enn -m 4 for under 1 % mindre fil, så den brukes ikke.
            a, b = os.path.join(t, "a.webp"), os.path.join(t, "b.webp")
            subprocess.run(["gif2webp", "-quiet", "-m", "4", small, "-o", a], check=True)
            subprocess.run(["gif2webp", "-quiet", "-lossy", "-q", "80", "-m", "4", small, "-o", b], check=True)
            os.replace(a if os.path.getsize(a) <= os.path.getsize(b) else b, dst)
        else:
            w = int(subprocess.run(["sips", "-g", "pixelWidth", raw], capture_output=True, text=True).stdout.split()[-1])
            args = ["-q", "86", "-resize", "630", "0"] if w > 630 else ["-lossless", "-z", "9"]
            subprocess.run(["cwebp", "-quiet", *args, raw, "-o", dst], check=True)
    # Hold coverSize i games.json i takt med den konverterte filen (siden bruker den til sideforhold).
    wh = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                         "-of", "csv=p=0", dst], capture_output=True, text=True).stdout.strip().splitlines()
    if wh and "," in wh[0]:
        g["coverSize"] = [int(x) for x in wh[0].split(",")[:2]]
    print(f"  cover: {dst} {g.get('coverSize')}")
with open("../data/games.json", "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False); f.write("\n")
EOF
}

valgt="${1:-alle}"
vil() { [ "$valgt" = alle ] || [ "$valgt" = "$1" ]; }

# Coverbildene til biblioteket hentes når alt hentes, eller med ./hent.sh covers [slug]
if [ "$valgt" = alle ] || [ "$valgt" = covers ]; then
  echo "Coverbilder"; covers "${2:-}"
fi

# ---------- Spill med manifest og eventuelle spesialsteg ----------

if vil how-to-crab-to-zero; then
  hent_manifest how-to-crab-to-zero; rens how-to-crab-to-zero/index.html
fi

if vil multi-modal; then
  hent_manifest multi-modal; rens multi-modal/index.html
fi

if vil legendum; then
  hent_manifest legendum   # Godot 4; filnavn med mellomrom får understrek via "=>" i manifestet
  python3 - legendum/index.html <<'EOF'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); p.write_text(p.read_text().replace('"Incremental Fantasy', '"Incremental_Fantasy'))
EOF
  rens legendum/index.html
  stor legendum/Incremental_Fantasy.wasm legendum/Incremental_Fantasy.pck
fi

if vil rock-declutterer; then
  hent_manifest rock-declutterer; rens rock-declutterer/index.html
fi

if vil polytrack; then
  hent_manifest polytrack; rens polytrack/index.html
fi

if vil die-in-the-dungeon; then
  hent_manifest die-in-the-dungeon   # Unity; filnavn forkortes til ditd.* via "=>"
  python3 - die-in-the-dungeon/index.html <<'EOF'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); p.write_text(p.read_text().replace('Build/Die in the Dungeon 1.6.2f [WEB].', 'Build/ditd.'))
EOF
  unity_pakk_ut die-in-the-dungeon; rens die-in-the-dungeon/index.html
  stor die-in-the-dungeon/Build/ditd.data
fi

if vil idle-breakout; then
  hent_manifest idle-breakout; rens idle-breakout/index.html
fi

if vil generic-fighter-maybe; then
  hent_manifest generic-fighter-maybe; rens generic-fighter-maybe/index.html
fi

if vil pikwip; then
  hent_manifest pikwip; rens pikwip/index.html
fi

if vil wildfire; then
  hent_manifest wildfire; rens wildfire/index.html
  stor wildfire/Build/WEBGL_UPDATED.wasm.unityweb
fi

if vil bobbys-bugs; then
  hent_manifest bobbys-bugs   # Unity; filnavn forkortes til bobby.* via "=>"
  python3 - bobbys-bugs/index.html <<'EOF'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); p.write_text(p.read_text().replace("Bobby's Beautiful Bugs.", "bobby."))
EOF
  rens bobbys-bugs/index.html
fi

if vil get-yoked-2; then
  hent_manifest get-yoked-2; rens get-yoked-2/index.html
  stor get-yoked-2/Build/Web.data get-yoked-2/Build/Web.wasm get-yoked-2/StreamingAssets/Master.bank
fi

if vil hardware-tycoon; then
  hent_manifest hardware-tycoon; rens hardware-tycoon/index.html
fi

if vil klifur; then
  hent_manifest klifur; unity_pakk_ut klifur; rens klifur/index.html
  stor klifur/Build/Web.wasm
fi

if vil tanuki-sunset; then
  hent_manifest tanuki-sunset; rens tanuki-sunset/index.html
  stor tanuki-sunset/Build/WebGL.data.unityweb
fi

if vil dynamine; then
  hent_manifest dynamine; rens dynamine/index.html
  stor dynamine/index.wasm dynamine/index.pck
fi

if vil soccer-physics; then
  hent_manifest soccer-physics; rens soccer-physics/index.html
fi

if vil the-machinegg; then
  hent_manifest the-machinegg; rens the-machinegg/index.html
fi

if vil infinidle; then
  hent_manifest infinidle; rens infinidle/index.html
fi

echo "ferdig"
