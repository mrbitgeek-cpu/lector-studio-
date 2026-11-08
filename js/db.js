/* Almacenamiento local: IndexedDB, todo en el dispositivo.
   Tiendas:
     books     metadatos de cada libro (portada incluida como dataURL)
     contents  texto estructurado (capítulos, párrafos, rectángulos de OCR)
     files     archivo original (EPUB/PDF) para poder releer o re-renderizar
     assets    imágenes extraídas de los EPUB
     positions marcador de lectura por libro
*/

const DB_NAME = 'lectorstudio';
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('contents')) db.createObjectStore('contents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) {
        const s = db.createObjectStore('assets', { keyPath: 'id' });
        s.createIndex('bookId', 'bookId', { unique: false });
      }
      if (!db.objectStoreNames.contains('positions')) db.createObjectStore('positions', { keyPath: 'bookId' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('La base de datos está bloqueada por otra pestaña.'));
  });
  return dbPromise;
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(name, mode, fn) {
  const db = await openDB();
  const tx = db.transaction(name, mode);
  const store = tx.objectStore(name);
  const result = await fn(store);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transacción cancelada'));
  });
  return result;
}

/* ------------------------------------------------------------------- libros */
export async function putBook(book) {
  return withStore('books', 'readwrite', (s) => wrap(s.put(book)));
}

export function getBook(id) {
  return withStore('books', 'readonly', (s) => wrap(s.get(id)));
}

export async function listBooks() {
  const books = await withStore('books', 'readonly', (s) => wrap(s.getAll()));
  return books.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

export async function patchBook(id, patch) {
  const book = await getBook(id);
  if (!book) return null;
  const next = { ...book, ...patch, id };
  await putBook(next);
  return next;
}

/* ------------------------------------------------------------------ contenido */
export async function putContent(id, content) {
  return withStore('contents', 'readwrite', (s) => wrap(s.put({ id, ...content })));
}

export async function getContent(id) {
  const row = await withStore('contents', 'readonly', (s) => wrap(s.get(id)));
  return row || null;
}

/* ---------------------------------------------------------------------- archivos */
export async function putFile(id, meta, blob) {
  return withStore('files', 'readwrite', (s) => wrap(s.put({ id, meta, blob, savedAt: Date.now() })));
}

export async function getFile(id) {
  return withStore('files', 'readonly', (s) => wrap(s.get(id)));
}

/* ---------------------------------------------------------------------- assets */
export async function putAsset(asset) {
  return withStore('assets', 'readwrite', (s) => wrap(s.put(asset)));
}

export async function getAsset(id) {
  return withStore('assets', 'readonly', (s) => wrap(s.get(id)));
}

export async function deleteAssets(bookId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assets', 'readwrite');
    const idx = tx.objectStore('assets').index('bookId');
    const req = idx.openKeyCursor(IDBKeyRange.only(bookId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        tx.objectStore('assets').delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/* ------------------------------------------------------------------- marcador */
export async function putPosition(pos) {
  return withStore('positions', 'readwrite', (s) => wrap(s.put({ ...pos, updatedAt: Date.now() })));
}

export async function getPosition(bookId) {
  return withStore('positions', 'readonly', (s) => wrap(s.get(bookId)));
}

export async function listPositions() {
  return withStore('positions', 'readonly', (s) => wrap(s.getAll()));
}

export async function deletePosition(bookId) {
  return withStore('positions', 'readwrite', (s) => wrap(s.delete(bookId)));
}

export async function deleteAllPositions() {
  return withStore('positions', 'readwrite', (s) => wrap(s.clear()));
}

/* -------------------------------------------------------------------- borrado */
export async function deleteBook(id) {
  await withStore('books', 'readwrite', (s) => wrap(s.delete(id)));
  await withStore('contents', 'readwrite', (s) => wrap(s.delete(id)));
  await withStore('files', 'readwrite', (s) => wrap(s.delete(id)));
  await withStore('positions', 'readwrite', (s) => wrap(s.delete(id)));
  await deleteAssets(id);
}

export async function clearLibrary() {
  for (const name of ['books', 'contents', 'files', 'assets', 'positions']) {
    await withStore(name, 'readwrite', (s) => wrap(s.clear()));
  }
}

/* ------------------------------------------------------------------ espacio */
export async function storageInfo() {
  let usage = 0;
  let quota = 0;
  try {
    const est = await navigator.storage.estimate();
    usage = est.usage || 0;
    quota = est.quota || 0;
  } catch { /* navegadores sin estimate */ }
  let persisted = false;
  try { persisted = await navigator.storage.persisted(); } catch { /* noop */ }
  return { usage, quota, persisted };
}

export async function requestPersistent() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      return await navigator.storage.persist();
    }
  } catch { /* noop */ }
  return false;
}

/* ------------------------------------------------------------------ respaldo */
export async function dumpAll() {
  const books = await listBooks();
  const contents = [];
  for (const b of books) {
    const c = await getContent(b.id);
    if (c) contents.push(c);
  }
  const files = [];
  for (const b of books) {
    const f = await getFile(b.id);
    if (f) files.push({ id: f.id, meta: f.meta, blob: f.blob });
  }
  const positions = await listPositions();
  const assets = [];
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('assets', 'readonly');
    const req = tx.objectStore('assets').openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) { assets.push(cursor.value); cursor.continue(); }
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return { books, contents, files, positions, assets };
}

export async function restoreAll(data, { replace = false } = {}) {
  if (replace) await clearLibrary();
  for (const asset of data.assets || []) await putAsset(asset);
  for (const book of data.books || []) await putBook(book);
  for (const content of data.contents || []) await withStore('contents', 'readwrite', (s) => wrap(s.put(content)));
  for (const file of data.files || []) await putFile(file.id, file.meta, file.blob);
  for (const pos of data.positions || []) await withStore('positions', 'readwrite', (s) => wrap(s.put(pos)));
}
