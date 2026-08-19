// Alias Yoast : l'ancien WP servait /sitemap_index.xml (underscore).
// Même index que /sitemap-index.xml pour ne pas casser les URLs connues de Google.
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const base = String(site ?? 'https://prim.net').replace(/\/$/, '');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${base}/sitemap.xml</loc></sitemap>
</sitemapindex>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
