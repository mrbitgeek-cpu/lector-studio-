/* Importación: convierte un archivo del dispositivo en un libro de la
   biblioteca local. Todo el trabajo pesado (descomprimir, OCR) ocurre aquí. */

import { putBook, putContent, putFile, putAsset, patchBook, deleteBook, deleteAssets, getFile } from './db.js';
import { parseEpub } from './epub.js';
import { processPdf, PdfCancelled } from './pdfdoc.js';
import { imageToCover, uid, fileExt } from './util.js';
import { prefs } from './prefs.js';

export class ImportCancelled extends Error {}

function cleanName(name = '') {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return 'Libro sin título';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function prettyTitle(value = '') {
  const t = String(value).trim();
  if (!t) return '';
  // Los metadatos de muchos PDF vienen todo en minúsculas ("fotocopia").
  return t === t.toLowerCase() ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Código de idioma de Tesseract → código BCP 47 para las voces. */
function ocrLanguageCode(ocrLang = 'spa') {
  const base = String(ocrLang).split('+')[0].toLowerCase();
  if (base.startsWith('spa')) return 'es';
  if (base.startsWith('eng')) return 'en';
  if (base.startsWith('fra')) return 'fr';
  if (base.startsWith('deu')) return 'de';
  if (base.startsWith('por')) return 'pt';
  return 'es';
}

export async function importBookFile(file, {
  onProgress = () => {},
  shouldCancel = () => false,
  forceOcr = null,
  ocrLang = prefs.ocrLang
} = {}) {
  const ext = fileExt(file.name);
  if (ext !== 'epub' && ext !== 'pdf') {
    throw new Error('Solo puedo abrir archivos EPUB y PDF.');
  }
  if (file.size > 350 * 1024 * 1024) {
    throw new Error('El archivo supera los 350 MB. Prueba con una versión más ligera.');
  }

  const id = uid();
  const addedAt = Date.now();
  const fallbackTitle = cleanName(file.name);

  if (ext === 'epub') {
    let parsed;
    try {
      parsed = await parseEpub(file, {
        fallbackTitle,
        onProgress,
        saveAsset: async (blob, path) => {
          const assetId = `${id}::${path}`;
          await putAsset({ id: assetId, bookId: id, path, type: blob.type, blob });
          return assetId;
        }
      });
    } catch (err) {
      await deleteAssets(id).catch(() => {});
      throw err;
    }
    if (shouldCancel()) {
      await deleteBook(id);
      throw new ImportCancelled('cancelado');
    }
    const cover = await imageToCover(parsed.coverBlob);
    const book = {
      id,
      title: parsed.title || fallbackTitle,
      author: parsed.author || 'Autor desconocido',
      format: 'epub',
      fileName: file.name,
      fileType: file.type || 'application/epub+zip',
      size: file.size,
      addedAt,
      cover,
      language: parsed.languageFull || parsed.language || 'es',
      chapters: parsed.chapters.length,
      stats: parsed.stats,
      status: 'ready',
      ocr: null
    };
    await putContent(id, { source: 'epub', chapters: parsed.chapters, stats: parsed.stats });
    await putFile(id, { name: file.name, type: book.fileType, size: file.size }, file);
    await putBook(book);
    return book;
  }

  /* ------------------------------------------------------------------- PDF */
  const ocr = forceOcr == null ? prefs.ocrEnabled : forceOcr;
  const parsed = await processPdf(file, {
    ocr,
    ocrLang,
    onProgress,
    shouldCancel
  });
  if (shouldCancel()) throw new ImportCancelled('cancelado');
  if (!parsed.chapters.length) {
    throw new Error(parsed.ocrError || 'Este PDF no tiene texto reconocible. Prueba a subirlo de nuevo con más calidad.');
  }
  const cover = await imageToCover(parsed.coverBlob);
  const warning = parsed.ocrError
    || (parsed.stats?.truncatedOcr ? 'No se reconocieron todas las páginas: el libro quedó incompleto.' : '');
  const book = {
    id,
    title: prettyTitle(parsed.meta?.title) || fallbackTitle,
    author: parsed.meta?.author?.trim() || 'Documento PDF',
    format: 'pdf',
    fileName: file.name,
    fileType: file.type || 'application/pdf',
    size: file.size,
    addedAt,
    cover,
    language: ocrLanguageCode(ocrLang),
    chapters: parsed.chapters.length,
    stats: parsed.stats,
    totalPages: parsed.stats.pages,
    status: 'ready',
    warning,
    ocr: parsed.ocrPages ? { pages: parsed.ocrPages, lang: ocrLang, engine: 'tesseract' } : null
  };
  await putContent(id, {
    source: 'pdf',
    chapters: parsed.chapters,
    stats: parsed.stats,
    ocrLang: parsed.ocrPages ? ocrLang : null
  });
  await putFile(id, { name: file.name, type: book.fileType, size: file.size }, file);
  await putBook(book);
  return book;
}

export async function reocrBook(book, {
  onProgress = () => {},
  shouldCancel = () => false,
  ocrLang = prefs.ocrLang
} = {}) {
  const stored = await getFile(book.id);
  if (!stored?.blob) throw new Error('Falta el PDF original en este dispositivo.');
  const parsed = await processPdf(stored.blob, { ocr: true, ocrLang, onProgress, shouldCancel });
  if (shouldCancel()) throw new ImportCancelled('cancelado');
  if (!parsed.chapters.length) throw new Error(parsed.ocrError || 'No se reconoció texto en este PDF.');
  await putContent(book.id, {
    source: 'pdf',
    chapters: parsed.chapters,
    stats: parsed.stats,
    ocrLang
  });
  const cover = await imageToCover(parsed.coverBlob);
  return patchBook(book.id, {
    cover: cover || book.cover,
    chapters: parsed.chapters.length,
    stats: parsed.stats,
    totalPages: parsed.stats.pages,
    warning: parsed.ocrError || '',
    ocr: parsed.ocrPages ? { pages: parsed.ocrPages, lang: ocrLang, engine: 'tesseract' } : book.ocr
  });
}
