#!/usr/bin/env node
// Tester et spill i en ekte nettleser (Playwright/Chromium) og rapporterer som JSON.
//
// Bruk:  PW_DIR=/tmp/spillside-pw node sjekk_spill.mjs <slug> [--url http://127.0.0.1:8080] [--vent 25] [--ut /tmp/spillside-sjekk]
//
// Oppsett første gang (Chromium ligger ofte allerede i ~/Library/Caches/ms-playwright):
//   mkdir -p /tmp/spillside-pw && cd /tmp/spillside-pw && npm init -y >/dev/null && npm i playwright --silent
//   (mangler nettleseren: npx playwright install chromium)
//
// Gjør to ting:
//  1. Åpner lokal/<slug>/index.html direkte, venter, og samler alle 4xx/5xx for filer under spillmappen.
//     Disse er som regel filer spillet henter ved kjøring og som manglet i crawlen: gi dem til
//     hent_spill.py --extra. Den ser også etter tekst som tyder på en sperre (sitelock, «unofficial»,
//     «HOST ERROR», «You should be using itch.io») i alle rammer, og tar skjermbilde.
//  2. Åpner biblioteket på #/spill/<slug> og sjekker at spillvisningen har en iframe (eller den låste
//     skjermen for blokkerte spill), og tar skjermbilde.
// Se ALLTID på skjermbildene med Read. En knapp som finnes i DOM kan være skjult: klikk bare på det
// som faktisk er synlig på skjermbildet, med musekoordinater, når du tester om spillet kan startes.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const slug = args[0];
if (!slug) { console.error('Bruk: node sjekk_spill.mjs <slug> [--url ...] [--vent sek] [--ut mappe]'); process.exit(1); }
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('--url', 'http://127.0.0.1:8080').replace(/\/$/, '');
const WAIT = Number(opt('--vent', '25')) * 1000;
const OUT = opt('--ut', '/tmp/spillside-sjekk');
fs.mkdirSync(OUT, { recursive: true });

const pwDir = process.env.PW_DIR || '/tmp/spillside-pw';
let chromium;
try { ({ chromium } = createRequire(path.join(pwDir, 'package.json'))('playwright')); }
catch { console.error(`Fant ikke playwright i ${pwDir}. Se oppsettet øverst i skriptet.`); process.exit(2); }

const BLOCK = /(HOST ERROR|unofficial version|You should be using itch\.io|sitelock|not allowed|site lock|domain is not|piracy|stolen)/i;
const gameDir = `${BASE}/lokal/${slug}/`;
const report = { slug, direkte: {}, bibliotek: {} };

const browser = await chromium.launch({ headless: true });
try {
  // 1) Direkte
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const missing = new Set(), errors = [], external = new Set();
    page.on('response', (r) => {
      const u = r.url();
      if (r.status() >= 400 && u.startsWith(gameDir)) missing.add(decodeURIComponent(u.slice(gameDir.length).split('?')[0]));
      if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) external.add(new URL(u).host);
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().replace(/\s+/g, ' ').slice(0, 200)); });
    page.on('crash', () => errors.push('SIDEN KRASJET (kjent for enkelte spill i headless Chromium; test i ekte nettleser)'));
    const t0 = Date.now();
    try { await page.goto(gameDir + 'index.html', { waitUntil: 'load', timeout: 90000 }); } catch (e) { errors.push('goto: ' + e.message.slice(0, 150)); }
    await page.waitForTimeout(WAIT).catch(() => {});
    let texts = '';
    for (const f of page.frames()) { try { texts += ' ' + (await f.evaluate(() => document.body ? document.body.innerText : '')); } catch { /* */ } }
    const canvases = await page.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height}`)).catch(() => []);
    const shot = path.join(OUT, `${slug}-direkte.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    report.direkte = {
      sekunder: Math.round((Date.now() - t0) / 1000), mangler: [...missing].sort(), feil: [...new Set(errors)].slice(0, 15),
      sperreTekst: (texts.match(BLOCK) || [null])[0], synligTekst: texts.replace(/\s+/g, ' ').trim().slice(0, 400),
      canvas: canvases, eksterneVerter: [...external].sort(), skjermbilde: shot,
    };
    await ctx.close();
  }
  // 2) I biblioteket
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    await page.goto(`${BASE}/#/spill/${slug}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(Math.min(WAIT, 15000));
    const state = await page.evaluate(() => ({
      tittel: document.title,
      iframes: document.querySelectorAll('iframe').length,
      laast: !!document.body.innerText.match(/Spill på itch\.io|Kan ikke spilles her/),
      ikkeFunnet: !!document.body.innerText.match(/Fant ikke siden/),
      stageBunn: (() => { const f = document.querySelector('iframe'); return f ? Math.round(f.getBoundingClientRect().bottom) : null; })(),
      vindushoyde: innerHeight,
    }));
    // Får spillet plass i rammen? Spill med fast størrelse (PICO-8, eldre HTML5, stående spill) blir ofte kuttet.
    let kuttet = null;
    const frameEl = await page.$('iframe');
    const frame = frameEl ? await frameEl.contentFrame() : null;
    if (frame) {
      kuttet = await frame.evaluate(() => {
        const vw = innerWidth, vh = innerHeight, de = document.documentElement;
        let right = 0, bottom = 0;
        for (const el of document.querySelectorAll('canvas, body > *')) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (r.width * r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
          right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
        }
        const x = Math.round(Math.max(de.scrollWidth, right) - vw), y = Math.round(Math.max(de.scrollHeight, bottom) - vh);
        return { ramme: `${vw}x${vh}`, utenforHoyre: Math.max(0, x), utenforNede: Math.max(0, y) };
      }).catch(() => null);
    }
    const shot = path.join(OUT, `${slug}-bibliotek.png`);
    await page.screenshot({ path: shot });
    report.bibliotek = { ...state, kuttet, sidefeil: errors, skjermbilde: shot };
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify(report, null, 1));
