// Helpers de chargement des données WordPress extraites
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'wp');

// Cache module-level : le JSON de posts pèse ~136 Mo, on ne le parse QU'UNE fois
const _dataCache = new Map();
function load(name) {
  if (_dataCache.has(name)) return _dataCache.get(name);
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    _dataCache.set(name, []);
    return [];
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  _dataCache.set(name, data);
  return data;
}

let _postsSorted = null;
export function getPosts() {
  if (_postsSorted) return _postsSorted;
  // Tri identique à WordPress : date de publication décroissante
  _postsSorted = load('posts')
    .filter((p) => p.status === 'publish')
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return _postsSorted;
}

export function getPages() {
  return load('pages').filter((p) => p.status === 'publish');
}

export function getMedia() {
  return load('media');
}

export function getCategories() {
  return load('categories');
}

export function getTags() {
  return load('tags');
}

// Image à la une d'un post (via _embed) — URL pleine taille
export function getFeaturedImage(post) {
  const media = post._embedded?.['wp:featuredmedia']?.[0];
  if (media?.source_url) return media.source_url;
  if (media?.media_details?.sizes?.large?.source_url) return media.media_details.sizes.large.source_url;
  return null;
}

// Image à la une avec taille adaptée + dimensions (CLS-safe)
// Fallback : si l'article n'a pas d'image, prend celle d'un article de la même rubrique
// (le plus récent), pour ne jamais afficher de carte sans visuel.
const _imageCache = new Map();

// Variantes générées (scripts/gen_image_variants.py) utilisées quand les tailles WP manquent.
// Le worker R2 (public/_worker.js) a un fallback : si la variante -WxH n'existe pas,
// il sert l'original → aucune casse possible.
const VARIANTS = {
  medium_large: { suffix: '-480x270.jpg', width: 480, height: 270 },
  large: { suffix: '-1200x675.jpg', width: 1200, height: 675 },
  medium: { suffix: '-480x270.jpg', width: 480, height: 270 },
};

function variantOf(media, size) {
  const src = media?.source_url ?? '';
  const v = VARIANTS[size];
  if (!v) return null;
  // Ne générer une variante que si l'extension est convertible (jpg/png/webp/avif/jpe)
  const m = src.match(/\.(jpe?g|png|webp|avif|jpe)$/i);
  if (!m) return null;
  const base = src.replace(/\.[^.]+$/, '');
  if (base.endsWith(v.suffix.replace(/\.jpg$/, ''))) return null; // déjà une variante
  return { src: `${base}${v.suffix}`, width: v.width, height: v.height };
}

function imageMetaOf(post, size) {
  const media = post._embedded?.['wp:featuredmedia']?.[0];
  const sizes = media?.media_details?.sizes ?? {};
  const pick = sizes[size] ?? sizes.large ?? sizes.full ?? {};
  // srcset responsive (utilisé pour le hero) : variante 480w sur mobile, 1200w sinon
  const srcsetOf = (src) => {
    if (size !== 'large' || !src) return undefined;
    const ml = variantOf(media, 'medium_large');
    if (ml && ml.src && ml.src !== src) return `${ml.src} 480w, ${src} 1200w`;
    return undefined;
  };
  if (pick.source_url) {
    return {
      src: pick.source_url,
      srcset: srcsetOf(pick.source_url),
      width: pick.width ?? sizes.full?.width ?? null,
      height: pick.height ?? sizes.full?.height ?? null,
      alt: media?.alt_text ?? '',
      caption: media?.caption?.rendered ?? '',
    };
  }
  const variant = variantOf(media, size);
  if (variant) {
    return { ...variant, srcset: srcsetOf(variant.src), alt: media?.alt_text ?? '', caption: media?.caption?.rendered ?? '' };
  }
  return {
    src: media?.source_url ?? '',
    width: null,
    height: null,
    alt: media?.alt_text ?? '',
    caption: media?.caption?.rendered ?? '',
  };
}

export function getImageMeta(post, size = 'medium_large') {
  const meta = imageMetaOf(post, size);
  if (meta.src) return meta;
  const cats = getPostCategories(post);
  const key = cats.map((c) => c.id).sort((a, b) => a - b).join(',') || 'aucune';
  if (!_imageCache.has(key)) {
    const source = getPosts().find(
      (p) => p.slug !== post.slug && getPostCategories(p).some((pc) => cats.some((c) => c.id === pc.id)) && imageMetaOf(p, size).src
    );
    _imageCache.set(key, source ? imageMetaOf(source, size) : { src: '', width: null, height: null, alt: '', caption: '' });
  }
  return _imageCache.get(key);
}

export function getImageSrc(post, size = 'medium_large') {
  return getImageMeta(post, size).src || null;
}

// Catégories d'un post (nom + slug, depuis _embed) — mémoïsé par post (coût regex élevé)
const _catsCache = new WeakMap();
export function getPostCategories(post) {
  if (_catsCache.has(post)) return _catsCache.get(post);
  const groups = post._embedded?.['wp:term'] ?? [];
  const cats = groups.find((g) => Array.isArray(g) && g[0]?.taxonomy === 'category') ?? [];
  const out = cats.map((c) => ({ id: c.id, name: decodeEntities(c.name ?? ''), slug: c.slug }));
  _catsCache.set(post, out);
  return out;
}

// Index posts-par-catégorie, construit une seule fois (16 737 posts × 609 cats)
let _postsByCat = null;
export function getPostsByCategory(catId) {
  if (_postsByCat) return _postsByCat.get(catId) ?? [];
  _postsByCat = new Map();
  for (const p of getPosts()) {
    for (const c of getPostCategories(p)) {
      if (!_postsByCat.has(c.id)) _postsByCat.set(c.id, []);
      _postsByCat.get(c.id).push(p);
    }
  }
  return _postsByCat.get(catId) ?? [];
}

export function getPostAuthor(post) {
  return decodeEntities(post._embedded?.author?.[0]?.name ?? 'Prim.net');
}

// Temps de lecture estimé (~200 mots/min)
export function getReadingTime(post) {
  const words = stripHtml(post.content?.rendered ?? '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

// Décodage des entités HTML (les champs WP sont encodés: &#039; &amp; ...)
export function decodeEntities(str = '') {
  return str
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…');
}

// Texte brut d'un champ HTML rendu par WP
export function stripHtml(html = '') {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

// Nombre d'articles par page (identique au réglage WordPress prim.net)
export const PAGE_SIZE = 12;

// ============================================================
// Multilingue — le site prim.net publie dans 12 langues.
// La langue d'un article est déduite du suffixe de ses catégories
// (ex: actualites-en -> en, noticias-es -> es) ou d'un slug encodé arabe.
// ============================================================
export const LANGS = [
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'pl', label: 'Polski', flag: '🇵🇱' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' },
  { code: 'pt', label: 'Português', flag: '🇵🇹' },
  { code: 'tr', label: 'Türkçe', flag: '🇹🇷' },
  { code: 'nn', label: 'Norsk', flag: '🇳🇴' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
];

const _LANG_SUFFIX = /-(en|es|de|it|pl|ar|nl|pt|tr|nn|ru|fr)$/;

let _catLangMap = null;
function catLangMap() {
  if (_catLangMap) return _catLangMap;
  _catLangMap = new Map();
  for (const c of getCategories()) {
    const slug = c.slug || '';
    let lang = 'fr';
    const m = slug.match(_LANG_SUFFIX);
    if (m) {
      lang = m[1];
    } else if (slug.includes('%')) {
      try {
        if (/[\u0600-\u06FF]/.test(decodeURIComponent(slug))) lang = 'ar';
      } catch { /* slug invalide -> fr */ }
    }
    _catLangMap.set(c.id, lang);
  }
  return _catLangMap;
}

// Langue d'un article : première catégorie à suffixe non-fr explicite, sinon fr
export function getPostLang(post) {
  const cats = getPostCategories(post);
  for (const c of cats) {
    const l = catLangMap().get(c.id);
    if (l && l !== 'fr') return l;
  }
  return 'fr';
}

// Langue d'une catégorie (depuis son slug)
export function getCategoryLang(cat) {
  return catLangMap().get(cat.id) ?? 'fr';
}
