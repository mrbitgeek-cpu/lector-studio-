/* Preferencias del dispositivo: se guardan en localStorage (ligeras) y no
   contienen libros. La biblioteca vive en IndexedDB. */

const KEY = 'lectorstudio.prefs.v1';

export const DEFAULT_PREFS = {
  voiceURI: '',
  rate: 1,
  pitch: 1,
  volume: 1,
  ocrEnabled: true,
  ocrLang: 'spa',
  theme: 'sepia',
  fontSize: 19,
  lineHeight: 1.72,
  highlight: true,
  autoScroll: true,
  pdfView: 'auto',
  sort: 'recent',
  lastBookId: ''
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export const prefs = read();

const listeners = new Set();

export function setPrefs(patch) {
  Object.assign(prefs, patch);
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* modo privado */ }
  listeners.forEach((fn) => { try { fn(prefs); } catch { /* noop */ } });
  return prefs;
}

export function onPrefs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetPrefs() {
  setPrefs({ ...DEFAULT_PREFS, lastBookId: prefs.lastBookId });
}
