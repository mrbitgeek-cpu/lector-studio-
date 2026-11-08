/* PDF: extrae el texto real cuando existe y, si la página es una fotocopia
   sin capa de texto, la rasteriza y la pasa por OCR (Tesseract, en el propio
   dispositivo). Guarda el texto con rectángulos normalizados para poder
   resaltar la frase que se está leyendo. */

import { clamp, normalizeSpace } from './util.js';

let pdfjsPromise = null;

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdfjs/build/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/build/pdf.worker.min.mjs', import.meta.url).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

const STANDARD_FONTS = () => new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href;

export class PdfCancelled extends Error {}

export async function openPdfDocument(blob) {
  const lib = await getPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  try {
    return await lib.getDocument({
      data,
      standardFontDataUrl: STANDARD_FONTS(),
      useSystemFonts: true
    }).promise;
  } catch (err) {
    if (err?.name === 'PasswordException') {
      throw new Error('Este PDF está protegido con contraseña. Quítale la protección y vuelve a subirlo.');
    }
    if (err?.name === 'InvalidPDFException') {
      throw new Error('El archivo PDF está dañado o no es un PDF válido.');
    }
    throw new Error('No pude abrir el PDF: ' + (err?.message || err));
  }
}

/** Une los fragmentos de texto de una página en líneas con su caja visible. */
function linesFromTextContent(textContent, viewport) {
  const raw = [];
  for (const item of textContent.items) {
    if (typeof item.str !== 'string' || !item.transform) continue;
    const m = item.transform;
    const [vx, vy] = viewport.convertToViewportPoint(m[4], m[5]);
    const fontH = Math.hypot(m[2], m[3]) || item.height || 10;
    const width = Math.max(0, item.width || 0);
    if (!item.str.trim() && width === 0) continue;

    const tolerance = Math.max(2, fontH * 0.32);
    let line = raw.find((l) => Math.abs(l.baseline - vy) <= tolerance);
    if (!line) {
      line = { baseline: vy, fontH, x0: vx, x1: vx + width, top: vy - fontH * 0.86, text: '' };
      raw.push(line);
    }
    const gap = vx - line.x1;
    if (line.text && gap > Math.max(1.2, fontH * 0.16) && !/\s$/.test(line.text) && !/^\s/.test(item.str)) {
      line.text += ' ';
    }
    line.text += item.str;
    line.x0 = Math.min(line.x0, vx);
    line.x1 = Math.max(line.x1, vx + width);
    line.fontH = Math.max(line.fontH, fontH);
    line.top = Math.min(line.top, vy - line.fontH * 0.86);
  }

  const lines = raw
    .map((l) => ({ text: l.text.replace(/\s+/g, ' ').trim(), x0: l.x0, x1: l.x1, top: l.top, h: l.fontH }))
    .filter((l) => l.text.length > 0)
    .sort((a, b) => (Math.abs(a.top - b.top) > 2 ? a.top - b.top : a.x0 - b.x0));

  // Algunos PDFs dibujan cada palabra como una línea distinta: recompón.
  const merged = [];
  for (const line of lines) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(prev.top - line.top) < Math.max(2, prev.h * 0.4) && line.x0 >= prev.x1 - prev.h * 0.6) {
      const gap = line.x0 - prev.x1;
      prev.text = (prev.text + (gap > prev.h * 0.12 ? ' ' : '') + line.text).replace(/\s+/g, ' ').trim();
      prev.x1 = Math.max(prev.x1, line.x1);
      prev.h = Math.max(prev.h, line.h);
    } else {
      merged.push({ ...line });
    }
  }
  return merged;
}

/** Agrupa líneas en párrafos usando huecos verticales y líneas cortas. */
function groupParagraphs(lines, pageWidth, pageHeight) {
  if (!lines.length) return [];
  const sorted = [...lines].sort((a, b) => (Math.abs(a.top - b.top) > 2 ? a.top - b.top : a.x0 - b.x0));
  const hs = sorted.map((l) => l.h).sort((a, b) => a - b);
  const median = hs[Math.floor(hs.length / 2)] || 12;
  const paragraphs = [];
  let current = null;

  const close = () => {
    if (!current) return;
    const text = current.text.replace(/\s+/g, ' ').trim();
    if (text.length > 1) {
      paragraphs.push({
        text,
        lines: current.lines.map((l) => ({
          text: l.text,
          x0: l.x0, x1: l.x1, top: l.top, h: l.h
        }))
      });
    }
    current = null;
  };

  const start = (line) => ({
    x0: line.x0, x1: line.x1, top: line.top, bottom: line.top + line.h,
    text: line.text, lines: [{ ...line }]
  });

  for (const line of sorted) {
    if (!current) { current = start(line); continue; }
    const prev = current.lines[current.lines.length - 1];
    const gap = line.top - (prev.top + prev.h);
    const endsSentence = /[.!?…:;»”"']\s*$/.test(prev.text);
    const shortPrev = prev.x1 < pageWidth * 0.74;
    const indent = line.x0 > current.x0 + median * 0.8;
    const newParagraph = gap > median * 0.85 || gap < -median * 0.6
      || (endsSentence && shortPrev && gap > median * 0.25)
      || (indent && gap > median * 0.32 && endsSentence);

    if (newParagraph) {
      close();
      current = start(line);
    } else {
      current.text += ' ' + line.text;
      current.lines.push({ ...line });
      current.x0 = Math.min(current.x0, line.x0);
      current.x1 = Math.max(current.x1, line.x1);
      current.bottom = Math.max(current.bottom, line.top + line.h);
    }
  }
  close();
  return paragraphs;
}

/** Líneas OCR (píxeles del canvas) → mismo formato que las de texto. */
function linesFromOcr(data, W, H) {
  if (Array.isArray(data.lines) && data.lines.length) {
    return data.lines
      .map((line) => {
        const t = normalizeSpace(line.text);
        const b = line.bbox || {};
        if (!t || b.x1 == null) return null;
        return { text: t, x0: b.x0, x1: b.x1, top: b.y0, h: Math.max(4, b.y1 - b.y0) };
      })
      .filter(Boolean)
      .sort((a, b) => a.top - b.top || a.x0 - b.x0);
  }

  const words = (data.words || []).filter((w) => normalizeSpace(w.text) && w.bbox);
  const groups = [];
  for (const w of words.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)) {
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    const h = Math.max(4, w.bbox.y1 - w.bbox.y0);
    let line = groups.find((g) => Math.abs(g.cy - cy) < Math.max(h, g.h) * 0.55);
    if (!line) {
      line = { cy, h, items: [] };
      groups.push(line);
    }
    line.items.push(w);
    line.cy = (line.cy + cy) / 2;
  }
  const lines = groups.map((g) => {
    const items = g.items.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    return {
      text: items.map((w) => normalizeSpace(w.text)).join(' '),
      x0: Math.min(...items.map((w) => w.bbox.x0)),
      x1: Math.max(...items.map((w) => w.bbox.x1)),
      top: Math.min(...items.map((w) => w.bbox.y0)),
      h: Math.max(...items.map((w) => w.bbox.y1)) - Math.min(...items.map((w) => w.bbox.y0))
    };
  });
  return lines.filter((l) => l.text).sort((a, b) => a.top - b.top || a.x0 - b.x0);
}

function buildBlocks(paragraphs, W, H) {
  const norm = (v, d) => Math.max(0, Math.min(1, v / (d || 1)));
  return paragraphs.map((p) => ({
    t: 'p',
    text: p.text,
    lines: p.lines.map((line) => ({
      text: line.text,
      rect: [
        norm(line.x0, W),
        norm(line.top, H),
        norm(Math.max(1, line.x1 - line.x0), W),
        norm(Math.max(1, line.h), H)
      ]
    }))
  }));
}

function usefulText(text) {
  const t = normalizeSpace(text);
  if (t.length < 25) return false;
  const good = (t.match(/[\p{L}\p{N}]/gu) || []).length;
  return good / t.length > 0.45;
}

/* ------------------------------------------------------------------- OCR */
let ocrWorker = null;
let ocrWorkerLang = null;
let ocrProgress = null;

function ocrBase() { return new URL('../vendor', import.meta.url).href; }

export async function getOcrWorker(lang = 'spa', onStatus = () => {}) {
  if (typeof Tesseract === 'undefined') {
    throw new Error('No se cargó el motor de OCR. Recarga la página.');
  }
  const langs = lang || 'spa';
  ocrProgress = onStatus;
  if (ocrWorker && ocrWorkerLang === langs) return ocrWorker;
  if (ocrWorker) {
    try { await ocrWorker.terminate(); } catch { /* noop */ }
    ocrWorker = null;
    ocrWorkerLang = null;
  }
  const base = ocrBase();
  const worker = await Tesseract.createWorker(langs, 1, {
    workerPath: base + '/tesseract/worker.min.js',
    corePath: base + '/tesseract-core',
    langPath: base + '/tessdata',
    logger: (m) => { if (typeof ocrProgress === 'function') ocrProgress(m); }
  });
  ocrWorker = worker;
  ocrWorkerLang = langs;
  return worker;
}

export async function terminateOcr() {
  if (ocrWorker) {
    try { await ocrWorker.terminate(); } catch { /* noop */ }
  }
  ocrWorker = null;
  ocrWorkerLang = null;
}

async function renderPageCanvas(pdf, pageNumber, targetWidth = 1650, maxScale = 3.2) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = clamp(targetWidth / base.width, 1.5, maxScale);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, background: '#ffffff' }).promise;
  page.cleanup?.();
  return canvas;
}

/* --------------------------------------------------------------- importación */

/**
 * Procesa un PDF completo.
 */
export async function processPdf(blob, {
  ocr = true,
  ocrLang = 'spa',
  onProgress = () => {},
  shouldCancel = () => false,
  maxOcrPages = Infinity
} = {}) {
  const pdf = await openPdfDocument(blob);
  const total = pdf.numPages;
  let meta = null;
  try {
    const md = await pdf.getMetadata();
    meta = {
      title: normalizeSpace(md?.info?.Title || ''),
      author: normalizeSpace(md?.info?.Author || '')
    };
  } catch { meta = null; }
  const chapters = [];
  let ocrPages = 0;
  let textPages = 0;
  let ocrError = '';
  let chars = 0;
  let truncatedOcr = false;

  try {
    for (let n = 1; n <= total; n++) {
      if (shouldCancel()) throw new PdfCancelled('cancelado');
      onProgress({ phase: 'Leyendo el PDF', progress: ((n - 1) / total) * 0.95, page: n, pages: total });

      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      let textContent = null;
      try { textContent = await page.getTextContent({ includeMarkedContent: false }); } catch { /* escaneado */ }
      const textLines = textContent ? linesFromTextContent(textContent, viewport) : [];
      const hasText = usefulText(textLines.map((l) => l.text).join('\n'));
      let pageLines = hasText ? textLines : [];
      let pageW = viewport.width;
      let pageH = viewport.height;
      let usedOcr = false;

      if (!hasText && ocr && !ocrError) {
        if (ocrPages >= maxOcrPages) {
          truncatedOcr = true;
        } else {
          onProgress({ phase: 'Reconociendo fotocopia', progress: ((n - 1) / total) * 0.95, page: n, pages: total, ocr: true, sub: 0 });
          let canvas = null;
          try { canvas = await renderPageCanvas(pdf, n); } catch { canvas = null; }
          if (canvas) {
            try {
              const worker = await getOcrWorker(ocrLang, (m) => {
                if (m.status === 'recognizing text') {
                  onProgress({
                    phase: 'Reconociendo fotocopia',
                    progress: ((n - 1) + m.progress) / total * 0.95,
                    page: n, pages: total, ocr: true, sub: m.progress
                  });
                } else if (m.status === 'loading language traineddata' || m.status === 'initializing tesseract') {
                  onProgress({
                    phase: m.status === 'loading language traineddata' ? 'Descargando idioma del OCR (solo la primera vez)' : 'Preparando el OCR',
                    progress: ((n - 1) / total) * 0.95, page: n, pages: total, ocr: true, sub: m.progress
                  });
                }
              });
              const data = await Promise.race([
                worker.recognize(canvas),
                new Promise((_, reject) => setTimeout(() => reject(new Error('El OCR tardó demasiado en esta página.')), 240000))
              ]);
              const ocrLines = linesFromOcr(data.data, canvas.width, canvas.height);
              if (ocrLines.length && usefulText(ocrLines.map((l) => l.text).join(' '))) {
                pageLines = ocrLines;
                pageW = canvas.width;
                pageH = canvas.height;
                usedOcr = true;
                ocrPages++;
              } else if (ocrLines.length) {
                pageLines = ocrLines;
                pageW = canvas.width;
                pageH = canvas.height;
                usedOcr = true;
                ocrPages++;
              }
            } catch (err) {
              const msg = String(err?.message || err);
              if (/traineddata|language|fetch|network|Failed to fetch|404/i.test(msg)) {
                ocrError = 'No se pudo cargar el idioma del OCR. Revisa la conexión y vuelve a intentarlo.';
              } else {
                ocrError = msg;
              }
            } finally {
              canvas.width = 0;
              canvas.height = 0;
            }
          }
        }
        if (shouldCancel()) throw new PdfCancelled('cancelado');
      }

      if (hasText) textPages++;
      const paragraphs = groupParagraphs(pageLines, pageW, pageH);
      if (paragraphs.length) {
        const pageChars = paragraphs.reduce((sum, p) => sum + p.text.length, 0);
        chars += pageChars;
        chapters.push({
          title: `Página ${n}`,
          page: n,
          ocr: usedOcr,
          width: pageW,
          height: pageH,
          blocks: buildBlocks(paragraphs, pageW, pageH)
        });
      }
      page.cleanup?.();
      await new Promise((r) => setTimeout(r, 0));
    }

    onProgress({ phase: 'Preparando la portada', progress: 0.97, page: total, pages: total });
    let coverBlob = null;
    try {
      const canvas = await renderPageCanvas(pdf, 1, 900, 2.4);
      coverBlob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85));
      canvas.width = 0;
      canvas.height = 0;
    } catch { coverBlob = null; }

    return {
      chapters,
      meta,
      stats: { pages: total, words: Math.round(chars / 5.6), chars, ocrPages, textPages, truncatedOcr },
      coverBlob,
      language: ocrLang.split('+')[0],
      ocrPages,
      textPages,
      ocrError
    };
  } finally {
    try { await pdf.destroy(); } catch { /* noop */ }
  }
}

/* --------------------------------------------------------------- render */
export async function renderPdfPage(pdf, pageNumber, canvas, maxCssWidth = 900) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssScale = Math.min(maxCssWidth / base.width, 1.8);
  const vp = page.getViewport({ scale: cssScale * dpr });
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, background: '#ffffff' }).promise;
  page.cleanup?.();
  return { width: canvas.width, height: canvas.height };
}
