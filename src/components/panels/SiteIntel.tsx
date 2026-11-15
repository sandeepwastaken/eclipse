import { BookOpen, ExternalLink, Newspaper } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SiteRef } from '../../state/store';

interface Paper { title: string; link: string | null; summary: string; snippet: string; cited: number }
interface Story { title: string; link: string; source: string; date: string }
interface Intel {
  generated: string;
  source: string;
  sites: Record<string, { scholarQuery: string; newsQuery: string; papers: Paper[]; news: Story[] }>;
}

let intelPromise: Promise<Intel | null> | null = null;
const loadIntel = () =>
  (intelPromise ??= fetch(`${import.meta.env.BASE_URL}data/site-intel.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Intel>) : null))
    .catch(() => null));

const shortDate = (d: string) => {
  const t = Date.parse(d);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : d.split(',')[0];
};

/**
 * What the literature and the news say about the selected site: Google Scholar papers and Google
 * News stories found through SerpApi, so a planner can go from "89% sunlight" to the studies
 * behind a site in one click.
 */
export function SiteIntel({ site }: { site: SiteRef }) {
  const [intel, setIntel] = useState<Intel | null>(null);
  useEffect(() => {
    void loadIntel().then(setIntel);
  }, []);
  if (site.kind !== 'curated' || !intel) return null;
  const s = intel.sites[site.id];
  if (!s || (!s.papers.length && !s.news.length)) return null;
  return (
    <details className="section disclosure intel">
      <summary>Research &amp; news</summary>
      {s.papers.length > 0 && (
        <div className="intel-group">
          <div className="intel-h"><BookOpen size={12} /> Papers</div>
          {s.papers.slice(0, 4).map((p, i) => (
            <a key={i} className="intel-item" href={p.link ?? `https://scholar.google.com/scholar?q=${encodeURIComponent(p.title)}`} target="_blank" rel="noreferrer">
              <span className="intel-title">{p.title}</span>
              <span className="intel-meta">{p.summary}{p.cited ? ` · cited by ${p.cited}` : ''}</span>
            </a>
          ))}
        </div>
      )}
      {s.news.length > 0 && (
        <div className="intel-group">
          <div className="intel-h"><Newspaper size={12} /> In the news</div>
          {s.news.slice(0, 4).map((n, i) => (
            <a key={i} className="intel-item" href={n.link} target="_blank" rel="noreferrer">
              <span className="intel-title">{n.title}</span>
              <span className="intel-meta">{n.source}{n.date ? ` · ${shortDate(n.date)}` : ''}</span>
            </a>
          ))}
        </div>
      )}
      <p className="note" style={{ marginTop: 8 }}>
        Found with <a href="https://serpapi.com" target="_blank" rel="noreferrer">SerpApi <ExternalLink size={10} /></a> (Google Scholar, Google News), {intel.generated}.
      </p>
    </details>
  );
}
