# public/lokal/

Lokale kopier av HTML5-builds fra itch.zone, én mappe per spill. Filene er ikke sjekket inn i git. Kjør `./hent.sh` (alle spill og coverbilder), `./hent.sh <mappe>` (ett spill) eller `./hent.sh covers` (bare coverbildene til `../covers/`). Fillistene ligger i `manifest/`.

| Mappe | Spill | Hentet |
| --- | --- | --- |
| `how-to-crab-to-zero/` | How to Crab to Zero (Four Quarters team) | 24. sep 2026 |
| `multi-modal/` | Multi Modal Transit (southlondonsilicon) | 24. sep 2026 |
| `legendum/` | Legendum (Vadeum) | 24. sep 2026 |
| `rock-declutterer/` | Rock Declutterer (leafo) | 24. sep 2026 |
| `polytrack/` | PolyTrack (Kodub) | 24. sep 2026 |
| `die-in-the-dungeon/` | Die in the Dungeon CLASSIC (Alarts m.fl.) | 24. sep 2026 |
| `idle-breakout/` | Idle Breakout (Kodiqi), sitelock stopper lokal kopi | 24. sep 2026 |
| `generic-fighter-maybe/` | Generic Fighter Maybe (Astrobard Games) | 24. sep 2026 |
| `pikwip/` | Pikwip (Cookiecrayon) | 24. sep 2026 |
| `wildfire/` | WildFire (Salvador Palma) | 24. sep 2026 |
| `bobbys-bugs/` | Bobby's Beautiful Bugs (digitarium) | 24. sep 2026 |
| `get-yoked-2/` | GET YOKED: Extreme Bodybuilding (gregs-games) | 24. sep 2026 |
| `hardware-tycoon/` | Hardware Tycoon (Haxor1337) | 24. sep 2026 |
| `klifur/` | Klifur (Torfi) | 24. sep 2026 |
| `tanuki-sunset/` | Tanuki Sunset Classic (Rewind Games) | 24. sep 2026 |
| `dynamine/` | Dynamine (HexagonNico) | 24. sep 2026 |
| `soccer-physics/` | Soccer Physics (Otto Ojala) | 24. sep 2026 |
| `the-machinegg/` | The MachinEGG (JC / QuantumGames) | 24. sep 2026 |
| `infinidle/` | INFINIDLE (DevBanana) | 28. sep 2026 |

I hver `index.html` er `static.itch.io/htmlgame.js` (itch sitt hotlink-vern) og eventuelle annonseskript fjernet. Legendum, Die in the Dungeon og Bobby's Beautiful Bugs har fått enklere filnavn, og Unity-filene til Die in the Dungeon og Klifur er pakket ut. Filer over 25 MiB har i tillegg en brotli-komprimert kopi `.br` eller biter `.part0`, `.part1`, …, som er det som lastes opp til Cloudflare i stedet for originalen (se `../.assetsignore` og `../../src/worker.js`).
