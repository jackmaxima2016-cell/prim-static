#!/usr/bin/env python3
"""Génère des variantes redimensionnées (480x270, 1200x675) pour toutes les images
featured de prim.net et les uploade sur R2 (bucket prim-images).

Le worker R2 (public/_worker.js) a un fallback: si la variante '-WxH' manque,
il sert l'original. Donc aucune casse possible pendant la génération.

Usage: python3 scripts/gen_image_variants.py [--limit N] [--resume]
"""
import json, os, sys, io, re, time, threading
import urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

ROOT = os.path.expanduser('~/migration/prim-site')
POSTS_JSON = os.path.join(ROOT, 'data/wp/posts.json')
SECRETS = os.path.expanduser('~/migration/secrets.env')
ACCOUNT = '3388543392cfb84433c27998f292c732'
BUCKET = 'prim-images'
BASE = 'https://prim.net'
WORKERS = 12
LOG_FILE = '/tmp/gen_variants.log'

SIZES = {
    '480x270': (480, 270, 'jpeg', 78),   # cards / recents
    '1200x675': (1200, 675, 'jpeg', 80), # hero
}

def log(msg):
    line = f'[{time.strftime("%H:%M:%S")}] {msg}'
    print(line, flush=True)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')

def read_token():
    for line in open(SECRETS):
        if line.startswith('CLOUDFLARE_API_TOKEN_PRIM='):
            return line.split('=', 1)[1].strip().strip('"\'').strip()
    raise SystemExit('token PRIM introuvable')

TOKEN = read_token()

def fetch(url, timeout=45):
    # Encoder les caractères non-ASCII de l'URL (noms de fichiers accentués)
    try:
        url.encode('ascii')
    except UnicodeEncodeError:
        url = urllib.parse.quote(url, safe=':/?=&%')
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (prim-variants-builder)',
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def upload_r2(key, data, ctype='image/jpeg'):
    url = (f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/r2/buckets/{BUCKET}/'
           f'objects/{urllib.parse.quote(key, safe="")}')
    req = urllib.request.Request(url, data=data, method='PUT', headers={
        'Authorization': f'Bearer {TOKEN}',
        'Content-Type': ctype,
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status

def r2_exists(key):
    """True si l'objet existe déjà dans le bucket (évite de re-uploader)."""
    url = (f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/r2/buckets/{BUCKET}/'
           f'objects/{urllib.parse.quote(key, safe="")}')
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status == 200
    except Exception:
        return False

def process(src_url):
    """src_url: '/wp-content/uploads/2026/08/foo.jpg' → génère et upload les variantes."""
    if not src_url or src_url.endswith('.gif'):
        return None
    base = src_url.rsplit('.', 1)[0] if '.' in src_url else src_url
    ext = src_url.rsplit('.', 1)[-1].lower() if '.' in src_url else ''
    if ext not in ('jpg', 'jpeg', 'png', 'webp', 'avif', 'jpe'):
        return None
    out = []
    try:
        raw = fetch(BASE + src_url)
        im = Image.open(io.BytesIO(raw))
        im = im.convert('RGB')
    except Exception as e:
        log(f'  ⚠️ fetch/open {src_url[:80]}: {e}')
        return None
    for suffix, (w, h, fmt, q) in SIZES.items():
        key = f'{base}-{suffix}.jpg' if not base.endswith(f'-{suffix}') else f'{base}.jpg'
        rel_key = key.lstrip('/')
        if r2_exists(rel_key):
            continue  # déjà généré (passe de reprise)
        try:
            # crop center 16:9 puis resize
            iw, ih = im.size
            target_ratio = w / h
            ratio = iw / ih
            if ratio > target_ratio:
                nw = int(ih * target_ratio)
                x0 = (iw - nw) // 2
                im2 = im.crop((x0, 0, x0 + nw, ih))
            else:
                nh = int(iw / target_ratio)
                y0 = (ih - nh) // 2
                im2 = im.crop((0, y0, iw, y0 + nh))
            im2 = im2.resize((w, h), Image.LANCZOS)
            buf = io.BytesIO()
            im2.save(buf, fmt, quality=q, optimize=True)
            data = buf.getvalue()
            upload_r2(rel_key, data, 'image/jpeg')
            out.append(f'{suffix}:{len(data)}')
        except Exception as e:
            log(f'  ⚠️ variant {suffix} {key[:80]}: {e}')
    return out

def main():
    args = sys.argv[1:]
    limit = None
    if '--limit' in args:
        limit = int(args[args.index('--limit') + 1])
    posts = json.load(open(POSTS_JSON))
    urls = set()
    for p in posts:
        fm = p.get('_embedded', {}).get('wp:featuredmedia') or []
        if fm and fm[0].get('source_url'):
            urls.add(fm[0]['source_url'])
    urls = sorted(urls)
    if limit:
        urls = urls[:limit]
    log(f'images uniques à traiter: {len(urls)}')
    done, ok = 0, 0
    t0 = time.time()
    with ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(process, u): u for u in urls}
        for fut in as_completed(futs):
            done += 1
            res = fut.result()
            if res:
                ok += 1
            if done % 200 == 0:
                el = time.time() - t0
                rate = done / el
                eta = (len(urls) - done) / rate if rate else 0
                log(f'  {done}/{len(urls)} ({ok} OK) — {rate:.1f}/s — ETA {eta/60:.0f} min')
    el = time.time() - t0
    log(f'TERMINÉ: {ok}/{len(urls)} images variantes OK en {el/60:.1f} min')

if __name__ == '__main__':
    main()
