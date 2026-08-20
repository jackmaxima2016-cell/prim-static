// Servir les images /wp-content/* depuis R2 (bucket prim-images)
// Les URLs restent identiques à celles de l'ancien WP (SEO intact).
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Redirections 301 (anciens slugs)
    const REDIRECTS = {
      '/pigeonetta-depigeonnage-defeutrage/': '/pigeonetta-depigeonnage-defientage/',
    };
    if (REDIRECTS[url.pathname]) {
      return Response.redirect(new URL(REDIRECTS[url.pathname], url.origin), 301);
    }
    if (url.pathname.startsWith('/wp-content/')) {
      // Décoder l'URL : les noms de fichiers accentués arrivent encodés (%C3%A0),
      // alors que les clés R2 sont stockées décodées (caractères UTF-8 réels).
      let key;
      try {
        key = decodeURIComponent(url.pathname.slice(1));
      } catch (e) {
        key = url.pathname.slice(1);
      }
      let obj = await env.IMAGES.get(key);
      // Fallback : variantes de taille -WxH manquantes -> servir l'original
      if (obj === null) {
        const m = key.match(/^(.+)-(\d{2,4})x(\d{2,4})(\.\w+)$/);
        if (m) {
          obj = await env.IMAGES.get(m[1] + m[4]);
        }
      }
      if (obj === null) {
        return new Response('Not Found', { status: 404 });
      }
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(obj.body, { headers });
    }
    // Tout le reste : assets statiques du site
    return env.ASSETS.fetch(request);
  },
};
