#!/usr/bin/env python3
"""Kartlegger itch.io-spill før de legges inn i SpillSide.

Bruk:  python3 kartlegg.py <itch-url> [<itch-url> ...] [--ut <mappe>]

For hver side skrives én JSON-linje til stdout med alt vi trenger videre:
tittel, skapere (med profillenker), sjanger, motor, kontroller, spillere, beskrivelse,
coverSource (og:image), størrelsen itch viser spillet i, og adressen til HTML5-builden (base).
index.html til builden lagres i <ut>/<slug>/index.html så du kan lese den.

Finnes det ingen HTML5-build (spillet er bare til nedlasting), får linjen "feil".
"""
import html, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (SpillSide)"}


def get(url, tries=6, final=False):
    """Henter en URL. itch svarer 429 ved mange kall på rad, så vi venter og prøver igjen.
    Med final=True returneres også adressen etter eventuelle videresendinger."""
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return (r.status, r.read(), r.geturl()) if final else (r.status, r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429 and i < tries - 1:
                time.sleep(8 * (i + 1)); continue
            return (e.code, b"", url) if final else (e.code, b"")
        except Exception as e:  # nettverksfeil
            if i < tries - 1: time.sleep(3); continue
            return (str(e)[:80], b"", url) if final else (str(e)[:80], b"")
    return ("429", b"", url) if final else ("429", b"")


def quote_url(u):
    """Prosentkoder stien (mellomrom, apostrof, klammer) uten å dobbelkode det som allerede er kodet."""
    p = urllib.parse.urlsplit(u)
    path = urllib.parse.quote(urllib.parse.unquote(p.path), safe="/")
    return urllib.parse.urlunsplit((p.scheme, p.netloc, path, p.query, ""))


def meta(page, prop):
    # itch skriver <meta content="..." property="og:image"/>, altså content FØR property.
    for pat in (rf'<meta content="([^"]*)" property="{prop}"', rf'<meta property="{prop}" content="([^"]*)"',
                rf'<meta content="([^"]*)" name="{prop}"', rf'<meta name="{prop}" content="([^"]*)"'):
        m = re.search(pat, page)
        if m: return html.unescape(m.group(1))
    return None


def txt(s): return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


ENGINES = [
    ("Godot", r"GODOT_CONFIG|new Engine\("), ("Unity", r"createUnityInstance|UnityLoader|\.unityweb"),
    ("GameMaker", r"GameMaker|manifestFiles\(|html5game/"), ("LÖVE (love.js)", r"love\.js|Love\(Module"),
    ("Construct", r"c2runtime|c3runtime|construct"), ("PICO-8", r"pico8|_cartdat|pico-8"),
    ("Twine", r"tw-story|twine"), ("Defold", r"dmloader"), ("RPG Maker", r"rpg_core|rmmz_|rmmv"),
    ("Phaser", r"phaser"), ("PixiJS", r"pixi"), ("Three.js", r"three\.module|THREE\."), ("Bitsy", r"bitsy"),
    ("Ren'Py", r"renpy"), ("Emscripten", r"emscripten"), ("Vite/webpack", r"modulepreload|webpack"),
]


def kartlegg(url, ut):
    url = url.strip().rstrip("@/ ")
    st, body, final = get(url, final=True)
    # Utviklere bytter av og til brukernavn på itch; da videresendes den gamle lenken. Bruk den nye adressen.
    final = final.split("?")[0].rstrip("/")
    slug = final.split("/")[-1].lower()
    rep = {"slug": slug, "itch": final}
    if final != url.rstrip("/"): rep["videresendtFra"] = url
    if st != 200:
        rep["feil"] = f"itch-siden svarte {st}"; return rep
    page = body.decode("utf-8", "replace")
    title = re.search(r"<title>([^<]*)</title>", page)
    full = html.unescape(title.group(1)) if title else slug
    rep["pageTitle"] = full
    rep["title"] = re.sub(r"\s+by\s+.+$", "", full).strip()
    rep["description"] = meta(page, "og:description") or meta(page, "description") or ""
    rep["coverSource"] = meta(page, "og:image")

    info = {}
    for row in re.finditer(r"<tr><td>([^<]+)</td><td>(.*?)</td></tr>", page, re.S):
        links = [{"url": html.unescape(a.group(1)), "name": txt(a.group(2))}
                 for a in re.finditer(r'<a href="([^"]+)"[^>]*>(.*?)</a>', row.group(2), re.S)]
        info[row.group(1).strip()] = {"text": txt(row.group(2)), "links": links}
    a = info.get("Authors") or info.get("Author") or {}
    rep["authors"] = [l for l in a.get("links", []) if "itch.io" in l["url"]] or [{"name": a.get("text", ""), "url": ""}]
    for key, out in (("Genre", "genres"), ("Made with", "madeWith"), ("Inputs", "inputs"), ("Tags", "tags")):
        rep[out] = [s.strip() for s in info.get(key, {}).get("text", "").split(",") if s.strip()]
    rep["playerCount"] = info.get("Player count", {}).get("text", "")
    rep["multiplayer"] = info.get("Multiplayer", {}).get("text", "")
    rep["averageSession"] = info.get("Average session", {}).get("text", "")

    w = re.search(r'data-width="(\d+)"', page); h = re.search(r'data-height="(\d+)"', page)
    rep["itchSize"] = [int(w.group(1)), int(h.group(1))] if w and h else None

    # HTML5-builden: data-iframe i html_embed-blokken, eller en iframe direkte i siden.
    src = None
    for m in re.finditer(r'data-iframe="([^"]*)"', page):
        s = re.search(r'src="([^"]+)"', html.unescape(m.group(1)))
        if s: src = s.group(1); break
    if not src:
        m = re.search(r'(https://html(?:-classic)?\.itch\.zone/html/[^"\'&\s<>]+?/index\.html)', html.unescape(page))
        if m: src = m.group(1)
    if not src:
        rep["feil"] = "fant ingen HTML5-build (spillet er trolig bare til nedlasting)"
        rep["platforms"] = sorted(set(x.lower() for x in re.findall(r"\b(HTML5|Windows|macOS|Linux|Android)\b", page)))
        return rep
    src = html.unescape(html.unescape(src))  # itch dobbeltkoder noen ganger apostrof (&amp;#039;)
    base = src.split("?")[0].rsplit("/", 1)[0]
    rep["buildUrl"] = src
    rep["base"] = quote_url(base)
    uid = re.search(r"/html/(\d+)", src)
    rep["uploadId"] = uid.group(1) if uid else None

    st, ib = get(quote_url(src.split("?")[0]))
    if st != 200:
        rep["feil"] = f"index.html til builden svarte {st} ({rep['base']}/index.html)"; return rep
    index = ib.decode("utf-8", "replace")
    rep["indexTitle"] = txt(re.search(r"<title>([^<]*)</title>", index).group(1)) if re.search(r"<title>", index) else ""
    rep["engineHints"] = [n for n, pat in ENGINES if re.search(pat, index, re.I)]
    rep["indexRefs"] = sorted(set(r for r in re.findall(r'(?:src|href)=["\']([^"\']+)["\']', index)
                                  if not r.startswith(("http", "data:", "//", "#"))))[:40]
    rep["externalScripts"] = sorted(set(re.findall(r'<script[^>]+src="(https?://[^"]+)"', index)))
    rep["sitelockHints"] = sorted(set(re.findall(r"(sitelock|ancestorOrigins|document\.referrer|location\.hostname|unofficial)", index, re.I)))
    d = os.path.join(ut, slug); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "index.html"), "wb").write(ib)
    rep["savedIndex"] = os.path.join(d, "index.html")
    return rep


if __name__ == "__main__":
    args = sys.argv[1:]
    ut = "/tmp/spillside-kartlegging"
    if "--ut" in args:
        i = args.index("--ut"); ut = args[i + 1]; del args[i:i + 2]
    if not args:
        print(__doc__); sys.exit(1)
    for n, u in enumerate(args):
        if n: time.sleep(2)
        print(json.dumps(kartlegg(u, ut), ensure_ascii=False))
