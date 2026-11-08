/* Lectura en voz alta con las voces del propio dispositivo.
   Web Speech API: sin servidores, sin claves y funciona sin conexión. */

import { chunkForSpeech, estimateSeconds } from './text.js';
import { sleep } from './util.js';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
export const speechSupported = !!(synth && window.SpeechSynthesisUtterance);

export class SpeechCancelled extends Error {
  constructor() { super('cancelado'); this.name = 'SpeechCancelled'; }
}
export class SpeechTimeout extends Error {
  constructor() { super('La voz no respondió a tiempo.'); this.name = 'SpeechTimeout'; }
}

let cachedVoices = [];
let loadingPromise = null;

export function getCachedVoices() { return cachedVoices; }

export function loadVoices({ timeout = 2800 } = {}) {
  if (!speechSupported) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) { cachedVoices = now; return Promise.resolve(now); }
  if (loadingPromise) return loadingPromise;
  loadingPromise = new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      cachedVoices = synth.getVoices();
      resolve(cachedVoices);
    };
    const poll = setInterval(() => {
      if (synth.getVoices().length) finish();
    }, 200);
    timer = setTimeout(finish, timeout);
    try { synth.addEventListener('voiceschanged', finish, { once: true }); } catch { /* Safari viejo */ }
    try { synth.onvoiceschanged = finish; } catch { /* noop */ }
  }).finally(() => { loadingPromise = null; });
  return loadingPromise;
}

const LANG_ALIASES = {
  spa: 'es', eng: 'en', fra: 'fr', deu: 'de', por: 'pt', ita: 'it',
  nld: 'nl', rus: 'ru', jpn: 'ja', chi: 'zh', zho: 'zh', kor: 'ko',
  ara: 'ar', hin: 'hi', tur: 'tr', pol: 'pl', swe: 'sv', dan: 'da',
  nor: 'no', fin: 'fi', ell: 'el', heb: 'he', ces: 'cs', ron: 'ro',
  hun: 'hu', ukr: 'uk', vie: 'vi', tha: 'th', ind: 'id', msa: 'ms'
};

/** Normaliza códigos ISO 639-2 de Tesseract ("spa") a BCP 47 ("es"). */
export function normalizeLang(lang = 'es') {
  const raw = String(lang || 'es').replace('_', '-').toLowerCase();
  const parts = raw.split('-');
  const base = LANG_ALIASES[parts[0]] || parts[0];
  return [base, ...parts.slice(1)].join('-');
}

export function voiceLang(v) {
  return String(v?.lang || '').replace('_', '-');
}

/** ¿La voz es de las nuevas neuronales/mejoradas del sistema? */
export function isNaturalVoice(v) {
  return /natural|neural|premium|enhanced|siri/i.test(String(v?.name || ''));
}

export function voiceTags(v) {
  if (!v) return [];
  const tags = [];
  if (/natural|neural/i.test(v.name)) tags.push('Neuronal');
  else if (/premium|enhanced/i.test(v.name)) tags.push('Mejorada');
  tags.push(v.localService ? 'Local' : 'En línea');
  return tags;
}

/** Nombre corto para el reproductor: "Microsoft Dalia Online (Natural)…" → "Dalia". */
export function shortVoiceName(v) {
  if (!v) return '';
  return String(v.name)
    .replace(/^(Microsoft|Google|Apple)\s+/i, '')
    .replace(/\s+(Online|Multilingual)\b.*$/i, '')
    .replace(/\s*[-–].*$/, '')
    .replace(/\s*\(.*\)/, '')
    .trim();
}

export function languageName(code = '') {
  const base = String(code).split('-')[0].toLowerCase();
  const names = {
    es: 'Español', en: 'Inglés', fr: 'Francés', de: 'Alemán', it: 'Italiano',
    pt: 'Portugués', ca: 'Catalán', gl: 'Gallego', eu: 'Euskera', ja: 'Japonés',
    zh: 'Chino', ru: 'Ruso', ar: 'Árabe', hi: 'Hindi', ko: 'Coreano', nl: 'Neerlandés',
    pl: 'Polaco', tr: 'Turco', sv: 'Sueco', da: 'Danés', no: 'Noruego', fi: 'Finés'
  };
  return names[base] || base.toUpperCase();
}

/** Voces candidatas para un idioma, ordenadas por conveniencia. */
export function voicesForLang(lang = 'es', all = cachedVoices) {
  const normalized = normalizeLang(lang);
  const base = normalized.split('-')[0];
  const exact = normalized;
  return all
    .filter((v) => {
      const vl = voiceLang(v).toLowerCase();
      return vl === exact || vl.split('-')[0] === base || (base === 'es' && vl.startsWith('es'));
    })
    .sort((a, b) => {
      const score = (v) => {
        let s = 0;
        const vl = voiceLang(v).toLowerCase();
        const name = String(v.name || '');
        const onAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
        // La calidad manda: las neuronales suenan mucho menos robóticas.
        if (isNaturalVoice(v)) s += 70;
        if (vl === exact) s += 35;
        else if (vl.split('-')[0] === base) s += 20;
        // Para un libro mexicano, el español de EE. UU. suena más cercano que el de España.
        if (exact === 'es-mx' && vl === 'es-us') s += 8;
        if (v.localService) s += 8;            // funciona sin internet
        else s += 6;
        if (/google/i.test(name)) {
          s += 8;
          // En Android, Google TTS suele sonar mejor que el motor del fabricante.
          if (onAndroid) s += 30;
        }
        if (/siri/i.test(name)) s += 20;
        return s;
      };
      return score(b) - score(a) || a.name.localeCompare(b.name, 'es');
    });
}

export function pickVoice(voiceURI, lang = 'es', voices = cachedVoices) {
  if (!voices.length) return null;
  if (voiceURI) {
    const found = voices.find((v) => v.voiceURI === voiceURI);
    if (found) {
      // Sin red, una voz neuronal online no suena: cae a una local.
      if (typeof navigator !== 'undefined' && navigator.onLine === false && !found.localService) {
        const local = voicesForLang(lang, voices).find((v) => v.localService);
        if (local) return local;
      }
      return found;
    }
  }
  const candidates = voicesForLang(lang, voices);
  // Sin conexión, una voz neuronal en línea no va a sonar: usa una local.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const local = candidates.find((v) => v.localService && isNaturalVoice(v))
      || candidates.find((v) => v.localService);
    if (local) return local;
  }
  return candidates[0] || null;
}

export function describeVoice(v) {
  if (!v) return 'Sin voz';
  return `${v.name} · ${voiceLang(v)}${v.localService ? '' : ' · en línea'}`;
}

/* ------------------------------------------------------------------ lector */
export class Speaker {
  constructor() {
    this.token = 0;
    this.utterance = null;
    this.paused = false;
    this.playing = false;
    this.onstate = null;
    this.lastVoices = [];
    this.unlocked = false;
  }

  get supported() { return speechSupported; }

  /**
   * iOS y algunos Android solo permiten sintetizar voz si la primera llamada
   * ocurre dentro de un gesto del usuario. Esta locución vacía desbloquea el
   * motor y evita que la lectura se silencie al encadenar frases.
   */
  unlock() {
    if (!speechSupported || this.unlocked) return;
    this.unlocked = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.rate = 2;
      synth.speak(u);
    } catch { /* noop */ }
  }

  async refreshVoices() {
    this.lastVoices = await loadVoices();
    return this.lastVoices;
  }

  #emit(state) {
    this.playing = state === 'speaking';
    if (typeof this.onstate === 'function') this.onstate(state);
  }

  /** Lee un texto completo (puede ser largo: se trocea). Resuelve al terminar. */
  async speak(text, { rate = 1, pitch = 1, volume = 1, lang = 'es', voiceURI = '' } = {}) {
    if (!speechSupported) throw new Error('Este navegador no tiene lectura en voz alta.');
    const chunks = chunkForSpeech(text, 190);
    if (!chunks.length) return;

    // Nunca esperamos a que aparezcan las voces: en iOS eso rompe el gesto.
    // Si aún no están, se habla con la voz predeterminada del idioma.
    let voices = this.lastVoices;
    if (!voices.length) {
      voices = synth.getVoices();
      if (voices.length) this.lastVoices = voices;
      else this.refreshVoices().catch(() => {});
    }
    const voice = pickVoice(voiceURI, lang, voices);
    const token = ++this.token;
    this.paused = false;
    this.#emit('speaking');

    for (let i = 0; i < chunks.length; i++) {
      if (token !== this.token) throw new SpeechCancelled();
      await this.#speakChunk(chunks[i], { token, voice, rate, pitch, volume, lang });
      if (token !== this.token) throw new SpeechCancelled();
    }
    if (token === this.token) this.#emit('idle');
  }

  #speakChunk(text, { token, voice, rate, pitch, volume, lang }) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        this.utterance = null;
        fn(arg);
      };

      const u = new SpeechSynthesisUtterance(text);
      if (voice) { u.voice = voice; u.lang = voiceLang(voice) || lang; }
      else { u.lang = lang; }
      u.rate = Math.min(3, Math.max(0.4, rate));
      u.pitch = Math.min(2, Math.max(0.4, pitch));
      u.volume = Math.min(1, Math.max(0, volume));

      // Si el motor no avisa del final, no dejamos la app colgada.
      const expected = estimateSeconds(text, rate) * 1000;
      const watchdog = setTimeout(() => {
        try { synth.cancel(); } catch { /* noop */ }
        finish(reject, new SpeechTimeout());
      }, Math.max(9000, expected + 12000));

      u.onstart = () => { if (token === this.token) this.#emit('speaking'); };
      u.onend = () => finish(resolve);
      u.onerror = (event) => {
        const code = event?.error || 'unknown';
        if (code === 'interrupted' || code === 'canceled' || token !== this.token) {
          finish(reject, new SpeechCancelled());
        } else if (code === 'not-allowed') {
          finish(reject, new Error('El navegador bloqueó la voz. Toca de nuevo el botón de reproducir.'));
        } else if (code === 'audio-busy') {
          finish(reject, new Error('El audio del dispositivo está ocupado por otra app.'));
        } else {
          finish(reject, new Error(`La voz falló (${code}). Prueba con otra voz del sistema.`));
        }
      };

      this.utterance = u;
      try {
        if (synth.paused) synth.resume();
        synth.speak(u);
      } catch (err) {
        finish(reject, err);
      }
    });
  }

  stop() {
    this.token++;
    this.paused = false;
    this.utterance = null;
    this.#emit('idle');
    try { synth.cancel(); } catch { /* noop */ }
  }

  pause() {
    if (!speechSupported) return;
    try {
      synth.pause();
      this.paused = true;
      this.#emit('paused');
    } catch { /* noop */ }
  }

  async resume() {
    if (!speechSupported) return;
    try {
      synth.resume();
      this.paused = false;
      this.#emit('speaking');
    } catch { /* noop */ }
  }

  /** Corte limpio antes de empezar otra frase (Chrome necesita un respiro). */
  async cancelAndWait() {
    this.stop();
    await sleep(70);
  }
}

/** Prueba corta de una voz concreta. */
export async function testVoice(voiceURI, text = 'Así suena esta voz leyendo tu biblioteca.', lang = 'es', rate = 1) {
  const speaker = new Speaker();
  speaker.unlock();
  await speaker.refreshVoices();
  try {
    const p = speaker.speak(text, { voiceURI, lang, rate });
    setTimeout(() => speaker.stop(), 12000);
    await p;
    return true;
  } catch {
    return false;
  }
}
