#!/usr/bin/env python3
"""Gjør et spill klart for Cloudflare når det har filer over 25 MiB.

Bruk:  python3 store_filer.py <slug> [--repo <sti>]

Cloudflare Workers Static Assets tar ikke filer over 25 MiB. For hver slik fil i public/lokal/<slug>/:
  * er filen ikke allerede komprimert (wasm, pck, data, js ...) og blir brotli-versjonen under 25 MiB,
    lages <fil>.br. src/worker.js sender den rett gjennom med Content-Encoding: br.
  * ellers (Unity .data/.unityweb, FMOD .bank, bilder, lyd, eller brotli fortsatt for stor) deles filen
    i <fil>.part0, .part1, ... på 20 MiB, som workeren pumper sammen med IdentityTransformStream.
Originalen legges i public/.assetsignore (så den ikke lastes opp) og blir liggende lokalt, der den
serveres direkte. Skriptet skriver ut linjen du skal legge i hent.sh-blokken (stor ...).
Krever brotli (brew install brotli) for .br-veien; uten brotli brukes biter.
"""
import os, shutil, subprocess, sys

PART, LIMIT = 20 * 1024 * 1024, 25 * 1024 * 1024
KOMPRIMERT = (".unityweb", ".bank", ".gz", ".br", ".zip", ".ogg", ".mp3", ".m4a", ".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm")


def main():
    args = sys.argv[1:]
    if not args: print(__doc__); sys.exit(1)
    slug = args[0]
    repo = args[args.index("--repo") + 1] if "--repo" in args else subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip() or os.getcwd()
    root = os.path.join(repo, "public", "lokal", slug)
    ignore = os.path.join(repo, "public", ".assetsignore")
    brotli = shutil.which("brotli")
    big = []
    for d, _, files in os.walk(root):
        for f in files:
            p = os.path.join(d, f)
            if ".part" in f or f.endswith(".br"): continue
            if os.path.getsize(p) > LIMIT: big.append(p)
    if not big:
        print(f"Ingen filer over 25 MiB i {root}."); return
    lines = open(ignore).read().splitlines() if os.path.exists(ignore) else []
    stor = []
    for p in sorted(big):
        rel = os.path.relpath(p, os.path.join(repo, "public"))
        for old in os.listdir(os.path.dirname(p)):
            if old.startswith(os.path.basename(p) + ".part") or old == os.path.basename(p) + ".br":
                os.remove(os.path.join(os.path.dirname(p), old))
        how = None
        if brotli and not p.lower().endswith(KOMPRIMERT):
            br = p + ".br"
            subprocess.run([brotli, "-q", "11", "-f", "-o", br, p], check=True)
            if os.path.getsize(br) <= LIMIT: how = f"brotli ({os.path.getsize(br)} bytes)"
            else: os.remove(br)
        if not how:
            with open(p, "rb") as fh:
                i = 0
                while True:
                    chunk = fh.read(PART)
                    if not chunk: break
                    open(f"{p}.part{i}", "wb").write(chunk); i += 1
            how = f"{i} biter"
        if rel not in lines: lines.append(rel)
        stor.append(os.path.relpath(p, os.path.join(repo, "public", "lokal")))
        print(f"  {rel}: {os.path.getsize(p)} bytes -> {how}")
    with open(ignore, "w") as fh: fh.write("\n".join(lines) + "\n")
    print(f"\nLagt i public/.assetsignore. Legg denne linjen i hent.sh-blokken for {slug}:\n  stor {' '.join(stor)}")


if __name__ == "__main__":
    main()
