// Monthly rain climatology at the five deep-space ground stations, from ERA5 hourly total
// precipitation on the Microsoft Planetary Computer (collection "era5-pds", Zarr on Azure Blob).
//
//   node scripts/fetch_station_weather.mjs [firstYear] [lastYear]
//
// Streams one 37.5° × 37.5° × ~15-day Zarr chunk at a time, keeps only the station's grid cell,
// and writes public/data/stations-weather.json: per station and calendar month, the fraction of
// hours with rain and the rain rates exceeded 1 % and 0.1 % of the time (what rain fade on a
// Ka-band link depends on). No account is needed: the Planetary Computer issues a free SAS token.
import fs from 'node:fs';
import { Blosc } from 'numcodecs';
import STATIONS from '../src/data/stations.json' with { type: 'json' };

const FIRST = Number(process.argv[2] ?? 2018);
const LAST = Number(process.argv[3] ?? 2020);
const VAR = 'precipitation_amount_1hour_Accumulation';
const ACCOUNT = 'cpdataeuwest';
const CH = 150; // lat/lon chunk edge
const TC = 372; // time chunk length

let token = '';
let tokenAt = 0;
async function sas() {
  if (!token || Date.now() - tokenAt > 30 * 60_000) {
    const r = await fetch(`https://planetarycomputer.microsoft.com/api/sas/v1/token/${ACCOUNT}/era5`);
    token = (await r.json()).token;
    tokenAt = Date.now();
  }
  return token;
}

async function get(url, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${url}?${await sas()}`);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
    }
  }
}

const codecs = new Map();
async function decode(cfg, bytes) {
  const key = JSON.stringify(cfg);
  if (!codecs.has(key)) codecs.set(key, Blosc.fromConfig(cfg));
  return codecs.get(key).decode(bytes);
}

const base = (y, m) => `https://${ACCOUNT}.blob.core.windows.net/era5/ERA5/${y}/${String(m).padStart(2, '0')}/${VAR}.zarr`;

// Grid: read the coordinate arrays once, to find each station's nearest cell.
const meta = JSON.parse(new TextDecoder().decode(await get(`${base(FIRST, 1)}/.zmetadata`))).metadata;
const lat = new Float32Array((await decode(meta['lat/.zarray'].compressor, await get(`${base(FIRST, 1)}/lat/0`))).buffer);
const lon = new Float32Array((await decode(meta['lon/.zarray'].compressor, await get(`${base(FIRST, 1)}/lon/0`))).buffer);
const nearest = (arr, v) => {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - v) < Math.abs(arr[best] - v)) best = i;
  return best;
};
const cells = STATIONS.map((s) => {
  const i = nearest(lat, s.lat);
  const j = nearest(lon, (s.lon + 360) % 360);
  return { id: s.id, i, j, latCell: lat[i], lonCell: lon[j] };
});
console.log('grid cells', cells);

// hours[station][month] = all hourly rain rates (mm/h) for that calendar month across the years
const hours = Object.fromEntries(STATIONS.map((s) => [s.id, Array.from({ length: 12 }, () => [])]));
const jobs = [];
for (let y = FIRST; y <= LAST; y++) {
  for (let m = 1; m <= 12; m++) {
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate() * 24;
    for (let tc = 0; tc * TC < n; tc++) {
      // Stations that share a spatial chunk share the download.
      const byChunk = new Map();
      for (const c of cells) {
        const k = `${tc}.${Math.floor(c.i / CH)}.${Math.floor(c.j / CH)}`;
        byChunk.set(k, [...(byChunk.get(k) ?? []), c]);
      }
      for (const [k, list] of byChunk) jobs.push({ y, m, n, tc, k, list });
    }
  }
}
console.log(`${jobs.length} chunks to stream`);

let done = 0;
let bytes = 0;
const cfgCache = new Map();
async function run(job) {
  const b = base(job.y, job.m);
  if (!cfgCache.has(b)) {
    const md = JSON.parse(new TextDecoder().decode(await get(`${b}/.zmetadata`))).metadata[`${VAR}/.zarray`];
    cfgCache.set(b, md);
  }
  const za = cfgCache.get(b);
  const raw = await get(`${b}/${VAR}/${job.k}`);
  bytes += raw.length;
  const f = new Float32Array((await decode(za.compressor, raw)).buffer);
  const [, cy, cx] = za.chunks;
  const t0 = job.tc * TC;
  for (const c of job.list) {
    const li = c.i % cy, lj = c.j % cx;
    for (let t = 0; t < TC && t0 + t < job.n; t++) {
      const v = f[t * cy * cx + li * cx + lj];
      if (Number.isFinite(v)) hours[c.id][job.m - 1].push(Math.max(0, v * 1000)); // m → mm per hour
    }
  }
  done++;
  if (done % 10 === 0) console.log(`${done}/${jobs.length} chunks, ${(bytes / 1e6).toFixed(0)} MB`);
}

const queue = [...jobs];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) await run(queue.shift());
}));

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((1 - p) * sorted.length))];
const out = {
  source: `ERA5 hourly total precipitation (ECMWF / Copernicus C3S), ${FIRST}–${LAST}, nearest 0.25° cell, via the Microsoft Planetary Computer (era5-pds)`,
  generated: new Date().toISOString().slice(0, 10),
  stations: Object.fromEntries(STATIONS.map((s) => {
    const c = cells.find((x) => x.id === s.id);
    return [s.id, {
      cell: [c.latCell, c.lonCell > 180 ? c.lonCell - 360 : c.lonCell],
      months: hours[s.id].map((list) => {
        const sorted = [...list].sort((a, b) => a - b);
        const wet = list.filter((v) => v >= 0.1).length / Math.max(1, list.length);
        return {
          hours: list.length,
          wet: +wet.toFixed(4), // share of hours with ≥ 0.1 mm/h
          r1: +pct(sorted, 0.01).toFixed(2), // mm/h exceeded 1 % of hours
          r01: +pct(sorted, 0.001).toFixed(2), // mm/h exceeded 0.1 % of hours
          mean: +(list.reduce((a, b) => a + b, 0) / Math.max(1, list.length)).toFixed(4),
        };
      }),
    }];
  })),
};
fs.writeFileSync(new URL('../public/data/stations-weather.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('wrote public/data/stations-weather.json', (bytes / 1e6).toFixed(0), 'MB streamed');
