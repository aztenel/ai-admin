import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) =>
  new Response(
    // тестовая сборка (без SITE_URL) закрыта от поисковиков целиком
    __INDEXABLE__ ? `User-agent: *\nAllow: /\n\nSitemap: ${new URL("sitemap-index.xml", site).href}\n` : "User-agent: *\nDisallow: /\n",
    {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
