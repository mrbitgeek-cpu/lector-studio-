/* Respaldo completo de la biblioteca en un ZIP: libros originales, texto
   reconocido, portadas y marcadores. Sirve para mover la biblioteca entre
   dispositivos o para recuperarla si el navegador borra los datos. */

import { dumpAll, restoreAll } from './db.js';
import { fileExt, downloadBlob } from './util.js';

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function exportBackup(onProgress = () => {}, { download = true } = {}) {
  if (typeof JSZip === 'undefined') throw new Error('Falta JSZip para crear el respaldo.');
  const data = await dumpAll();
  const zip = new JSZip();
  const assetEntries = [];

  onProgress({ phase: 'Empaquetando libros', progress: 0.05 });
  const assetFolder = zip.folder('assets');
  let n = 0;
  for (const asset of data.assets) {
    if (!asset.blob) continue;
    const name = `a${n++}.bin`;
    assetFolder.file(name, asset.blob, { binary: true });
    assetEntries.push({ id: asset.id, bookId: asset.bookId, path: asset.path, type: asset.type, file: `assets/${name}` });
    if (n % 10 === 0) onProgress({ phase: 'Empaquetando imágenes', progress: 0.05 + 0.25 * (n / Math.max(1, data.assets.length)) });
  }

  const fileFolder = zip.folder('files');
  for (const f of data.files) {
    const ext = fileExt(f.meta?.name || '') || 'bin';
    fileFolder.file(`${f.id}.${ext}`, f.blob, { binary: true });
  }

  const manifest = {
    app: 'LectorStudio',
    version: 1,
    exportedAt: new Date().toISOString(),
    books: data.books,
    contents: data.contents,
    positions: data.positions,
    assets: assetEntries,
    files: data.files.map((f) => ({ id: f.id, meta: f.meta }))
  };
  zip.file('library.json', JSON.stringify(manifest));
  onProgress({ phase: 'Comprimiendo respaldo', progress: 0.55 });

  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE' },
    (meta) => onProgress({ phase: 'Comprimiendo respaldo', progress: 0.55 + (meta.percent / 100) * 0.44 })
  );
  const filename = `lectorstudio-respaldo-${stamp()}.zip`;
  if (download) downloadBlob(blob, filename);
  onProgress({ phase: 'Respaldo listo', progress: 1 });
  return { filename, size: blob.size, books: data.books.length, blob };
}

export async function readBackup(file) {
  if (typeof JSZip === 'undefined') throw new Error('Falta JSZip para leer el respaldo.');
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('library.json');
  if (!manifestFile) throw new Error('El archivo no parece un respaldo de LectorStudio.');
  const manifest = JSON.parse(await manifestFile.async('string'));
  if (manifest.app !== 'LectorStudio' || !Array.isArray(manifest.books)) {
    throw new Error('El respaldo no tiene el formato esperado.');
  }

  const assets = [];
  for (const a of manifest.assets || []) {
    const entry = zip.file(a.file);
    if (!entry) continue;
    const blob = await entry.async('blob');
    assets.push({ id: a.id, bookId: a.bookId, path: a.path, type: a.type || 'image/jpeg', blob });
  }
  const files = [];
  for (const f of manifest.files || []) {
    const candidates = Object.keys(zip.files).filter((p) => p.startsWith(`files/${f.id}.`));
    if (!candidates.length) continue;
    const entry = zip.file(candidates[0]);
    if (!entry) continue;
    files.push({ id: f.id, meta: f.meta, blob: await entry.async('blob') });
  }

  return {
    books: manifest.books,
    contents: manifest.contents || [],
    positions: manifest.positions || [],
    assets,
    files,
    exportedAt: manifest.exportedAt
  };
}

export async function importBackup(file, { replace = false } = {}) {
  const data = await readBackup(file);
  await restoreAll(data, { replace });
  return { books: data.books.length, assets: data.assets.length };
}
