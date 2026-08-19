# fluiid-static — Migration WordPress → Full HTML (SEO-safe)

Site statique Astro généré depuis l'API WordPress de **fluiid.ch**.
Migration pilote du système `/home/hermes/migration/`.

## Pipeline

```
WordPress (API REST) ──► fetch-wp ──► data/wp/*.json ──► Astro SSG ──► dist/
                                                            │
audit (référence SEO) ──► seo_contract.py ◄─────────────────┘
```

1. **Audit** (`audit/audit_site.py`) : inventaire SEO complet du WP actuel
   (146 URLs : statut, title, canonical, H1, JSON-LD, contenu).
   Référence = ce que Google voit aujourd'hui.
2. **Génération** (`npm run fetch:wp && npm run build`) : Astro reproduit
   chaque URL à l'identique — slugs, barres obliques, `/page/N/`, canonical,
   titles Yoast, JSON-LD Article/Breadcrumb/WebSite.
3. **Contrat SEO** (`seo-contract/seo_contract.py`) : compare le site généré
   à la référence, URL par URL. **Bloque la mise en prod si écart** :
   URL manquante, title/canonical/H1 différent, noindex accidentel,
   contenu d'article tronqué, article absent d'un listing.

## Commandes

```bash
npm run fetch:wp                 # extraction du contenu WordPress
npm run build                    # génération statique (dist/)
python3 ../seo-contract/seo_contract.py ../data/audit_fluiid.json dist --posts data/wp/posts.json
```

## Commandes de build Cloudflare Pages

- Build : `npm run fetch:wp && npm run build`
- Output : `dist`

## Points d'attention (TODO migration)

- **Formulaire contact** : Ninja Forms (JS requis) — à refaire en HTML natif
  ou intégré au build (pas de JS côté WordPress).
- **Images** : les URLs `/wp-content/uploads/...` sont conservées telles
  quelles (le WP continue de les servir). À la bascule : copie vers R2 ou
  redirection Cloudflare Rules, en conservant les URLs historiques.
- **robots.txt** : à reproduire dans le site statique (public/robots.txt).
- **Sitemap** : à générer (sitemap-index.xml pointé par le layout).

## Sécurité

- Jamais de secrets dans ce dépôt.
- Accès WP/GitHub/Cloudflare : fichier `/home/hermes/migration/secrets.env`
  (chmod 600), hors git.
