#!/usr/bin/env node
/**
 * publish-article.mjs — Publication d'un article sur prim.net SANS rebuild complet.
 *
 * Pipeline incrémental :
 *   1. Ajoute le post à data/wp/posts.json + régénère posts.json.gz + audit_prim.json
 *   2. Build partiel Astro (PUBLISH_ONLY=<slug>) : une + listings + nouvel article + pages statiques
 *   3. Fusion avec le dist précédent (dist-prev) : les articles inchangés sont copiés, pas régénérés
 *   4. Contrat SEO bloquant
 *   5. Déploiement direct Cloudflare Pages (token PRIM, pas de CI)
 *
 * Usage :
 *   node scripts/publish-article.mjs \
 *     --title "Titre de l'article" \
 *     --slug mon-slug-seo \
 *     --category 5 \
 *     --content-file /tmp/article.html \
 *     --seo-title "Title SEO <60 chars" \
 *     --seo-desc "Meta description <160 chars" \
 *     --excerpt "Résumé pour les listings" \
 *     --featured /wp-content/uploads/2026/08/image.jpg \
 *     [--date "2026-08-20 10:00:00"] [--no-deploy] [--no-push]
 *
 * Exit 0 = publié. Exit != 0 = échec (message en stderr).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data', 'wp');
const POSTS_JSON = path.join(DATA, 'posts.json');
const POSTS_GZ = path.join(DATA, 'posts.json.gz');
const AUDIT = path.join(ROOT, 'data', 'audit_prim.json');
const DIST = path.join(ROOT, 'dist');
const DIST_PREV = path.join(ROOT, 'dist-prev');
const SITE = 'https://prim.net';

function arg(name, def = null) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1 || i + 1 >= process.argv.length) return def;
  const v = process.argv[i + 1];
  if (v.startsWith('--')) return def;
  return v;
}
const has = (name) => process.argv.includes('--' + name);

function log(msg) { console.log(`[publish] ${msg}`); }
function die(msg) { console.error(`[publish] ❌ ${msg}`); process.exit(1); }

// ── 0. Arguments ────────────────────────────────────────────────
const title = arg('title', '').trim();
const slug = arg('slug', '').trim();
const catId = Number(arg('category', '5'));
const contentFile = arg('content-file', '');
const seoTitle = arg('seo-title', '');
const seoDesc = arg('seo-desc', '');
const excerpt = arg('excerpt', '');
const featured = arg('featured', '');
const date = arg('date', null);
const doDeploy = !has('no-deploy');
const doPush = !has('no-push');
const doUpdate = has('update'); // met à jour un post existant (même slug) au lieu d'en créer un nouveau

if (!title || !slug || !contentFile) die('--title, --slug et --content-file sont requis');
if (!fs.existsSync(contentFile)) die(`fichier contenu introuvable: ${contentFile}`);
const html = fs.readFileSync(contentFile, 'utf-8').trim();
if (html.length < 200) die('contenu trop court (<200 chars)');
if (!/^[a-z0-9-]+$/.test(slug)) die(`slug invalide (attendu: a-z0-9-): ${slug}`);

// ── 1. Mise à jour des données ──────────────────────────────────
const posts = JSON.parse(fs.readFileSync(POSTS_JSON, 'utf-8'));
const existing = posts.find((p) => p.slug === slug);
if (doUpdate && !existing) die(`--update : slug introuvable: ${slug}`);
if (!doUpdate && existing) die(`slug déjà utilisé: ${slug} (ajoutez --update pour remplacer)`);
const maxId = Math.max(...posts.map((p) => p.id));
const newId = existing ? existing.id : maxId + 1;

const now = date || new Date().toISOString().replace('T', ' ').slice(0, 19);
const newPost = {
  id: newId,
  date: existing ? existing.date : now,
  slug,
  status: 'publish',
  type: 'post',
  title: { rendered: title },
  content: { rendered: html },
  excerpt: { rendered: excerpt },
  seo_title: seoTitle || null,
  seo_desc: seoDesc || null,
  categories: [catId],
  _embedded: {
    'wp:term': [[{ id: catId, name: '', slug: '', taxonomy: 'category' }]],
    author: [{ name: 'Prim.net' }],
    'wp:featuredmedia': featured ? [{ source_url: featured, alt_text: '' }] : [],
  },
};
// Compléter le nom/slug de la catégorie depuis categories.json
try {
  const cats = JSON.parse(fs.readFileSync(path.join(DATA, 'categories.json'), 'utf-8'));
  const c = cats.find((x) => x.id === catId);
  if (c) newPost._embedded['wp:term'][0][0] = { id: catId, name: c.name, slug: c.slug, taxonomy: 'category' };
} catch { /* catégorie inconnue → on laisse tel quel */ }

if (existing) {
  posts[posts.indexOf(existing)] = newPost;
  log(`post #${newId} "${slug}" mis à jour (${posts.length} posts)`);
} else {
  posts.unshift(newPost);
  log(`post #${newId} "${slug}" ajouté (${posts.length} posts)`);
}
fs.writeFileSync(POSTS_JSON, JSON.stringify(posts, null, 1));
fs.writeFileSync(POSTS_GZ, zlib.gzipSync(JSON.stringify(posts, null, 1), { level: 9 }));
log(`post #${newId} "${slug}" ${existing ? 'mis à jour' : 'ajouté'} (${posts.length} posts, gz ${(fs.statSync(POSTS_GZ).size / 1e6).toFixed(1)} Mo)`);

// Audit SEO : l'URL du nouvel article (title/canonical/h1 vérifiés par le contrat)
const canonical = `${SITE}/${slug}/`;
const audit = JSON.parse(fs.readFileSync(AUDIT, 'utf-8'));
audit.pages = audit.pages.filter((p) => p.url !== canonical);
audit.pages.push({
  url: canonical,
  final_url: canonical,
  http_status: 200,
  title: seoTitle || title,
  meta_description: seoDesc || excerpt,
  canonical,
  robots_meta: '',
  og_title: seoTitle || title,
  h1: [title],
});
fs.writeFileSync(AUDIT, JSON.stringify(audit, null, 1));
log('audit SEO mis à jour');

// ── 2. Build partiel ────────────────────────────────────────────
const hasPrev = fs.existsSync(path.join(DIST_PREV, 'index.html'));
// Toujours régénérer : une + listings + nouvel article + pages statiques
const buildEnv = { ...process.env, PUBLISH_ONLY: slug };
log(`build Astro partiel (PUBLISH_ONLY=${slug})…`);
execSync('npm run build', { cwd: ROOT, env: buildEnv, stdio: ['ignore', 'pipe', 'pipe'] });
log('build partiel terminé');

// ── 3. Fusion avec le dist précédent ────────────────────────────
if (hasPrev) {
  // Copie les fichiers du build précédent ABSENTS du nouveau dist (articles inchangés, assets)
  let copied = 0;
  for (const rel of walk(DIST_PREV)) {
    const target = path.join(DIST, rel);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(DIST_PREV, rel), target);
      copied++;
    }
  }
  log(`fusion: ${copied} fichiers réutilisés depuis dist-prev`);
} else {
  log('⚠️ aucun dist-prev → build partiel seul (premier run avec PUBLISH_ONLY)');
}

// Sauvegarde du dist actuel comme référence pour la prochaine fois
fs.rmSync(DIST_PREV, { recursive: true, force: true });
fs.cpSync(DIST, DIST_PREV, { recursive: true });
log('dist-prev mis à jour');

// ── 4. Contrat SEO bloquant ─────────────────────────────────────
log('contrat SEO…');
const contract = execSync(
  `python3 scripts/seo_contract.py data/audit_prim.json dist --posts data/wp/posts.json`,
  { cwd: ROOT, encoding: 'utf-8' }
);
if (!contract.includes('CONFORME')) die('contrat SEO : violation détectée — déploiement annulé');
const m = contract.match(/(\d+) URLs auditées — (\d+) vérifications OK — (\d+) violations/);
log(`contrat SEO ✅ ${m ? `${m[1]} URLs — ${m[2]} vérifs — ${m[3]} violations` : ''}`);

// ── 5. Déploiement direct ───────────────────────────────────────
if (doDeploy) {
  const token = readSecret('CLOUDFLARE_API_TOKEN_PRIM');
  if (!token) die('CLOUDFLARE_API_TOKEN_PRIM introuvable dans ~/migration/secrets.env');
  log('deploy Cloudflare Pages (project prim)…');
  execSync('npx wrangler pages deploy dist --project-name prim --branch main', {
    cwd: ROOT,
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: token,
      CLOUDFLARE_ACCOUNT_ID: '3388543392cfb84433c27998f292c732',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  log('deploy OK');
} else {
  log('--no-deploy : déploiement sauté');
}

// ── 6. Commit git (le push reste optionnel / CI désactivée) ─────
try {
  execSync(`git add data/wp/posts.json.gz data/audit_prim.json src/pages/"[slug].astro" && git commit -m "article: ${title.slice(0, 60)}"`, { cwd: ROOT, stdio: 'ignore' });
  if (doPush) {
    execSync('git push origin main', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    log('push OK (CI désactivée → pas de rebuild)');
  }
} catch { /* commit vide ou déjà fait */ }

log(`✅ PUBLIÉ : ${SITE}/${slug}/ (id #${newId})`);
process.exit(0);

// ── helpers ─────────────────────────────────────────────────────
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(path.relative(DIST_PREV, full).split(path.sep).join('/'));
  }
  return out;
}

function readSecret(name) {
  const f = path.join(process.env.HOME || '/home/hermes', 'migration', 'secrets.env');
  if (!fs.existsSync(f)) return null;
  for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
    if (line.startsWith(name + '=')) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
  }
  return null;
}
