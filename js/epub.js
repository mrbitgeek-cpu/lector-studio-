/* Lector de EPUB: descomprime, lee el OPF y convierte cada capítulo en
   bloques de texto limpios (párrafos, títulos, listas, imágenes).
   No usa el CSS del libro: la tipografía la decide LectorStudio para que
   todos los libros se lean igual de bien y la lectura en voz alta sea estable. */

import { escapeHtml, normalizeSpace } from './util.js';

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'figcaption', 'dd', 'dt', 'td', 'th']);
const CONTAINER_TAGS = new Set(['body', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav', 'ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'figure', 'center', 'form']);
const INLINE_OK = new Set(['em', 'i', 'strong', 'b', 'u', 's', 'small', 'sup', 'sub', 'code', 'br', 'span', 'mark', 'abbr', 'cite', 'q']);
const DROP_TAGS = new Set(['script', 'style', 'img', 'svg', 'video', 'audio', 'iframe', 'object', 'embed', 'link', 'meta', 'input', 'button', 'select', 'textarea']);

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif'
};

function elements(root, name) {
  const out = [];
  const all = root.getElementsByTagName('*');
  for (const el of all) {
    if (el.localName === name) out.push(el);
  }
  return out;
}

function first(root, name) {
  const all = root.getElementsByTagName('*');
  for (const el of all) if (el.localName === name) return el;
  return null;
}

function parseMarkup(text) {
  let doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || !doc.documentElement) {
    doc = new DOMParser().parseFromString(text, 'text/html');
  }
  return doc;
}

function dirname(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}

function resolvePath(baseDir, href) {
  const clean = String(href || '').split('#')[0].trim();
  if (!clean) return '';
  try {
    const url = new URL(clean, 'http://epub.local/' + baseDir);
    return decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    return (baseDir + clean).replace(/\/\.\//g, '/');
  }
}

function findEntry(zip, path) {
  if (!path) return null;
  return zip.file(path)
    || zip.file(decodeURIComponent(path))
    || zip.file(path.normalize('NFC'))
    || null;
}

function mimeFor(path, fallback = '') {
  const ext = String(path).split('.').pop().toLowerCase();
  return MIME[ext] || fallback || 'application/octet-stream';
}

/** Convierte el contenido en línea a HTML seguro, sin atributos ni enlaces. */
function sanitizeInline(node) {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      out += escapeHtml(child.nodeValue);
    } else if (child.nodeType === 1) {
      const tag = (child.localName || child.tagName || '').toLowerCase();
      if (DROP_TAGS.has(tag) || tag === 'a') { out += sanitizeInline(child); continue; }
      if (INLINE_OK.has(tag)) {
        if (tag === 'br') { out += ' <br>'; continue; }
        out += `<${tag}>${sanitizeInline(child)}</${tag}>`;
      } else {
        out += sanitizeInline(child);
      }
    }
  }
  return out;
}

function hasBlockChild(el) {
  for (const child of el.children) {
    const tag = (child.localName || child.tagName || '').toLowerCase();
    if (BLOCK_TAGS.has(tag) || CONTAINER_TAGS.has(tag)) return true;
  }
  return false;
}

function blockKind(tag) {
  if (/^h[1-6]$/.test(tag)) return tag;
  if (tag === 'li') return 'li';
  if (tag === 'blockquote') return 'quote';
  if (tag === 'pre') return 'pre';
  if (tag === 'figcaption') return 'caption';
  return 'p';
}

export async function parseEpub(blob, { saveAsset, onProgress = () => {}, fallbackTitle = 'Libro sin título' } = {}) {
  if (typeof JSZip === 'undefined') throw new Error('Falta el lector de archivos (JSZip).');
  onProgress({ phase: 'Abriendo el EPUB', progress: 0.02 });
  const zip = await JSZip.loadAsync(blob);

  const containerFile = findEntry(zip, 'META-INF/container.xml');
  if (!containerFile) throw new Error('El archivo no es un EPUB válido: falta META-INF/container.xml.');
  const container = parseMarkup(await containerFile.async('string'));
  const rootfile = first(container, 'rootfile');
  const opfPath = rootfile?.getAttribute('full-path');
  if (!opfPath) throw new Error('El EPUB no declara el archivo OPF.');
  const opfFile = findEntry(zip, opfPath);
  if (!opfFile) throw new Error('No encontré el contenido del EPUB (OPF).');

  const opfDir = dirname(opfPath);
  const opf = parseMarkup(await opfFile.async('string'));

  const title = normalizeSpace(first(opf, 'title')?.textContent) || fallbackTitle;
  const author = normalizeSpace(first(opf, 'creator')?.textContent) || 'Autor desconocido';
  const language = normalizeSpace(first(opf, 'language')?.textContent) || 'es';
  const publisher = normalizeSpace(first(opf, 'publisher')?.textContent);
  const description = normalizeSpace(first(opf, 'description')?.textContent);

  const items = new Map();
  for (const el of elements(opf, 'item')) {
    const id = el.getAttribute('id');
    if (!id) continue;
    items.set(id, {
      id,
      href: el.getAttribute('href') || '',
      type: el.getAttribute('media-type') || '',
      properties: el.getAttribute('properties') || ''
    });
  }

  const spineEl = first(opf, 'spine');
  const spineIds = [];
  for (const el of elements(spineEl || opf, 'itemref')) {
    if (el.getAttribute('linear') === 'no') continue;
    const idref = el.getAttribute('idref');
    if (idref) spineIds.push(idref);
  }
  if (!spineIds.length) throw new Error('El EPUB no tiene capítulos en el orden de lectura (spine).');

  /* ---------------------------------------------------------------- índice */
  const tocByPath = new Map();
  const addToc = (href, label, baseDir) => {
    const path = resolvePath(baseDir, href);
    const clean = normalizeSpace(label);
    if (path && clean && !tocByPath.has(path)) tocByPath.set(path, clean);
  };

  const navItem = [...items.values()].find((it) => (it.properties || '').split(/\s+/).includes('nav'));
  if (navItem) {
    try {
      const navFile = findEntry(zip, resolvePath(opfDir, navItem.href));
      if (navFile) {
        const navDoc = parseMarkup(await navFile.async('string'));
        const navs = elements(navDoc, 'nav');
        const nav = navs.find((n) => {
          const t = n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '';
          return t === 'toc';
        }) || navs[0];
        if (nav) {
          for (const a of elements(nav, 'a')) addToc(a.getAttribute('href'), a.textContent, dirname(resolvePath(opfDir, navItem.href)));
        }
      }
    } catch { /* índice opcional */ }
  }

  if (!tocByPath.size) {
    const ncxId = spineEl?.getAttribute('toc');
    const ncxItem = ncxId ? items.get(ncxId) : [...items.values()].find((it) => it.type === 'application/x-dtbncx+xml');
    if (ncxItem) {
      try {
        const ncxPath = resolvePath(opfDir, ncxItem.href);
        const ncxFile = findEntry(zip, ncxPath);
        if (ncxFile) {
          const ncx = parseMarkup(await ncxFile.async('string'));
          for (const point of elements(ncx, 'navPoint')) {
            const content = first(point, 'content');
            const label = first(point, 'text');
            addToc(content?.getAttribute('src'), label?.textContent, dirname(ncxPath));
          }
        }
      } catch { /* índice opcional */ }
    }
  }

  /* ---------------------------------------------------------------- portada */
  let coverBlob = null;
  let coverItem = null;
  const metaCover = elements(opf, 'meta').find((m) => m.getAttribute('name') === 'cover');
  if (metaCover) coverItem = items.get(metaCover.getAttribute('content'));
  if (!coverItem) coverItem = [...items.values()].find((it) => /cover-image/.test(it.properties) && /^image\//.test(it.type));
  if (!coverItem) coverItem = [...items.values()].find((it) => /^image\//.test(it.type) && /cover|portada/i.test(it.href) && !/thumb/i.test(it.href));
  if (coverItem) {
    try {
      const f = findEntry(zip, resolvePath(opfDir, coverItem.href));
      if (f) coverBlob = await f.async('blob');
      if (coverBlob) coverBlob = coverBlob.slice(0, coverBlob.size, mimeFor(coverItem.href, coverItem.type));
    } catch { coverBlob = null; }
  }

  /* --------------------------------------------------------------- capítulos */
  const saveImage = async (src, baseDir) => {
    if (!saveAsset || !src || /^https?:/i.test(src)) return null;
    try {
      if (/^data:/i.test(src)) {
        const response = await fetch(src);
        const blob = await response.blob();
        if (!/^image\//.test(blob.type) || blob.size > 6 * 1024 * 1024) return null;
        return await saveAsset(blob, `inline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      }
      const path = resolvePath(baseDir, src);
      const file = findEntry(zip, path);
      if (!file) return null;
      const raw = await file.async('blob');
      const imageBlob = raw.slice(0, raw.size, mimeFor(path, 'image/jpeg'));
      if (imageBlob.size > 6 * 1024 * 1024) return null;
      return await saveAsset(imageBlob, path);
    } catch { return null; }
  };

  const blocksFromHtml = async (doc, baseDir) => {
    const body = first(doc, 'body') || doc.documentElement;
    const blocks = [];

    const addImages = async (el) => {
      const imgs = [...el.querySelectorAll('img')];
      for (const img of imgs) {
        const src = img.getAttribute('src') || img.getAttribute('data-src');
        const id = await saveImage(src, baseDir);
        if (id) blocks.push({ t: 'img', asset: id, alt: normalizeSpace(img.getAttribute('alt')) });
      }
    };

    const addBlock = async (el, kind) => {
      const isPre = kind === 'pre';
      const rawText = isPre ? (el.textContent || '').replace(/\r\n?/g, '\n') : normalizeSpace(el.textContent);
      const html = sanitizeInline(el);
      if (rawText) {
        blocks.push({ t: kind, text: rawText, html });
      }
      await addImages(el);
    };

    const flushLoose = async (buffer) => {
      if (!buffer.html.trim()) { buffer.html = ''; buffer.text = ''; return; }
      const holder = document.createElement('div');
      holder.innerHTML = buffer.html;
      const text = normalizeSpace(holder.textContent);
      if (text) blocks.push({ t: 'p', text, html: buffer.html });
      buffer.html = '';
      buffer.text = '';
    };

    const walkContainer = async (container) => {
      const loose = { html: '', text: '' };
      for (const child of [...container.childNodes]) {
        if (child.nodeType === 3) {
          const t = child.nodeValue;
          if (t && t.trim()) loose.html += escapeHtml(t);
          continue;
        }
        if (child.nodeType !== 1) continue;
        const tag = (child.localName || child.tagName || '').toLowerCase();
        if (BLOCK_TAGS.has(tag)) {
          await flushLoose(loose);
          if (hasBlockChild(child)) await walkContainer(child);
          else await addBlock(child, blockKind(tag));
        } else if (CONTAINER_TAGS.has(tag)) {
          await flushLoose(loose);
          if (!hasBlockChild(child) && !child.querySelector('img') && normalizeSpace(child.textContent)) {
            await addBlock(child, 'p');
          } else {
            await walkContainer(child);
          }
        } else if (tag === 'img') {
          await flushLoose(loose);
          const src = child.getAttribute('src') || child.getAttribute('data-src');
          const id = await saveImage(src, baseDir);
          if (id) blocks.push({ t: 'img', asset: id, alt: normalizeSpace(child.getAttribute('alt')) });
        } else if (tag === 'br' || tag === 'hr') {
          loose.html += ' ';
          if (loose.html.replace(/<br>/g, '').trim()) loose.html += '<br>';
        } else if (DROP_TAGS.has(tag)) {
          continue;
        } else {
          loose.html += sanitizeInline(child);
        }
      }
      await flushLoose(loose);
    };

    await walkContainer(body);
    return blocks;
  };

  const chapters = [];
  let index = 0;
  const total = spineIds.length;
  for (const idref of spineIds) {
    const item = items.get(idref);
    index++;
    if (!item) continue;
    onProgress({ phase: 'Leyendo el libro', progress: 0.08 + 0.9 * (index / Math.max(1, total)), detail: item.href });
    const path = resolvePath(opfDir, item.href);
    const file = findEntry(zip, path);
    if (!file) continue;
    let blocks = [];
    try {
      const doc = parseMarkup(await file.async('string'));
      blocks = await blocksFromHtml(doc, dirname(path));
    } catch { blocks = []; }

    const meaningful = blocks.filter((b) => (b.t === 'img' ? true : (b.text || '').length > 1));
    if (!meaningful.length) continue;
    const textChars = meaningful.reduce((n, b) => n + (b.t === 'img' ? 0 : b.text.length), 0);
    if (textChars < 12 && !meaningful.some((b) => b.t === 'img')) continue;

    let tocTitle = tocByPath.get(path) || tocByPath.get(decodeURIComponent(path));
    if (!tocTitle) {
      const heading = meaningful.find((b) => /^h[1-3]$/.test(b.t) && b.text);
      if (heading) tocTitle = heading.text;
    }
    chapters.push({
      title: normalizeSpace(tocTitle) || `Capítulo ${chapters.length + 1}`,
      href: item.href,
      blocks: meaningful
    });
  }

  if (!chapters.length) throw new Error('No pude extraer texto de este EPUB. Puede estar protegido con DRM.');

  const words = chapters.reduce((n, ch) => n + ch.blocks.reduce((m, b) => m + (b.t === 'img' ? 0 : b.text.split(/\s+/).length), 0), 0);

  return {
    title: title || fallbackTitle,
    author,
    language: language.split(/[-_]/)[0] || 'es',
    languageFull: language,
    publisher,
    description,
    coverBlob,
    chapters,
    stats: { chapters: chapters.length, words },
    source: 'epub'
  };
}
