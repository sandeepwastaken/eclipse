import catalog from './sites.json';

export type SiteGroup = 'south-pole' | 'missions' | 'apollo';

export interface CuratedSite {
  id: string;
  name: string;
  code: string;
  group: SiteGroup;
  lat: number;
  lon: number;
  source: keyof typeof catalog.sources;
  lander: 'clps' | 'apollo';
  blurb: string;
}

export const SITE_SOURCES = catalog.sources as Record<string, { label: string; url: string }>;
export const SITES = catalog.sites as CuratedSite[];
export const SITE_CONVENTION = catalog.convention;
export const GROUP_LABELS: Record<SiteGroup, string> = {
  'south-pole': 'South pole · NASA reference sites',
  missions: 'Recent landings',
  apollo: 'Apollo',
};

const byId = new Map(SITES.map((s) => [s.id, s]));
export const getSite = (id: string): CuratedSite | undefined => byId.get(id);
export const DEFAULT_SITE_ID = 'connecting-ridge';
export const DEFAULT_COMPARE_SITE_ID = 'shackleton-rim';
