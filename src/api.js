// Leaderboard-API for SpillSide. Alle svar er JSON. Innlogging holdes i en HttpOnly-kapsel,
// så verken spillene (som kjører på samme origin) eller andre skript kan lese økt-tokenet.
//
// Sikkerhet mot juks, i rekkefølge etter hvor mye de hjelper:
//  1. Poeng godtas bare fra en innlogget bruker, knyttet til en spilleøkt serveren selv åpnet
//     da spillet ble startet, og først etter at minste spilletid for spillet har gått.
//  2. Hvert spill har et tak (maks) i games.json. Alt over avvises.
//  3. Bare forbedringer lagres, og alt logges med spilletid og IP-hash i poenglogg, så
//     mistenkelige innsendinger kan ettergås og slettes.
//  4. Få innsendinger per økt og per time.
// Det som IKKE kan hindres: en som leser koden kan sende inn et oppdiktet tall innenfor taket
// etter å ha ventet ut minstetiden. Verdien kommer fra spillerens egen nettleser, og vi
// kan ikke verifisere spillingen på serveren uten å endre spillene.
import { sjekkBrukernavn } from './ordfilter.js';

const KAPSEL = 'spillside_okt';
const OKT_SEK = 90 * 24 * 3600;
// 100 000 iterasjoner bruker ~23 ms CPU på Workers; gratisplanen gir 10 ms per forespørsel.
const PBKDF2_ITER = 25000;
const PEPPER = 'spillside-ip-2026'; // gjør IP-hashene ubrukelige utenfor denne tjenesten
const NAVN_RE = /^[A-Za-zÆØÅæøåÄÖäö][A-Za-z0-9ÆØÅæøåÄÖäö_]{2,15}$/;

const enc = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

class ApiFeil extends Error { constructor(status, melding) { super(melding); this.status = status; } }
const feil = (status, melding) => { throw new ApiFeil(status, melding); };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}

async function hashPassord(passord) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(passord), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(bits)}`;
}
async function sjekkPassord(passord, lagret) {
  const [alg, iter, salt, hash] = String(lagret).split('$');
  if (alg !== 'pbkdf2') return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(passord), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: Number(iter) }, key, 256));
  const want = unb64(hash);
  if (want.length !== bits.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ want[i]; // konstant tid
  return diff === 0;
}

const ipHash = (request) => sha256((request.headers.get('CF-Connecting-IP') || 'lokal') + PEPPER);

async function lesJson(request) {
  if (!/application\/json/i.test(request.headers.get('content-type') || '')) feil(415, 'Forventet JSON.');
  const tekst = await request.text();
  if (tekst.length > 4096) feil(413, 'For stor forespørsel.');
  try { return JSON.parse(tekst); } catch { feil(400, 'Ugyldig JSON.'); }
}

function kapsel(request) {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${KAPSEL}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}
function settKapsel(url, verdi, maxAge) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return { 'Set-Cookie': `${KAPSEL}=${verdi}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}` };
}

async function bruker(request, env) {
  const t = kapsel(request);
  if (!t) return null;
  const th = await sha256(t);
  const row = await env.DB.prepare(
    'SELECT b.id, b.navn, b.opprettet, b.utestengt, o.utloper FROM okter o JOIN brukere b ON b.id = o.bruker_id WHERE o.token_hash = ?',
  ).bind(th).first();
  if (!row || row.utloper < now() || row.utestengt) return null;
  return row;
}
const krevBruker = async (request, env) => (await bruker(request, env)) || feil(401, 'Du må logge inn først.');

async function nyOkt(env, url, brukerId) {
  const token = randomHex(32);
  const t = now();
  await env.DB.prepare('INSERT INTO okter (token_hash, bruker_id, opprettet, utloper) VALUES (?, ?, ?, ?)').bind(await sha256(token), brukerId, t, t + OKT_SEK).run();
  return settKapsel(url, token, OKT_SEK);
}

// Teller forsøk fra samme IP i vinduet, og nekter over grensen.
async function sperre(env, iph, type, maks, vinduSek) {
  const t = now();
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM forsok WHERE ip_hash = ? AND type = ? AND tid > ?').bind(iph, type, t - vinduSek).first();
  if (r && r.n >= maks) feil(429, 'For mange forsøk. Vent litt og prøv igjen.');
  await env.DB.prepare('INSERT INTO forsok (ip_hash, type, tid) VALUES (?, ?, ?)').bind(iph, type, t).run();
}

// Spillkonfigurasjonen leses fra games.json, så taket og minstetiden står ett sted.
let spillCache = { tid: 0, data: null };
async function spillMedTavle(env, origin) {
  if (spillCache.data && Date.now() - spillCache.tid < 60_000) return spillCache.data;
  const res = await env.ASSETS.fetch(new Request(`${origin}/data/games.json`));
  if (!res.ok) feil(500, 'Fant ikke spillisten.');
  const alle = (await res.json()).games || [];
  const map = new Map();
  for (const g of alle) {
    if (!g.score || g.blocked) continue;
    const liste = Array.isArray(g.score) ? g.score : [g.score];
    for (const sc of liste) {
      if (!sc || typeof sc !== 'object') continue;
      const id = typeof sc.id === 'string' && sc.id ? sc.id : 'standard';
      const key = id === 'standard' ? g.slug : `${g.slug}/${id}`;
      map.set(key, {
        key,
        slug: g.slug,
        id,
        title: g.title,
        navn: sc.navn || '',
        retning: sc.retning === 'lavest' ? 'lavest' : 'hoyest',
        maks: Number.isFinite(sc.maks) ? sc.maks : 1_000_000_000,
        minSek: Number.isFinite(sc.minSek) ? sc.minSek : 30,
        enhet: sc.enhet || 'poeng',
        format: sc.format || '',
      });
    }
  }
  spillCache = { tid: Date.now(), data: map };
  return map;
}
const bedre = (sp, ny, gammel) => (sp.retning === 'lavest' ? ny < gammel : ny > gammel);

async function tavle(env, sp, antall, brukerId) {
  const asc = sp.retning === 'lavest';
  const rader = await env.DB.prepare(
    `SELECT b.navn, r.poeng, r.satt FROM rekorder r JOIN brukere b ON b.id = r.bruker_id
     WHERE r.spill = ? AND b.utestengt = 0 ORDER BY r.poeng ${asc ? 'ASC' : 'DESC'}, r.satt ASC LIMIT ?`,
  ).bind(sp.key, antall).all();
  let meg = null;
  if (brukerId) {
    const egen = await env.DB.prepare('SELECT poeng, satt FROM rekorder WHERE spill = ? AND bruker_id = ?').bind(sp.key, brukerId).first();
    if (egen) {
      const foran = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM rekorder r JOIN brukere b ON b.id = r.bruker_id
         WHERE r.spill = ? AND b.utestengt = 0 AND (r.poeng ${asc ? '<' : '>'} ? OR (r.poeng = ? AND r.satt < ?))`,
      ).bind(sp.key, egen.poeng, egen.poeng, egen.satt).first();
      meg = { poeng: egen.poeng, satt: egen.satt, plass: (foran?.n || 0) + 1 };
    }
  }
  const antallTotalt = await env.DB.prepare('SELECT COUNT(*) AS n FROM rekorder r JOIN brukere b ON b.id = r.bruker_id WHERE r.spill = ? AND b.utestengt = 0').bind(sp.key).first();
  return { spill: sp.slug, id: sp.id, navn: sp.navn, enhet: sp.enhet, format: sp.format, retning: sp.retning, antall: antallTotalt?.n || 0, rader: rader.results, meg };
}

// Litt rydding nå og da, så tabellene ikke vokser av gamle forsøk og økter.
function rydd(env, ctx) {
  if (Math.random() > 0.03) return;
  const t = now();
  ctx.waitUntil(env.DB.batch([
    env.DB.prepare('DELETE FROM forsok WHERE tid < ?').bind(t - 86400),
    env.DB.prepare('DELETE FROM okter WHERE utloper < ?').bind(t),
    env.DB.prepare('DELETE FROM spilleokter WHERE startet < ?').bind(t - 2 * 86400),
  ]));
}

export async function api(request, env, ctx) {
  const url = new URL(request.url);
  const deler = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  try {
    if (!env.DB) feil(503, 'Leaderboard er ikke satt opp (mangler D1-binding).');
    if (request.method !== 'GET') {
      // Egen header tvinger fram CORS-preflight fra andre nettsteder, som da stoppes. Pluss Origin-sjekk.
      if (request.headers.get('X-Spillside') !== '1') feil(403, 'Mangler X-Spillside-header.');
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) feil(403, 'Feil opprinnelse.');
    }
    rydd(env, ctx);
    const [a, b, c] = deler;
    // Tavlenøkkel: <slug> eller <slug>/<id> når et spill har flere topplister.
    const tavleKey = b ? (c ? `${b}/${c}` : b) : '';

    if (a === 'meg' && request.method === 'GET') {
      const u = await bruker(request, env);
      return json({ bruker: u ? { navn: u.navn, opprettet: u.opprettet } : null });
    }

    if (a === 'registrer' && request.method === 'POST') {
      const { navn, passord } = await lesJson(request);
      if (typeof navn !== 'string' || !NAVN_RE.test(navn)) feil(400, 'Brukernavnet må være 3–16 tegn: bokstaver, tall og understrek, og starte med en bokstav.');
      const stygt = sjekkBrukernavn(navn);
      if (stygt) feil(400, stygt);
      if (typeof passord !== 'string' || passord.length < 6 || passord.length > 72) feil(400, 'Passordet må være 6–72 tegn.');
      await sperre(env, await ipHash(request), 'registrering', 5, 86400);
      const t = now();
      const navnLc = navn.toLowerCase();
      const finnes = await env.DB.prepare('SELECT 1 FROM brukere WHERE navn_lc = ?').bind(navnLc).first();
      if (finnes) feil(409, 'Brukernavnet er tatt.');
      const r = await env.DB.prepare('INSERT INTO brukere (navn, navn_lc, passord, opprettet, sist_sett) VALUES (?, ?, ?, ?, ?)')
        .bind(navn, navnLc, await hashPassord(passord), t, t).run();
      const id = r.meta.last_row_id;
      return json({ bruker: { navn, opprettet: t } }, 201, await nyOkt(env, url, id));
    }

    if (a === 'logg-inn' && request.method === 'POST') {
      const { navn, passord } = await lesJson(request);
      if (typeof navn !== 'string' || typeof passord !== 'string') feil(400, 'Mangler brukernavn eller passord.');
      await sperre(env, await ipHash(request), 'innlogging', 10, 15 * 60);
      const u = await env.DB.prepare('SELECT id, navn, passord, opprettet, utestengt FROM brukere WHERE navn_lc = ?').bind(navn.toLowerCase()).first();
      if (!u || !(await sjekkPassord(passord, u.passord))) feil(401, 'Feil brukernavn eller passord.');
      if (u.utestengt) feil(403, 'Denne brukeren er utestengt.');
      ctx.waitUntil(env.DB.prepare('UPDATE brukere SET sist_sett = ? WHERE id = ?').bind(now(), u.id).run());
      return json({ bruker: { navn: u.navn, opprettet: u.opprettet } }, 200, await nyOkt(env, url, u.id));
    }

    if (a === 'logg-ut' && request.method === 'POST') {
      const t = kapsel(request);
      if (t) await env.DB.prepare('DELETE FROM okter WHERE token_hash = ?').bind(await sha256(t)).run();
      return json({ ok: true }, 200, settKapsel(url, '', 0));
    }

    if (a === 'spilleokt' && b && request.method === 'POST') {
      const u = await krevBruker(request, env);
      const sp = (await spillMedTavle(env, url.origin)).get(tavleKey);
      if (!sp) feil(404, 'Dette spillet har ingen toppliste.');
      const id = randomHex(16);
      await env.DB.prepare('INSERT INTO spilleokter (id, bruker_id, spill, startet) VALUES (?, ?, ?, ?)').bind(id, u.id, sp.key, now()).run();
      return json({ okt: id, minSek: sp.minSek });
    }

    if (a === 'poeng' && b && request.method === 'POST') {
      const u = await krevBruker(request, env);
      const sp = (await spillMedTavle(env, url.origin)).get(tavleKey);
      if (!sp) feil(404, 'Dette spillet har ingen toppliste.');
      const { okt, poeng } = await lesJson(request);
      if (!Number.isInteger(poeng) || poeng < 0) feil(400, 'Poeng må være et heltall.');
      const t = now();
      const iph = await ipHash(request);
      // Returnerer en forberedt setning, så den kan gå i en batch. Avvisninger kjøres for seg.
      const loggStmt = (godtatt, grunn, spilletid = 0) => env.DB.prepare(
        'INSERT INTO poenglogg (bruker_id, spill, poeng, spilletid, ip_hash, tid, godtatt, grunn) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(u.id, sp.key, poeng, spilletid, iph, t, godtatt ? 1 : 0, grunn);
      const logg = (godtatt, grunn, spilletid = 0) => loggStmt(godtatt, grunn, spilletid).run();

      const so = typeof okt === 'string' && /^[a-f0-9]{32}$/.test(okt)
        ? await env.DB.prepare('SELECT * FROM spilleokter WHERE id = ? AND bruker_id = ? AND spill = ?').bind(okt, u.id, sp.key).first()
        : null;
      if (!so) { ctx.waitUntil(logg(false, 'ukjent spilleøkt')); feil(400, 'Ukjent spilleøkt. Last spillet på nytt.'); }
      const spilletid = t - so.startet;
      if (spilletid < sp.minSek) { ctx.waitUntil(logg(false, 'for kort spilletid', spilletid)); feil(425, `Spill litt lenger først (minst ${sp.minSek} sekunder).`); }
      if (so.innsendinger >= 30) { ctx.waitUntil(logg(false, 'for mange i økten', spilletid)); feil(429, 'For mange innsendinger i denne økten.'); }
      if (poeng > sp.maks) { ctx.waitUntil(logg(false, 'over taket', spilletid)); feil(400, 'Dette resultatet er høyere enn det spillet kan gi.'); }
      const siste = await env.DB.prepare('SELECT COUNT(*) AS n FROM poenglogg WHERE bruker_id = ? AND tid > ?').bind(u.id, t - 3600).first();
      if ((siste?.n || 0) >= 60) { ctx.waitUntil(logg(false, 'for mange per time', spilletid)); feil(429, 'For mange innsendinger den siste timen.'); }

      const gammel = await env.DB.prepare('SELECT poeng FROM rekorder WHERE bruker_id = ? AND spill = ?').bind(u.id, sp.key).first();
      const nyRekord = !gammel || bedre(sp, poeng, gammel.poeng);
      const ops = [
        env.DB.prepare('UPDATE spilleokter SET innsendinger = innsendinger + 1 WHERE id = ?').bind(so.id),
        loggStmt(nyRekord, nyRekord ? 'ny rekord' : 'ikke bedre', spilletid),
      ];
      if (nyRekord) {
        ops.push(env.DB.prepare(
          'INSERT INTO rekorder (bruker_id, spill, poeng, satt) VALUES (?, ?, ?, ?) ON CONFLICT(bruker_id, spill) DO UPDATE SET poeng = excluded.poeng, satt = excluded.satt',
        ).bind(u.id, sp.key, poeng, t));
      }
      await env.DB.batch(ops);
      return json({ nyRekord, ...(await tavle(env, sp, 10, u.id)) });
    }

    if (a === 'tavle' && request.method === 'GET') {
      const spill = await spillMedTavle(env, url.origin);
      const u = await bruker(request, env);
      if (b) {
        const sp = spill.get(tavleKey);
        if (!sp) feil(404, 'Dette spillet har ingen toppliste.');
        const antall = Math.min(100, Math.max(1, Number(url.searchParams.get('antall')) || 20));
        return json(await tavle(env, sp, antall, u?.id));
      }
      // Oversikt: topp 3 for hvert spill med toppliste.
      const ut = [];
      for (const sp of spill.values()) ut.push({ title: sp.title, ...(await tavle(env, sp, 3, u?.id)) });
      return json({ tavler: ut });
    }

    feil(404, 'Ukjent API-rute.');
  } catch (e) {
    if (e instanceof ApiFeil) return json({ feil: e.message }, e.status);
    console.error('api-feil', e);
    return json({ feil: 'Noe gikk galt på serveren.' }, 500);
  }
}
