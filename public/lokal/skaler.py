#!/usr/bin/env python3
"""Skalerer et spill med fast størrelse så det får plass i vinduet (iframen i biblioteket).

Bruk (fra public/lokal/):
  python3 skaler.py <slug>/index.html '<css-selektor>' [--bare-ned] [--pixel] [--storrelse BxH]

  <css-selektor>   elementet som holder hele spillet med fast størrelse, f.eks. '#stage',
                   '#game_container', 'body > div' (PICO-8) eller 'canvas'.
  --bare-ned       skaler bare ned når vinduet er for lite, aldri opp.
  --pixel          skarpe piksler (image-rendering: pixelated) på canvas, for pikselkunst.
  --storrelse BxH  lås elementet til denne størrelsen (px) før det måles. Trengs når beholderen
                   tar størrelse fra vinduet (prosent-høyde), så den ellers blir kuttet i en lav
                   ramme; bruk størrelsen itch viser spillet i (itchSize fra kartleggingen).

Skriptet setter inn en liten blokk før </body> som måler elementets egen størrelse og skalerer det
med CSS transform til vinduet, sentrert. De fleste motorer regner museposisjonen ut fra
getBoundingClientRect, så klikk treffer fortsatt; test alltid klikk og tastatur etterpå.
Kjøres det flere ganger, byttes blokken ut, så det kan stå i hent.sh-blokken til spillet.
"""
import argparse, re, sys

MARK_START, MARK_END = "<!-- SpillSide: skalering -->", "<!-- /SpillSide: skalering -->"


def main():
    ap = argparse.ArgumentParser(usage=__doc__, add_help=False)
    ap.add_argument("path"); ap.add_argument("selector")
    ap.add_argument("--bare-ned", action="store_true"); ap.add_argument("--pixel", action="store_true")
    ap.add_argument("--storrelse", metavar="BxH")
    a = ap.parse_args()
    path, selector = a.path, a.selector
    fixed = "null"
    if a.storrelse:
        m = re.fullmatch(r"(\d+)x(\d+)", a.storrelse)
        if not m: print("--storrelse må være BREDDExHØYDE i piksler, f.eks. 360x640"); sys.exit(1)
        fixed = f"[{m.group(1)},{m.group(2)}]"
    s = open(path, encoding="utf-8", errors="replace").read()
    s = re.sub(re.escape(MARK_START) + r".*?" + re.escape(MARK_END) + r"\s*", "", s, flags=re.S)
    pixel = "canvas{image-rendering:pixelated;image-rendering:crisp-edges}" if a.pixel else ""
    block = f"""{MARK_START}
<style>html,body{{margin:0;height:100%;overflow:hidden}}{pixel}</style>
<script>
(function () {{
  var sel = {selector!r}, onlyDown = {"true" if a.bare_ned else "false"}, fixed = {fixed};
  function fit() {{
    var el = document.querySelector(sel);
    if (!el) return;
    el.style.transform = '';
    if (fixed) {{ el.style.width = fixed[0] + 'px'; el.style.height = fixed[1] + 'px'; }}
    var w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    var s = Math.min(innerWidth / w, innerHeight / h);
    if (onlyDown) s = Math.min(s, 1);
    el.style.position = 'absolute'; el.style.left = '0'; el.style.top = '0'; el.style.margin = '0';
    el.style.transformOrigin = '0 0';
    el.style.transform = 'translate(' + Math.max(0, (innerWidth - w * s) / 2) + 'px,' +
      Math.max(0, (innerHeight - h * s) / 2) + 'px) scale(' + s + ')';
  }}
  addEventListener('resize', fit); addEventListener('load', fit);
  fit(); setTimeout(fit, 500); setTimeout(fit, 2000);
}})();
</script>
{MARK_END}
"""
    if "</body>" in s:
        i = s.rfind("</body>"); s = s[:i] + block + s[i:]
    else:
        s = s + "\n" + block
    open(path, "w", encoding="utf-8").write(s)
    print(f"skalering satt inn i {path} for {selector}")


if __name__ == "__main__":
    main()
