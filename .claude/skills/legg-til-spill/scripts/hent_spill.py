#!/usr/bin/env python3
"""Henter en HTML5-build fra itch.zone inn i public/lokal/<slug>/ og skriver manifestet.

Bruk:
  python3 hent_spill.py <slug> <base-url> [--repo <sti>] [--extra fil1 fil2 ...] [--ingen-rens]

  <base-url>  mappen index.html ligger i, f.eks. https://html-classic.itch.zone/html/19376561
              (feltet "base" fra kartlegg.py; spesialtegn kan stå ukodet eller kodet)
  --extra     ekstra filer (relativt til spillmappen) som bare hentes ved kjøring, f.eks. fra
              404-listen til sjekk_spill.mjs. De legges til i manifestet.
  --ingen-rens  ikke fjern itch sitt hotlink-skript og annonseskript fra index.html

Skriptet følger referanser i HTML, JS, CSS og JSON (også Unity-, Godot- og GameMaker-spesifikke
mønstre), prøver stier både relativt til filen og relativt til spillets rot (skript refererer ofte til
ressurser relativt til siden, ikke til seg selv), og skriver public/lokal/manifest/<slug>.txt med
base-URL på første linje. Til slutt skrives en rapport som JSON: filer, størrelse, hva som mangler,
filer over 25 MiB og gz-filer.
"""
import json, os, posixpath, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

LIMIT = 25 * 1024 * 1024
EXT = r"(js|mjs|wasm|data|pck|json|png|jpe?g|gif|webp|svg|ogg|mp3|wav|m4a|webm|mp4|ttf|otf|woff2?|ico|txt|csv|xml|glb|gltf|bin|unityweb|gz|br|css|html|mem|pak|zip|love|p8|tmx|tsx|atlas|fnt|frag|vert|glsl|track|bank|unx|dat|mp4)"
TEXT = re.compile(r"\.(html?|m?js|css|json|txt|xml|csv)$", re.I)
OPTIONAL = (".worker.js", ".side.wasm", ".service.worker.js", ".offline.html", ".manifest.json", ".symbols.json",
            "favicon.ico", "cordova.js")


def find_repo(start):
    try:
        return subprocess.run(["git", "-C", start, "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return start


def enc(path):
    return urllib.parse.quote(urllib.parse.unquote(path), safe="/")


def fetch(base, path):
    h = {"User-Agent": "Mozilla/5.0 (SpillSide)"}
    # .gz/.br må hentes med Accept-Encoding, ellers kan CDN-en pakke dem ut på veien.
    if re.search(r"\.(gz|br)$", path): h["Accept-Encoding"] = "gzip, br"
    # 60 s er per socket-operasjon, så store filer som faktisk strømmer går fint; en forespørsel
    # itch.zone aldri svarer på gir opp etter ~3 minutter i stedet for en halvtime.
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(f"{base}/{enc(path)}", headers=h), timeout=60) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and i < 2: time.sleep(6 * (i + 1)); continue
            return e.code, b""
        except Exception as e:
            if i < 2: time.sleep(2); continue
            return str(e)[:60], b""


def norm(ref, fromdir):
    ref = urllib.parse.unquote(ref.split("?")[0].split("#")[0].strip())
    if not ref or ref.startswith(("http:", "https:", "data:", "//", "blob:", "javascript:", "mailto:")) or "${" in ref or "+" in ref:
        return None
    if ref.startswith("/"): ref = ref[1:]
    p = posixpath.normpath(posixpath.join(fromdir, ref)) if fromdir else posixpath.normpath(ref)
    return None if p.startswith("..") or p in (".", "") else p


def refs_in(text):
    out = set(re.findall(r'(?:src|href)=["\']([^"\']+)["\']', text))
    out |= set(re.findall(r'url\(["\']?([^"\')]+)["\']?\)', text))
    out |= set(m.group(1) for m in re.finditer(r'["\'`]([A-Za-z0-9_./ \[\]()@%-]{1,160}\.' + EXT + r')["\'`]', text))
    return out


def main():
    args = sys.argv[1:]
    if len(args) < 2: print(__doc__); sys.exit(1)
    slug, base = args[0], args[1].rstrip("/")
    base = urllib.parse.urlunsplit(urllib.parse.urlsplit(base)._replace(path=enc(urllib.parse.urlsplit(base).path)))
    repo = find_repo(os.getcwd())
    extra, rens = [], True
    i = 2
    while i < len(args):
        if args[i] == "--repo": repo = args[i + 1]; i += 2
        elif args[i] == "--ingen-rens": rens = False; i += 1
        elif args[i] == "--extra":
            i += 1
            while i < len(args) and not args[i].startswith("--"): extra.append(args[i]); i += 1
        else: i += 1
    out = os.path.join(repo, "public", "lokal", slug)
    man_path = os.path.join(repo, "public", "lokal", "manifest", slug + ".txt")
    os.makedirs(out, exist_ok=True); os.makedirs(os.path.dirname(man_path), exist_ok=True)

    have, failed, queue, alts = {}, {}, [], {}

    def add(path, group=None):
        if path and path not in have and path not in failed and path not in queue:
            queue.append(path)
            if group: alts.setdefault(path, group)

    # Med --extra hentes bare de nye filene (tidligere manifest beholdes).
    if extra:
        for e in extra: add(norm(e, ""))
    else:
        add("index.html")

    n = 0
    while queue and n < 5000:
        p = queue.pop(0); n += 1
        print(f"  henter {p} ({n}, {len(queue)} i kø)", file=sys.stderr, flush=True)
        st, body = fetch(base, p)
        if st != 200:
            failed[p] = st; continue
        dst = os.path.join(out, p); os.makedirs(os.path.dirname(dst) or out, exist_ok=True)
        open(dst, "wb").write(body); have[p] = len(body)
        if not TEXT.search(p) or len(body) > 40_000_000: continue
        text = body.decode("utf-8", "replace")
        fromdir = posixpath.dirname(p)
        # Unity-maler: var buildUrl = "Build"; ... buildUrl + "/navn"
        bu = re.search(r'buildUrl\s*=\s*["\']([^"\']+)["\']', text)
        if bu:
            for m in re.finditer(r'buildUrl\s*\+\s*["\']/([^"\']+)["\']', text): add(norm(bu.group(1) + "/" + m.group(1), fromdir))
        # Unity 2019: Build/<navn>.json med dataUrl, wasmCodeUrl osv.
        if p.endswith(".json") and "Url" in text:
            try:
                for k, v in json.loads(text).items():
                    if k.endswith("Url") and isinstance(v, str): add(norm(v, fromdir))
            except Exception: pass
        # Godot: "executable":"navn" -> standardfilene
        g = re.search(r'"executable"\s*:\s*"([^"]+)"', text)
        if g:
            for suf in (".js", ".wasm", ".pck", ".png", ".icon.png", ".apple-touch-icon.png", ".audio.worklet.js",
                        ".audio.position.worklet.js", ".worker.js", ".side.wasm", ".service.worker.js", ".offline.html", ".manifest.json"):
                add(norm(g.group(1) + suf, fromdir))
        # GameMaker (nyere): manifestFiles() lister filer som hentes ved kjøring
        mf = re.search(r'manifestFiles\(\)\s*\{\s*return\s*\[([^\]]*)\]', text)
        if mf:
            for m in re.finditer(r'"([^"]+)"', mf.group(1)): add(norm(m.group(1), fromdir))
        for r in refs_in(text):
            a = norm(r, fromdir)
            b = norm(r, "") if fromdir else None  # samme ref relativt til spillets rot
            grp = frozenset(x for x in (a, b) if x)
            add(a, grp)
            if b and b != a: add(b, grp)

    # Et funn er bare «manglende» hvis ingen av de alternative stiene for samme referanse ble hentet.
    missing = []
    for p, st in failed.items():
        grp = alts.get(p)
        if grp and any(x in have for x in grp): continue
        if p.endswith(OPTIONAL): continue
        missing.append({"status": st, "path": p})

    if rens and "index.html" in have:
        ip = os.path.join(out, "index.html"); s = open(ip, encoding="utf-8", errors="replace").read()
        s2 = re.sub(r'\s*<script[^>]*src="https://static\.itch\.io/htmlgame\.js"[^>]*>\s*</script>',
                    '\n<!-- static.itch.io/htmlgame.js fjernet: itch sitt hotlink-vern, trengs ikke lokalt -->', s)
        s2 = re.sub(r'<script[^>]*src="https://pagead2\.googlesyndication\.com/pagead/js/adsbygoogle\.js"[^>]*>\s*</script>',
                    '<!-- adsbygoogle.js fjernet lokalt -->', s2)
        if s2 != s: open(ip, "w", encoding="utf-8").write(s2)

    # Manifest: base-URL først, så alle filer. Med --extra slås nye filer sammen med det gamle manifestet.
    old = []
    if os.path.exists(man_path):
        lines = open(man_path).read().splitlines()
        old = [l for l in lines[1:] if l.strip()]
    files = sorted(set(old) | set(have))
    with open(man_path, "w") as f: f.write(base + "\n" + "\n".join(files) + "\n")

    report = {
        "slug": slug, "base": base, "dir": out, "manifest": man_path,
        "hentet": len(have), "bytes": sum(have.values()), "filerIManifest": len(files),
        "mangler": missing[:80], "manglerTotalt": len(missing),
        "over25MiB": [p for p, sz in have.items() if sz > LIMIT],
        "gz": [{"path": p, "ektegzip": open(os.path.join(out, p), "rb").read(2) == b"\x1f\x8b"} for p in have if p.endswith(".gz")],
        "spesialtegnIFilnavn": [p for p in have if re.search(r"[ '\[\]()]", p)],
    }
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
