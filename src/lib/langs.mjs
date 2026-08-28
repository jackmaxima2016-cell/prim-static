// Langues des accueils par langue (anciennes URLs Polylang).
// Importé par src/pages/[lang]/index.astro (getStaticPaths doit n'utiliser que des imports).
export const LANG_CODES = ['en', 'es', 'de', 'it', 'nl', 'ar', 'tr', 'ru', 'pt', 'pl', 'nn'];

// Codes du cluster hreflang des accueils : 'fr' = la home /, puis une page /<lang>/ par langue.
export const HOME_CODES = ['fr', ...LANG_CODES];

// Liens hreflang du cluster (x-default + les 12 langues) — à passer à <Base alternates=...>.
export function homeAlternates(site) {
  const out = [{ hreflang: 'x-default', href: site + '/' }];
  for (const code of HOME_CODES) {
    out.push({ hreflang: code, href: code === 'fr' ? site + '/' : `${site}/${code}/` });
  }
  return out;
}

export const LANGS = {
  en: { title: 'Prim.net - Daily news in PRIM', desc: 'News every day in PRIM' },
  es: { title: 'Prim.net - Noticias diarias en PRIM', desc: 'Actualidad diaria en PRIM' },
  de: { title: 'Prim.net - Tägliche Nachrichten auf PRIM', desc: 'Aktuelles täglich auf PRIM' },
  it: { title: 'Prim.net - Notizie quotidiane su PRIM', desc: 'Attualità quotidiana in PRIM' },
  nl: { title: 'Prim.net - Dagelijks nieuws op PRIM', desc: 'Actualiteit elke dag in PRIM' },
  ar: { title: 'Prim.net - الأخبار اليومية على PRIM', desc: 'أخبار يومية على PRIM' },
  tr: { title: "Prim.net - PRIM'de günlük haberler", desc: "PRIM'de her gün gündem" },
  ru: { title: 'Prim.net - Ежедневные новости на PRIM', desc: 'Новости каждый день на PRIM' },
  pt: { title: 'Prim.net - Notícias diárias no PRIM', desc: 'Atualidade diária em PRIM' },
  pl: { title: 'Prim.net - Codzienne wiadomości na PRIM', desc: 'Aktualności codziennie na PRIM' },
  nn: { title: 'Prim.net - Daglege nyhende på PRIM', desc: 'Aktuelt kvar dag på PRIM' },
};
