#!/usr/bin/env python3
"""Legger et spill inn i public/data/games.json (eller oppdaterer oppføringen hvis slug finnes).

Bruk:
  python3 legg_til_i_games_json.py --kart <fil med én kartlegg.py-linje> \\
      --beskrivelse "Én naturlig norsk setning om spillet." \\
      --kategorier puslespill,arkade --motor "Unity" --notater "Unity WebGL-build." \\
      [--tittel ...] [--bredde 1280 --forhold "16 / 9"] [--spillere "1–2 spillere lokalt"] \\
      [--pixel] [--advarsel "..."] [--blokkert "..."] [--repo <sti>]

Tallfelt beregnes: order (én høyere enn høyeste), sizeMB (spillmappen uten .part/.br-kopier) og
fetched (dagens dato). Bredde og sideforhold tas fra størrelsen itch viser spillet i, med mindre du
overstyrer. Kategoriene må finnes i categories i games.json (legg til en ny der først om nødvendig).
coverSize fylles inn av «public/lokal/hent.sh covers <slug>», som også laster ned og konverterer coveret.
"""
import argparse, datetime, json, math, os, subprocess, sys

INPUT = {"Mouse": "Mus", "Keyboard": "Tastatur", "Gamepad (any)": "Håndkontroll", "Xbox controller": "Håndkontroll",
         "Playstation controller": "Håndkontroll", "Touchscreen": "Berøringsskjerm", "Smartphone": None, "Joystick": "Styrespak",
         "Accelerometer": None, "Voice control": "Stemme"}


def ratio(w, h):
    g = math.gcd(w, h); a, b = w // g, h // g
    return f"{a} / {b}" if a <= 32 and b <= 32 else f"{w} / {h}"


def players(k):
    pc, mp = k.get("playerCount", ""), k.get("multiplayer", "")
    if not pc: return None
    pc = pc.replace(" - ", "–").replace("-", "–").strip()
    where = " lokalt" if "Local" in mp else (" på nett" if ("network" in mp.lower() or "online" in mp.lower()) else "")
    return None if pc in ("1", "") else f"{pc} spillere{where}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kart", required=True); ap.add_argument("--beskrivelse", required=True)
    ap.add_argument("--kategorier", required=True); ap.add_argument("--motor", required=True)
    ap.add_argument("--notater", default=""); ap.add_argument("--tittel"); ap.add_argument("--bredde", type=int)
    ap.add_argument("--forhold"); ap.add_argument("--spillere"); ap.add_argument("--pixel", action="store_true")
    ap.add_argument("--advarsel"); ap.add_argument("--blokkert"); ap.add_argument("--repo")
    a = ap.parse_args()
    repo = a.repo or subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip() or os.getcwd()
    k = json.loads(open(a.kart).read().strip().splitlines()[0])
    if k.get("feil"): sys.exit(f"Kartleggingen feilet: {k['feil']}")
    path = os.path.join(repo, "public", "data", "games.json")
    data = json.load(open(path))
    cats = {c["id"] for c in data["categories"]}
    wanted = [c.strip() for c in a.kategorier.split(",") if c.strip()]
    bad = [c for c in wanted if c not in cats]
    if bad: sys.exit(f"Ukjente kategorier {bad}. Finnes: {sorted(cats)}")
    slug = k["slug"]
    gdir = os.path.join(repo, "public", "lokal", slug)
    size = 0
    for d, _, files in os.walk(gdir):
        size += sum(os.path.getsize(os.path.join(d, f)) for f in files if ".part" not in f and not f.endswith(".br"))
    w, h = (k.get("itchSize") or [1280, 720])
    inputs = []
    for x in k.get("inputs", []):
        v = INPUT.get(x, x)
        if v and v not in inputs: inputs.append(v)
    existing = next((g for g in data["games"] if g["slug"] == slug), None)
    entry = {
        "slug": slug, "title": a.tittel or k["title"],
        "order": existing["order"] if existing else max((g["order"] for g in data["games"]), default=0) + 1,
        "authors": [{"name": x["name"], "url": x["url"]} for x in k["authors"]],
        "itch": k["itch"], "description": a.beskrivelse, "engine": a.motor, "categories": wanted,
        "inputs": inputs, "players": a.spillere if a.spillere is not None else players(k),
        "width": a.bredde or w, "ratio": a.forhold or ratio(w, h),
        "cover": f"covers/{slug}.webp", "coverSize": existing.get("coverSize", [630, 500]) if existing else [630, 500],
        "coverSource": k["coverSource"], "pixelArt": a.pixel,
        "sizeMB": round(size / 1048576), "fetched": datetime.date.today().isoformat(), "notes": a.notater,
    }
    if a.advarsel: entry["warning"] = a.advarsel
    if a.blokkert: entry["blocked"] = a.blokkert
    if existing: data["games"][data["games"].index(existing)] = entry
    else: data["games"].append(entry)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False); f.write("\n")
    print(json.dumps(entry, ensure_ascii=False, indent=1))
    print(f"\n{'Oppdatert' if existing else 'Lagt til'} {slug} i {path}. Kjør nå: public/lokal/hent.sh covers {slug}")


if __name__ == "__main__":
    main()
