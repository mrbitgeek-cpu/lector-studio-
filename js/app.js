/* LectorStudio · arranque, rutas, importación y vida general de la app. */

import { renderLibrary } from './library.js';
import { Reader } from './reader.js';
import {
  openSettingsSheet, openBookMenu, openInstallHelp, openIosStorageNotice,
  openTocSheet, openVoiceSheet
} from './sheets.js';
import { importBookFile, reocrBook, ImportCancelled } from './import.js';
import { openPdfDocument } from './pdfdoc.js';
import { getBook, deleteBook, deletePosition, storageInfo, requestPersistent, listBooks, getPosition } from './db.js';
import { exportBackup, importBackup, readBackup } from './backup.js';
import { prefs, setPrefs } from './prefs.js';
import {
  $, $$, toast, confirmDialog, openSheet, closeSheet, escapeHtml, fmtBytes,
  fileExt
} from './util.js';
import { loadVoices } from './speech.js';

/* ------------------------------------------------------------------ estado */
let reader = null;
let currentBookId = '';
let routeSeq = 0;
let pendingToc = false;
let deferredPrompt = null;
let importManager = null;

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* -------------------------------------------------------------------- rutas */
function goHome() {
  if (location.hash === '#/' || !location.hash) {
    route();
  } else {
    location.hash = '#/';
  }
}

function openBookRoute(id, { toc = false } = {}) {
  pendingToc = toc;
  const hash = `#/libro/${encodeURIComponent(id)}`;
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  const seq = ++routeSeq;
  const hash = location.hash || '#/';
  const match = /^#\/libro\/(.+)$/.exec(hash);
  if (match) {
    let id = match[1];
    try { id = decodeURIComponent(id); } catch { /* noop */ }
    await openReader(id, seq);
  } else {
    await showLibrary(seq);
  }
}

async function showLibrary(seq) {
  if (seq !== routeSeq) return;
  if (reader) {
    reader.destroy();
    reader = null;
  }
  currentBookId = '';
  document.body.classList.remove('has-player', 'reading');
  $('#player').hidden = true;
  const view = $('#view');
  view.innerHTML = '<div style="padding:60px 20px;text-align:center"><span class="spinner"></span></div>';

  await renderLibrary({
    onOpen: (book, opts) => openBookRoute(book.id, opts),
    onMenu: (book) => showBookMenu(book),
    onImport: () => pickFiles(),
    onDemoEpub: () => loadDemo('epub'),
    onDemoPdf: () => loadDemo('pdf')
  });
  updateStorageChip();
  updateInstallButton();
}

async function openReader(id, seq) {
  if (reader && currentBookId === id) return;
  if (reader) { reader.destroy(); reader = null; }
  const book = await getBook(id);
  if (!book) {
    toast('Ese libro ya no está en la biblioteca.', 'err');
    goHome();
    return;
  }
  if (seq !== routeSeq) return;
  currentBookId = id;
  setPrefs({ lastBookId: id });
  reader = new Reader({
    onExit: () => goHome(),
    onSettings: (r) => openSettingsSheet({ reader: r, onLibraryChange: () => { if (!reader) showLibrary(routeSeq); } }),
    onTOC: (r) => openTocSheet(r),
    onVoice: (r) => openVoiceSheet({ reader: r })
  });
  try {
    await reader.open(book);
    if (pendingToc) {
      pendingToc = false;
      openTocSheet(reader);
    }
  } catch (err) {
    toast(err?.message || 'No pude abrir este libro.', 'err', 7000);
    reader.destroy();
    reader = null;
    goHome();
  }
}

/* ---------------------------------------------------------------- biblioteca */
function showBookMenu(book) {
  openBookMenu(book, {
    onOpen: (b) => openBookRoute(b.id),
    onRestart: async (b) => {
      await deletePosition(b.id);
      toast('Marcador reiniciado.');
      openBookRoute(b.id);
    },
    onReocr: (b) => reocrBookFlow(b),
    onDelete: async (b) => {
      try {
        await deleteBook(b.id);
        if (prefs.lastBookId === b.id) setPrefs({ lastBookId: '' });
        toast(`«${b.title}» eliminado.`, 'ok');
        if (reader && currentBookId === b.id) goHome();
        else showLibrary(routeSeq);
      } catch (err) {
        toast('No se pudo eliminar: ' + (err?.message || err), 'err');
      }
    }
  });
}

async function updateStorageChip() {
  try {
    const info = await storageInfo();
    const chip = $('#storageChip');
    if (!chip) return;
    chip.hidden = false;
    chip.textContent = `${fmtBytes(info.usage)} en este dispositivo`;
  } catch { /* noop */ }
}

/* ---------------------------------------------------------------- instalación */
function updateInstallButton() {
  const btn = $('#installBtn');
  if (!btn) return;
  const show = !isStandalone() && (deferredPrompt || isIOS());
  btn.hidden = !show;
}

function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallButton();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    updateInstallButton();
    toast('LectorStudio quedó instalada.', 'ok');
  });
  $('#installBtn').addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      updateInstallButton();
      if (choice.outcome === 'accepted') toast('Instalando LectorStudio…', 'ok');
    } else {
      openInstallHelp();
    }
  });
}

/* ------------------------------------------------------------------- importar */
function pickFiles() {
  const input = $('#fileInput');
  input.value = '';
  input.click();
}

function enqueueFiles(files) {
  if (!importManager) importManager = new ImportManager();
  const valid = [];
  for (const file of files) {
    const ext = fileExt(file.name);
    if (ext !== 'epub' && ext !== 'pdf') {
      toast(`«${file.name}» no es EPUB ni PDF.`, 'err', 4000);
      continue;
    }
    valid.push(file);
  }
  if (!valid.length) return;
  requestPersistent();
  importManager.add(valid);
}

class ImportManager {
  constructor() {
    this.jobs = [];
    this.queue = Promise.resolve();
    this.panelOpen = false;
    this.doneCount = 0;
    this.totalCount = 0;
  }

  add(files, options = {}) {
    this.totalCount += files.length;
    for (const file of files) {
      const job = {
        id: 'j' + Math.random().toString(36).slice(2, 8),
        file,
        name: file.name,
        phase: 'En cola',
        progress: 0,
        status: 'queued',
        cancelled: false,
        detail: '',
        forceOcr: options.forceOcr ?? null
      };
      this.jobs.push(job);
      this.queue = this.queue.then(() => this.process(job)).catch(() => { /* ya reportado */ });
    }
    this.openPanel();
    this.renderJobs();
    this.queue.then(() => {
      this.renderJobs();
      if (this.doneCount >= this.totalCount) setTimeout(() => this.renderJobs(), 300);
    });
  }

  openPanel() {
    if (this.panelOpen) return;
    openSheet('Añadiendo libros', (body) => {
      body.innerHTML = `
        <p class="hint-small" style="margin:0 0 14px">El texto se reconoce en este dispositivo. Puedes cerrar esta ventana: la importación sigue en curso.</p>
        <div class="import-list" id="importList"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost btn-sm" id="importClose">Cerrar</button>
        </div>`;
      $('#importClose', body).onclick = () => closeSheet();
      this.renderJobs();
    }, { onClose: () => { this.panelOpen = false; this.body = null; } });
    this.panelOpen = true;
  }

  renderJobs() {
    const host = document.getElementById('importList');
    if (!host) return;
    host.innerHTML = this.jobs.map((job) => {
      const pct = Math.max(0, Math.min(100, Math.round(job.progress * 100)));
      const statusClass = job.status === 'error' ? 'job-status error' : 'job-status';
      const canCancel = job.status === 'running';
      return `<div class="job" id="job-${job.id}">
        <div class="job-ico">${fileExt(job.name).toUpperCase()}</div>
        <div style="min-width:0">
          <p class="job-name">${escapeHtml(job.name)}</p>
          <p class="${statusClass}" id="status-${job.id}">${escapeHtml(job.statusText || job.phase || '')}</p>
          <div class="job-progress">
            <div class="progress-track"><i id="bar-${job.id}" style="width:${pct}%"></i></div>
            <span class="job-pct" id="pct-${job.id}">${job.status === 'done' ? '✓' : pct + ' %'}</span>
            ${canCancel ? `<button class="job-cancel" data-cancel="${job.id}">Cancelar</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('') || '<p class="hint-small">Preparando…</p>';
    $$('[data-cancel]', host).forEach((btn) => {
      btn.onclick = () => {
        const job = this.jobs.find((j) => j.id === btn.dataset.cancel);
        if (job) { job.cancelled = true; btn.textContent = 'Cancelando…'; btn.disabled = true; }
      };
    });
  }

  updateJob(job) {
    const status = document.getElementById(`status-${job.id}`);
    const bar = document.getElementById(`bar-${job.id}`);
    const pct = document.getElementById(`pct-${job.id}`);
    if (status) {
      status.textContent = job.statusText || job.phase || '';
      status.className = 'job-status' + (job.status === 'error' ? ' error' : '');
    }
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, Math.round(job.progress * 100)))}%`;
    if (pct) pct.textContent = job.status === 'done' ? '✓' : `${Math.round(job.progress * 100)} %`;
  }

  async process(job) {
    if (job.cancelled) { job.status = 'cancelled'; job.statusText = 'Cancelado'; this.updateJob(job); return; }
    job.status = 'running';
    job.phase = 'Preparando';
    job.statusText = 'Preparando…';
    this.renderJobs();
    this.updateJob(job);

    try {
      let forceOcr = job.forceOcr ?? null;
      if (forceOcr === null && fileExt(job.file.name) === 'pdf' && prefs.ocrEnabled) {
        const pages = await this.countPages(job);
        if (job.cancelled) throw new ImportCancelled('cancelado');
        if (pages > 24) {
          const minutes = Math.max(1, Math.round((pages * 3.8) / 60));
          const choice = await confirmDialog(
            'PDF largo',
            `Este PDF tiene <b>${pages} páginas</b>. Si muchas son fotocopias, el OCR puede tardar unos <b>${minutes} minutos</b> y conviene dejar la ventana abierta y el dispositivo cargando. ¿Cómo lo proceso?`,
            { ok: 'Reconocer todo', extra: { label: 'Solo texto' }, cancel: 'Cancelar' }
          );
          if (!choice) throw new ImportCancelled('cancelado');
          if (choice === 'extra') forceOcr = false;
        }
      }

      const book = await importBookFile(job.file, {
        onProgress: (p) => {
          job.phase = p.phase || job.phase;
          job.progress = p.progress ?? job.progress;
          const extra = p.page ? ` · página ${p.page}${p.pages ? ` de ${p.pages}` : ''}` : '';
          job.statusText = `${job.phase}${extra}`;
          this.updateJob(job);
        },
        shouldCancel: () => job.cancelled,
        forceOcr,
        ocrLang: prefs.ocrLang
      });

      job.status = 'done';
      job.progress = 1;
      job.statusText = `Listo${book.ocr ? ` · OCR en ${book.ocr.pages} pág.` : ''}`;
      this.updateJob(job);
      this.doneCount++;
      toast(`«${book.title}» añadido a la biblioteca.`, 'ok', 4500);
      if (book.warning) setTimeout(() => toast(book.warning, 'err', 9000), 900);
      if (!reader) {
        await renderLibrary({
          onOpen: (b, opts) => openBookRoute(b.id, opts),
          onMenu: (b) => showBookMenu(b),
          onImport: () => pickFiles(),
          onDemoEpub: () => loadDemo('epub'),
          onDemoPdf: () => loadDemo('pdf')
        });
        updateStorageChip();
      }
      if (isIOS() && !localStorage.getItem('lectorstudio.iosNotice')) {
        localStorage.setItem('lectorstudio.iosNotice', '1');
        setTimeout(() => openIosStorageNotice(), 1200);
      }
    } catch (err) {
      if (job.cancelled || err instanceof ImportCancelled || err?.name === 'PdfCancelled') {
        job.status = 'cancelled';
        job.statusText = 'Cancelado';
        this.updateJob(job);
        return;
      }
      job.status = 'error';
      job.statusText = err?.message || 'No se pudo importar';
      this.updateJob(job);
      const quota = /quota|espacio|storage/i.test(String(err?.name || '') + ' ' + String(err?.message || ''));
      toast(
        quota
          ? `«${job.name}»: no hay espacio suficiente en este dispositivo. Borra algún libro o libera espacio.`
          : `«${job.name}»: ${err?.message || 'error al importar'}`,
        'err', 8000
      );
    }
  }

  async countPages(job) {
    try {
      const pdf = await openPdfDocument(job.file);
      const n = pdf.numPages;
      await pdf.destroy();
      return n;
    } catch (err) {
      throw new Error(err?.message || 'No pude abrir el PDF.');
    }
  }
}

/* ------------------------------------------------------------------ re-OCR */
async function reocrBookFlow(book) {
  if (!importManager) importManager = new ImportManager();
  const job = {
    id: 'j' + Math.random().toString(36).slice(2, 8),
    file: { name: book.fileName || book.title },
    name: book.title,
    phase: 'Reconociendo de nuevo',
    progress: 0,
    status: 'running',
    cancelled: false,
    statusText: 'Preparando OCR…'
  };
  importManager.jobs.push(job);
  importManager.openPanel();
  importManager.renderJobs();
  try {
    const updated = await reocrBook(book, {
      onProgress: (p) => {
        job.phase = p.phase || job.phase;
        job.progress = p.progress ?? job.progress;
        const extra = p.page ? ` · página ${p.page}${p.pages ? ` de ${p.pages}` : ''}` : '';
        job.statusText = `${job.phase}${extra}`;
        importManager.updateJob(job);
      },
      shouldCancel: () => job.cancelled,
      ocrLang: prefs.ocrLang
    });
    job.status = 'done';
    job.progress = 1;
    job.statusText = `Listo · OCR en ${updated.ocr?.pages || 0} pág.`;
    importManager.updateJob(job);
    toast('Texto reconocido de nuevo.', 'ok');
    if (reader) reader.forceRender = true;
    else showLibrary(routeSeq);
  } catch (err) {
    if (job.cancelled || err instanceof ImportCancelled || err?.name === 'PdfCancelled') {
      job.status = 'cancelled';
      job.statusText = 'Cancelado';
      importManager.updateJob(job);
      return;
    }
    job.status = 'error';
    job.statusText = err?.message || 'Error';
    importManager.updateJob(job);
    toast(err?.message || 'No se pudo reconocer el texto.', 'err', 7000);
  }
}

/* -------------------------------------------------------------------- demo */
async function loadDemo(which) {
  try {
    const url = which === 'pdf' ? 'samples/fotocopia.pdf' : 'samples/libro-demo.epub';
    const res = await fetch(url);
    if (!res.ok) throw new Error('No encontré el archivo de ejemplo.');
    const blob = await res.blob();
    const name = which === 'pdf' ? 'Fotocopia de ejemplo.pdf' : 'Voces de papel.epub';
    const file = new File([blob], name, { type: which === 'pdf' ? 'application/pdf' : 'application/epub+zip' });
    if (!importManager) importManager = new ImportManager();
    if (which === 'pdf') {
      // La fotocopia de ejemplo se procesa con OCR sí o sí.
      importManager.add([file], { forceOcr: true });
    } else {
      importManager.add([file]);
    }
  } catch (err) {
    toast(err?.message || 'No pude cargar el ejemplo.', 'err');
  }
}

/* --------------------------------------------------------------- arrastrar */
function setupDragDrop() {
  let depth = 0;
  const veil = $('#dropveil');
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    depth++;
    veil.hidden = false;
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) veil.hidden = true;
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    veil.hidden = true;
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) enqueueFiles(files);
  });
}

/* ------------------------------------------------------------------- arranque */
async function bootstrap() {
  setupInstall();
  setupDragDrop();
  $('#fileInput').addEventListener('change', (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (files.length) enqueueFiles(files);
  });
  $('#settingsBtn').addEventListener('click', () => openSettingsSheet({
    onLibraryChange: () => showLibrary(routeSeq)
  }));

  window.addEventListener('hashchange', route);
  window.addEventListener('pagehide', () => reader?.saveNow());
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o' && !reader) {
      e.preventDefault();
      pickFiles();
    }
  });

  if (!location.hash) history.replaceState(null, '', '#/');
  await route();
  loadVoices().catch(() => {});

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (err) {
      console.warn('Service worker no registrado:', err);
    }
  }

  // Limpieza amable de posiciones sin libro.
  try {
    const books = await listBooks();
    const ids = new Set(books.map((b) => b.id));
    const { listPositions } = await import('./db.js');
    for (const pos of await listPositions()) {
      if (!ids.has(pos.bookId)) await deletePosition(pos.bookId);
    }
  } catch { /* noop */ }

  // Gancho de diagnóstico: solo con ?debug=1. Útil para pruebas automatizadas.
  if (new URLSearchParams(location.search).has('debug')) {
    window.LectorStudio = {
      version: '1.0.0',
      async importFile(name, blob, opts = {}) {
        const type = blob.type || (name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/epub+zip');
        const file = new File([blob], name, { type });
        const book = await importBookFile(file, {
          forceOcr: opts.forceOcr ?? null,
          ocrLang: opts.ocrLang || prefs.ocrLang
        });
        await showLibrary(routeSeq);
        return book;
      },
      openBook: (id, opts) => openBookRoute(id, opts),
      reader: () => reader,
      getBook,
      listBooks,
      showLibrary: () => showLibrary(routeSeq),
      async backupRoundtrip() {
        const exp = await exportBackup(() => {}, { download: false });
        const file = new File([exp.blob], exp.filename, { type: 'application/zip' });
        const read = await readBackup(file);
        const before = await listBooks();
        const victim = before[0];
        const position = victim ? await getPosition(victim.id) : null;
        if (victim) await deleteBook(victim.id);
        const afterDelete = (await listBooks()).length;
        const restored = await importBackup(file);
        const after = await listBooks();
        const back = victim ? after.find((b) => b.id === victim.id) : null;
        const backPos = victim ? await getPosition(victim.id) : null;
        return {
          size: exp.size,
          booksInZip: exp.books,
          read: { books: read.books.length, contents: read.contents.length, files: read.files.length, assets: read.assets.length, positions: read.positions.length },
          before: before.length,
          afterDelete,
          restored,
          after: after.length,
          restoredCover: !!back?.cover,
          positionBefore: position?.segment ?? null,
          positionAfter: backPos?.segment ?? null
        };
      }
    };
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
