/* Biblioteca: portada, progreso y accesos rápidos a cada libro. */

import { listBooks, listPositions } from './db.js';
import { prefs, setPrefs } from './prefs.js';
import { $, $$, escapeHtml } from './util.js';

const SORTS = {
  recent: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
  title: (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'es'),
  read: (a, b) => (b.lastRead || 0) - (a.lastRead || 0),
  progress: (a, b) => (b.percent || 0) - (a.percent || 0)
};

function fold(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export async function renderLibrary(handlers = {}) {
  const view = $('#view');
  const [books, positions] = await Promise.all([listBooks(), listPositions()]);
  const posMap = new Map(positions.map((p) => [p.bookId, p]));
  const enriched = books.map((b) => {
    const pos = posMap.get(b.id);
    return { ...b, percent: pos?.percent || 0, lastRead: pos?.updatedAt || 0, position: pos };
  });

  const lastId = prefs.lastBookId;
  const candidates = enriched.filter((b) => b.percent > 0.002 && b.percent < 0.996);
  const continueBook = (lastId && candidates.find((b) => b.id === lastId))
    || candidates.sort((a, b) => (b.lastRead || 0) - (a.lastRead || 0))[0]
    || null;

  const storageLine = books.length
    ? `${books.length} ${books.length === 1 ? 'libro' : 'libros'} en este dispositivo`
    : 'Tu biblioteca está vacía';

  view.innerHTML = `
    <section class="lib-head">
      <div>
        <p class="lib-kicker">Lectura en voz alta · sin nube</p>
        <h1>Tu biblioteca,<br>en voz alta.</h1>
        <p>Sube EPUB o PDF. Si el PDF es una fotocopia, LectorStudio reconoce el texto, lo lee con la voz que elijas y recuerda exactamente dónde te quedaste.</p>
      </div>
      <div class="lib-head-actions">
        <button class="btn btn-gold" id="addBooks">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Añadir libros
        </button>
      </div>
    </section>

    ${continueBook ? `
    <section class="continue-card">
      <div class="continue-cover">${coverHtml(continueBook)}</div>
      <div class="continue-body">
        <div class="continue-label">Sigue donde lo dejaste</div>
        <h2 class="continue-title">${escapeHtml(continueBook.title)}</h2>
        <p class="continue-sub">${escapeHtml(continueBook.position?.chapterTitle || continueBook.author || '')}</p>
        <div class="continue-actions">
          <button class="btn btn-gold" id="continueBtn">Continuar leyendo</button>
          <button class="btn btn-ghost" id="continueToc">Ver índice</button>
        </div>
      </div>
      <div class="continue-pct">${Math.round(continueBook.percent * 100)} %<small>avance</small></div>
    </section>` : ''}

    <div class="lib-toolbar" id="libToolbar" ${books.length ? '' : 'hidden'}>
      <h2>Estantería</h2>
      <span class="count" id="libCount">${storageLine}</span>
      <span class="spacer"></span>
      <label class="search">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input id="libSearch" type="search" placeholder="Buscar por título o autor" autocomplete="off">
      </label>
      <select class="select-min" id="libSort" aria-label="Ordenar biblioteca">
        <option value="recent">Recientes</option>
        <option value="read">Última lectura</option>
        <option value="title">Título A–Z</option>
        <option value="progress">Más avanzados</option>
      </select>
    </div>

    <div id="libGrid"></div>

    <p class="hint-small" style="text-align:center;margin-top:34px">
      Los libros y tu avance se guardan solo en este dispositivo. Haz un respaldo desde Ajustes antes de borrar datos del navegador.
    </p>`;

  $('#libSort').value = prefs.sort || 'recent';
  $('#libCount').textContent = storageLine;

  const grid = $('#libGrid');
  const search = $('#libSearch');
  const sortSel = $('#libSort');

  const drawGrid = () => {
    const q = fold(search.value.trim());
    const sort = SORTS[sortSel.value] || SORTS.recent;
    const list = enriched
      .filter((b) => !q || fold(`${b.title} ${b.author} ${b.fileName || ''}`).includes(q))
      .sort(sort);

    if (!list.length) {
      grid.innerHTML = books.length
        ? `<div class="empty"><div class="empty-card"><div class="big">Sin resultados</div><p>No encontré libros con «${escapeHtml(search.value.trim())}».</p></div></div>`
        : emptyState();
      bindEmpty();
      return;
    }

    grid.innerHTML = `<div class="book-grid">${list.map(cardHtml).join('')}</div>`;
    $$('.book-open', grid).forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const book = enriched.find((b) => b.id === id);
        if (book) handlers.onOpen?.(book);
      });
    });
    $$('.book-menu', grid).forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.menu;
        const book = enriched.find((b) => b.id === id);
        if (book) handlers.onMenu?.(book);
      });
    });
  };

  const bindEmpty = () => {
    $('#emptyAdd')?.addEventListener('click', () => handlers.onImport?.());
    $('#emptyDemo')?.addEventListener('click', () => handlers.onDemoEpub?.());
    $('#emptyDemoPdf')?.addEventListener('click', () => handlers.onDemoPdf?.());
  };

  search.addEventListener('input', drawGrid);
  sortSel.addEventListener('change', () => { setPrefs({ sort: sortSel.value }); drawGrid(); });
  $('#addBooks').addEventListener('click', () => handlers.onImport?.());
  $('#continueBtn')?.addEventListener('click', () => handlers.onOpen?.(continueBook));
  $('#continueToc')?.addEventListener('click', () => handlers.onOpen?.(continueBook, { toc: true }));

  drawGrid();
  return { books: enriched };
}

function coverHtml(book) {
  if (book.cover) return `<img src="${escapeHtml(book.cover)}" alt="Portada de ${escapeHtml(book.title)}" loading="lazy">`;
  return `<div class="fallback"><b>${escapeHtml(book.title || 'Libro')}</b><span>${escapeHtml(book.format === 'pdf' ? 'PDF' : 'EPUB')}</span></div>`;
}

function cardHtml(book) {
  const pct = Math.round((book.percent || 0) * 100);
  const badge = book.format === 'pdf' ? 'PDF' : 'EPUB';
  return `<article class="book-card">
    <button class="book-open" data-id="${book.id}" aria-label="Abrir ${escapeHtml(book.title)}">
      <div class="book-cover">
        ${coverHtml(book)}
        <span class="spine"></span>
        <span class="book-badge ${book.ocr ? 'ocr' : ''}">${book.ocr ? 'PDF · OCR' : badge}</span>
        ${pct > 0 ? `<span class="book-pct">${pct} %</span>` : ''}
      </div>
      <div class="book-info">
        <h3 class="book-title">${escapeHtml(book.title)}</h3>
        <p class="book-author">${escapeHtml(book.author || '')}</p>
        <div class="progress-track"><i style="width:${Math.min(100, pct)}%"></i></div>
      </div>
    </button>
    <button class="book-menu" data-menu="${book.id}" aria-label="Opciones de ${escapeHtml(book.title)}">
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="5.5" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="18.5" r="1.7" fill="currentColor"/></svg>
    </button>
  </article>`;
}

function emptyState() {
  return `<div class="empty">
    <div class="empty-card">
      <svg class="empty-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path d="M7 12c6-2.4 12-2.4 17 0v27c-5-2.4-11-2.4-17 0z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        <path d="M41 12c-6-2.4-12-2.4-17 0v27c5-2.4 11-2.4 17 0z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        <path d="M24 14v23" stroke="currentColor" stroke-width="1.4" opacity=".6"/>
        <path d="M31 9c2 1.2 3.4 3 4 5.4M34 18.5c-.6 1.6-1.6 2.9-3 3.9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".85"/>
      </svg>
      <div class="big">Aquí empieza tu biblioteca</div>
      <p>Añade un EPUB o un PDF. Si es una fotocopia, el texto se reconoce en este mismo dispositivo: nada se sube para el OCR.</p>
      <div class="empty-actions">
        <button class="btn btn-gold" id="emptyAdd">Elegir archivos</button>
        <button class="btn btn-ghost" id="emptyDemo">Libro de ejemplo</button>
        <button class="btn btn-ghost" id="emptyDemoPdf">Probar una fotocopia</button>
      </div>
      <div class="hint-small">EPUB · PDF con texto · PDF escaneado (OCR en español e inglés)</div>
    </div>
  </div>`;
}
