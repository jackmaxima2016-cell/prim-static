// Pages Function — POST /api/checkout
// 1. Vérifie le token Cloudflare Turnstile
// 2. Recalcule le total côté serveur (jamais confiance au client)
// 3. Crée une session de paiement Stripe Checkout et renvoie l'URL de redirection
//    → sans STRIPE_SECRET_KEY (env Pages), repli : email direct FormSubmit (comportement provisoire)
// Zéro secret dans le dépôt : TURNSTILE_SECRET et STRIPE_SECRET_KEY sont injectés par Cloudflare Pages.

const FORM_MAILTO = 'contact@prim.net';
const SITE = 'https://prim.net';

// Source de vérité des prix (doit correspondre au formulaire)
// Prix promotionnels (−46 % ; le prix d'origine barré est affiché côté formulaire)
const PACKS = { Essentiel: 91, Standard: 215, Premium: 431, Impact: 809 };
const DUREES = { '1 an': 0, '5 ans': 20, '10 ans': 50, 'À vie': 40 };
const OPTIONS = {
  opt_redaction: { label: 'Rédaction par nos soins', price: 71 },
  opt_lien: { label: 'Lien supplémentaire', price: 23 },
  opt_express: { label: 'Publication express 24 h', price: 47 },
  opt_reseaux: { label: 'Post LinkedIn + Facebook', price: 23 },
  opt_newsletter: { label: 'Mise en avant newsletter', price: 38 },
  opt_article: { label: 'Article additionnel', price: 95 },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifyTurnstile(env, token) {
  if (!env.TURNSTILE_SECRET) return { ok: false, message: 'Anti-robot non configuré.' };
  if (!token) return { ok: false, message: 'Veuillez compléter la vérification anti-robot.' };
  const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token }),
  }).then((r) => r.json());
  if (!v.success) return { ok: false, message: 'Vérification anti-robot échouée, réessayez.' };
  return { ok: true };
}

// Repli : envoi direct par email (utilisé tant que STRIPE_SECRET_KEY n'est pas définie)
async function sendMailFallback(data, formData) {
  const fd = new FormData();
  Object.entries(data).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== false) fd.append(k, String(v)); });
  formData.forEach((v, k) => fd.append(k, String(v)));
  const res = await fetch(`https://formsubmit.co/ajax/${FORM_MAILTO}`, {
    method: 'POST',
    headers: { Accept: 'application/json', Origin: SITE, Referer: `${SITE}/contact/` },
    body: fd,
  });
  const out = await res.json().catch(() => ({}));
  return out.success === 'true';
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const data = await request.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      return json({ success: 'false', message: 'Données invalides.' }, 400);
    }

    // Honeypot
    if (data._honey) {
      return json({ success: 'false', message: 'Soumission rejetée.' }, 400);
    }

    // Turnstile
    const ts = await verifyTurnstile(env, data['cf-turnstile-response'] || '');
    if (!ts.ok) return json({ success: 'false', message: ts.message }, 400);

    // Champs obligatoires
    const nom = String(data.nom || '').trim();
    const email = String(data.email || '').trim();
    const site = String(data.site || '').trim();
    if (!nom || !email || !site) {
      return json({ success: 'false', message: 'Veuillez remplir tous les champs obligatoires.' }, 400);
    }

    // Recalcul du total côté serveur
    const packName = String(data.pack || '');
    const packPrice = PACKS[packName];
    if (!packPrice) {
      return json({ success: 'false', message: 'Pack invalide.' }, 400);
    }
    let total = packPrice;
    const chosen = [];
    // Options quantifiables (lien / article additionnel) : 1 à 3 unités, prix × quantité
    const QTY_MAX = { opt_lien: 3, opt_article: 3 };
    const qtyOf = (name) => {
      const raw = parseInt(data[`${name}_qty`], 10);
      if (!Number.isFinite(raw) || raw < 1) return 1;
      return Math.min(raw, QTY_MAX[name] || 3);
    };
    for (const [name, opt] of Object.entries(OPTIONS)) {
      if (data[name] === true || data[name] === 'true' || data[name] === 'on') {
        const qty = QTY_MAX[name] ? qtyOf(name) : 1;
        total += opt.price * qty;
        chosen.push(qty > 1 ? `${opt.label} ×${qty}` : opt.label);
      }
    }
    const duree = String(data.duree || 'À vie');
    const dureePrice = DUREES[duree];
    if (dureePrice === undefined) {
      return json({ success: 'false', message: 'Durée invalide.' }, 400);
    }
    total += dureePrice;
    const entreprise = String(data.entreprise || '');
    const telephone = String(data.telephone || '');
    const rubrique = String(data.rubrique || '');
    const sujet = String(data.sujet || '');
    const message = String(data.message || '');
    // Champs conditionnels (liés aux options choisies dans le formulaire)
    // Les options quantifiées envoient un tableau (une entrée par unité achetée)
    const toList = (v) => (Array.isArray(v) ? v : v !== undefined && v !== null && v !== '' ? [v] : [])
      .map((x) => String(x).trim()).filter(Boolean);
    const optLienUrls = toList(data.opt_lien_urls || data.opt_lien_url).join(' | ');
    const optReseauxComptes = String(data.opt_reseaux_comptes || '').trim();
    const optArticleSujets = toList(data.opt_article_sujets || data.opt_article_sujet).join(' | ');
    const optRedactionAngle = String(data.opt_redaction_angle || '').trim();

    // ---- Pas de clé Stripe : repli email (provisoire) ----
    if (!env.STRIPE_SECRET_KEY) {
      const ok = await sendMailFallback(
        { pack: packName, duree, total: `${total} EUR`, nom, email, entreprise, telephone, rubrique, site, sujet, message, options: chosen.join(', '), lien_supplementaire: optLienUrls, comptes_reseaux: optReseauxComptes, sujet_article_additionnel: optArticleSujets, angle_redaction: optRedactionAngle },
        new FormData()
      );
      return ok
        ? json({ success: 'true', fallback: true, message: 'Demande envoyée.' })
        : json({ success: 'false', message: 'Erreur du relais email, réessayez dans un instant.' }, 502);
    }

    // ---- Stripe Checkout Session ----
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('currency', 'eur');
    params.set('customer_email', email);
    params.set('success_url', `${SITE}/contact/merci/?session_id={CHECKOUT_SESSION_ID}`);
    params.set('cancel_url', `${SITE}/contact/`);
    params.set('metadata[pack]', packName);
    params.set('metadata[duree]', duree);
    params.set('metadata[nom]', nom);
    params.set('metadata[email]', email);
    params.set('metadata[entreprise]', entreprise.slice(0, 200));
    params.set('metadata[telephone]', telephone.slice(0, 60));
    params.set('metadata[rubrique]', rubrique.slice(0, 120));
    params.set('metadata[site]', site.slice(0, 200));
    params.set('metadata[sujet]', sujet.slice(0, 480));
    params.set('metadata[lien_supplementaire]', optLienUrls.slice(0, 480));
    params.set('metadata[comptes_reseaux]', optReseauxComptes.slice(0, 480));
    params.set('metadata[sujet_article_additionnel]', optArticleSujets.slice(0, 480));
    params.set('metadata[angle_redaction]', optRedactionAngle.slice(0, 480));
    params.set('metadata[options]', chosen.join(', ').slice(0, 480));
    params.set('metadata[total]', `${total} EUR`);

    const items = [
      { name: `Pack ${packName} — prim.net`, price: packPrice, qty: 1 },
      ...(dureePrice > 0 ? [{ name: `Durée de publication : ${duree} — prim.net`, price: dureePrice, qty: 1 }] : []),
      ...Object.entries(OPTIONS)
        .filter(([name]) => data[name] === true || data[name] === 'true' || data[name] === 'on')
        .map(([name, opt]) => ({ name: `Option : ${opt.label}`, price: opt.price, qty: QTY_MAX[name] ? qtyOf(name) : 1 })),
    ];
    items.forEach((it, i) => {
      params.set(`line_items[${i}][quantity]`, String(it.qty));
      params.set(`line_items[${i}][price_data][currency]`, 'eur');
      params.set(`line_items[${i}][price_data][unit_amount]`, String(it.price * 100));
      params.set(`line_items[${i}][price_data][product_data][name]`, it.name);
    });

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.url) {
      return json({ success: 'false', message: 'Impossible d’initialiser le paiement, réessayez.' }, 502);
    }
    return json({ success: 'true', url: out.url });
  } catch (err) {
    return json({ success: 'false', message: 'Erreur interne, réessayez dans un instant.' }, 500);
  }
}
