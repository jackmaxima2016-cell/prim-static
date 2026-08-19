// Pages Function — GET /api/confirm
// Appelée par la page /contact/merci/ après le retour de Stripe Checkout.
// 1. Récupère la session de paiement Stripe
// 2. Si payée : envoie la commande complète par email à contact@prim.net
// Zéro secret dans le dépôt : STRIPE_SECRET_KEY est injectée par Cloudflare Pages.

const FORM_MAILTO = 'contact@prim.net';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('session_id');
    if (!sessionId) return json({ ok: false, message: 'session_id manquant.' }, 400);
    if (!env.STRIPE_SECRET_KEY) return json({ ok: false, message: 'Paiement non configuré.' }, 500);

    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    const s = await res.json().catch(() => ({}));
    if (!res.ok || s.payment_status !== 'paid') {
      return json({ ok: false, message: 'Paiement non confirmé.' }, 402);
    }

    const meta = s.metadata || {};
    const total = (s.amount_total != null ? s.amount_total / 100 : null);

    // Email de commande → contact@prim.net
    const fd = new FormData();
    fd.append('_subject', '🛒 PAIEMENT REÇU — Nouvelle commande prim.net');
    fd.append('_template', 'table');
    const rows = {
      'Pack': meta.pack || '—',
      'Durée de publication': meta.duree || '—',
      'Options': meta.options || 'aucune',
      'Montant réglé': total != null ? `${total} EUR` : '—',
      'Nom': meta.nom || '—',
      'E-mail': meta.email || '—',
      'Entreprise': meta.entreprise || '—',
      'Téléphone': meta.telephone || '—',
      'Rubrique souhaitée': meta.rubrique || '—',
      'Site à mettre en avant': meta.site || '—',
      'Sujet de la publication': meta.sujet || '—',
    };
    Object.entries(rows).forEach(([k, v]) => fd.append(k, v));

    const mail = await fetch(`https://formsubmit.co/ajax/${FORM_MAILTO}`, {
      method: 'POST',
      headers: { Accept: 'application/json', Origin: 'https://prim.net', Referer: 'https://prim.net/contact/merci/' },
      body: fd,
    });
    const mailData = await mail.json().catch(() => ({}));

    return json({
      ok: true,
      total: total != null ? `${total} EUR` : '—',
      pack: meta.pack || '—',
      email: meta.email || '—',
      mailSent: mailData.success === 'true',
    });
  } catch (err) {
    return json({ ok: false, message: 'Erreur interne.' }, 500);
  }
}
