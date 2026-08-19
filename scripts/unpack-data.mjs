// Décompresse data/wp/posts.json.gz -> posts.json si le JSON n'existe pas.
// Permet de commiter le gros fichier (136 Mo) compressé (~35 Mo) sous la limite GitHub.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'wp');
const gz = path.join(DATA_DIR, 'posts.json.gz');
const out = path.join(DATA_DIR, 'posts.json');

if (fs.existsSync(out)) {
  console.log('unpack-data: posts.json déjà présent, skip');
  process.exit(0);
}
if (!fs.existsSync(gz)) {
  console.error('unpack-data: ni posts.json ni posts.json.gz trouvés');
  process.exit(1);
}
const t0 = Date.now();
fs.writeFileSync(out, zlib.gunzipSync(fs.readFileSync(gz)));
console.log(`unpack-data: posts.json décompressé (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
