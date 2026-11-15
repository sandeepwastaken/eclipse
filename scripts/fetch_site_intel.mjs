// Site intel: recent research and news for every curated landing site, through SerpApi
// (Google Scholar + Google News). Runs once at build time, so the API key never ships.
//
//   SERPAPI_KEY=… node scripts/fetch_site_intel.mjs            (or put SERPAPI_KEY in .env.local)
//
// Two searches per site (about 50 in all); results are cached in public/data/site-intel.json.
import fs from 'node:fs';
import catalog from '../src/data/sites.json' with { type: 'json' };

const envFile = new URL('../.env.local', import.meta.url);
if (!process.env.SERPAPI_KEY && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^['"]|['"]$/g, '');
  }
}
const KEY = process.env.SERPAPI_KEY;
if (!KEY) {
  console.error('Set SERPAPI_KEY (environment or .env.local).');
  process.exit(1);
}

/** Search terms per site: precise names first, then what the place is known for. */
const TOPIC = {
  'shackleton-rim': ['Shackleton crater rim illumination', 'Shackleton crater Artemis'],
  'connecting-ridge': ['"connecting ridge" Shackleton de Gerlache illumination', 'Shackleton de Gerlache ridge Artemis'],
  'shackleton-rim-b': ['Shackleton crater rim lunar south pole landing', 'Shackleton crater Moon'],
  'peak-near-shackleton': ['peak near Shackleton lunar south pole illumination', 'lunar south pole peak sunlight'],
  'de-gerlache-rim': ['de Gerlache crater rim illumination lunar south pole', 'de Gerlache crater Artemis'],
  'de-gerlache-kocher': ['de Gerlache Kocher massif lunar', 'de Gerlache Kocher Artemis III'],
  'malapert-massif': ['Malapert massif lunar south pole', 'Malapert massif Moon landing'],
  'leibnitz-beta': ['Mons Mouton Leibnitz beta plateau', 'Mons Mouton Moon landing'],
  'nobile-rim-1': ['Nobile crater rim lunar south pole', 'Nobile crater VIPER'],
  haworth: ['Haworth crater permanently shadowed region ice', 'Haworth crater Moon'],
  'cabeus-wall': ['Cabeus crater LCROSS water ice', 'Cabeus crater Moon'],
  'amundsen-rim': ['Amundsen crater lunar south pole', 'Amundsen crater Moon'],
  'im1-odysseus': ['Odysseus IM-1 lunar landing Malapert', 'Intuitive Machines Odysseus Moon'],
  'im2-mons-mouton': ['IM-2 Athena lander Mons Mouton', 'Intuitive Machines Athena Moon'],
  'chandrayaan-3': ['Chandrayaan-3 Vikram landing site', 'Chandrayaan-3 Moon'],
  'change-4': ["Chang'e-4 Von Karman crater", "Chang'e 4 far side Moon"],
  'blue-ghost-1': ['Blue Ghost Mare Crisium landing', 'Firefly Blue Ghost Moon'],
  'apollo-11': ['Apollo 11 landing site Tranquility Base', 'Apollo 11 Moon landing site'],
  'apollo-12': ['Apollo 12 landing site Surveyor 3', 'Apollo 12 Moon'],
  'apollo-14': ['Apollo 14 Fra Mauro landing site', 'Apollo 14 Moon'],
  'apollo-15': ['Apollo 15 Hadley Rille landing site', 'Apollo 15 Moon'],
  'apollo-16': ['Apollo 16 Descartes highlands landing site', 'Apollo 16 Moon'],
  'apollo-17': ['Apollo 17 Taurus-Littrow landing site', 'Apollo 17 Moon'],
};

let used = 0;
async function serp(params) {
  const url = `https://serpapi.com/search.json?${new URLSearchParams({ ...params, api_key: KEY })}`;
  used++;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

const out = { generated: new Date().toISOString().slice(0, 10), source: 'SerpApi: Google Scholar and Google News', sites: {} };
for (const site of catalog.sites) {
  const [scholarQ, newsQ] = TOPIC[site.id] ?? [`${site.name} lunar`, `${site.name} Moon`];
  const entry = { scholarQuery: scholarQ, newsQuery: newsQ, papers: [], news: [] };
  try {
    const s = await serp({ engine: 'google_scholar', q: scholarQ, num: '5', as_ylo: '2015' });
    entry.papers = (s.organic_results ?? []).slice(0, 5).map((p) => ({
      title: p.title,
      link: p.link ?? p.resources?.[0]?.link ?? null,
      summary: p.publication_info?.summary ?? '',
      snippet: p.snippet ?? '',
      cited: p.inline_links?.cited_by?.total ?? 0,
    }));
  } catch (e) {
    console.warn(site.id, 'scholar failed', String(e).slice(0, 120));
  }
  try {
    const n = await serp({ engine: 'google_news', q: newsQ, gl: 'us', hl: 'en' });
    entry.news = (n.news_results ?? []).flatMap((x) => (x.stories ? x.stories : [x])).filter((x) => x.title && x.link).slice(0, 5).map((x) => ({
      title: x.title,
      link: x.link,
      source: x.source?.name ?? x.source ?? '',
      date: x.iso_date ?? x.date ?? '',
    }));
  } catch (e) {
    console.warn(site.id, 'news failed', String(e).slice(0, 120));
  }
  out.sites[site.id] = entry;
  console.log(`${site.id}: ${entry.papers.length} papers, ${entry.news.length} news`);
}
fs.writeFileSync(new URL('../public/data/site-intel.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`wrote public/data/site-intel.json using ${used} searches`);
