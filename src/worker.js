// Cloudflare tillater ikke statiske filer over 25 MiB. Slike filer holdes utenfor opplastingen
// (public/.assetsignore), og public/lokal/hent.sh legger i stedet ved en brotli-komprimert kopi
// <fil>.br. Når <fil> etterspørres og ikke finnes som statisk fil, svarer denne workeren med
// <fil>.br rett gjennom (encodeBody: 'manual') og Content-Encoding: br, så nettleseren pakker ut.
// Ingen byte går gjennom JavaScript, som er avgjørende på gratisplanen (10 ms CPU per forespørsel).
//
// Reserve: er selv den komprimerte filen over 25 MiB, deler hent.sh originalen i <fil>.part0,
// .part1, ... og de pumpes sammen her med pipeTo. Det bruker mer CPU og kan kuttes av på gratisplanen
// ved store filer, så .br er den foretrukne veien.
// Statiske filer som finnes serveres direkte uten at denne koden kjører, unntatt /api/* (run_worker_first).
const TYPES = {
  wasm: 'application/wasm',
  js: 'text/javascript',
  gz: 'application/gzip',
  pck: 'application/octet-stream',
  data: 'application/octet-stream',
};

const baseHeaders = (pathname, extra = {}) => {
  const ext = pathname.split('.').pop().toLowerCase();
  return new Headers({
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    ...extra,
  });
};

import { api } from './api.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Leaderboard-API (brukere, poeng, topplister). Se src/api.js.
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return api(request, env, ctx);
    if (request.method !== 'GET' && request.method !== 'HEAD') return env.ASSETS.fetch(request);
    const base = `${url.origin}${url.pathname}`;

    // 1) Brotli-komprimert kopi sendes rett gjennom.
    const br = await env.ASSETS.fetch(new Request(`${base}.br`, { method: request.method, headers: { 'If-None-Match': request.headers.get('if-none-match') || '' } }));
    if (br.status === 304) return new Response(null, { status: 304, headers: baseHeaders(url.pathname, { ETag: br.headers.get('etag') || '' }) });
    if (br.ok) {
      const headers = baseHeaders(url.pathname, { 'Content-Encoding': 'br', 'X-Spillside': 'br', Vary: 'Accept-Encoding' });
      if (br.headers.get('etag')) headers.set('ETag', br.headers.get('etag'));
      if (br.headers.get('content-length')) headers.set('Content-Length', br.headers.get('content-length'));
      return new Response(request.method === 'HEAD' ? null : br.body, { status: 200, headers, encodeBody: 'manual' });
    }

    // 2) Reserve: biter som settes sammen.
    const parts = [];
    for (let i = 0; i < 64; i++) {
      const head = await env.ASSETS.fetch(new Request(`${base}.part${i}`, { method: 'HEAD' }));
      if (!head.ok) break;
      parts.push({ url: `${base}.part${i}`, size: Number(head.headers.get('content-length')) || 0, etag: head.headers.get('etag') || '' });
    }
    if (parts.length === 0) return env.ASSETS.fetch(request); // vanlig 404

    const etag = `W/"${parts.map((p) => p.etag.replace(/[^A-Za-z0-9]/g, '')).join('-')}"`;
    const headers = baseHeaders(url.pathname, { ETag: etag, 'X-Spillside': `parts=${parts.length}` });
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    if (parts.every((p) => p.size > 0)) headers.set('Content-Length', String(parts.reduce((a, p) => a + p.size, 0)));
    if (request.method === 'HEAD') return new Response(null, { headers });

    // IdentityTransformStream er Cloudflares native strøm: pipeTo gjennom den går utenom JavaScript.
    // (new TransformStream() gir den JS-baserte standardstrømmen med nyere kompatibilitetsdato.)
    const { readable, writable } = new IdentityTransformStream();
    const pump = (async () => {
      try {
        for (const p of parts) {
          const r = await env.ASSETS.fetch(new Request(p.url));
          if (!r.ok || !r.body) throw new Error(`mangler ${p.url}`);
          await r.body.pipeTo(writable, { preventClose: true });
        }
        await writable.close();
      } catch (e) {
        await writable.abort(e).catch(() => {});
      }
    })();
    ctx.waitUntil(pump);
    return new Response(readable, { headers });
  },
};
