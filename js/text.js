/* Segmentación de texto: frases para leer, trozos para sintetizar.
   Sin dependencias del DOM para poder probarla con Node. */

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('es', { granularity: 'sentence' })
  : null;

/** Divide un texto en frases con sus desplazamientos sobre el texto original. */
export function splitSentences(text, maxLen = 260) {
  const src = String(text || '');
  const out = [];
  if (!src.trim()) return out;

  const push = (start, end) => {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(src[s])) s++;
    while (e > s && /\s/.test(src[e - 1])) e--;
    if (e - s < 2) return;
    const slice = src.slice(s, e);
    if (!/[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(slice)) return;
    const prev = out[out.length - 1];
    if (prev && slice.length < 14) {
      prev.end = e;
      prev.text = src.slice(prev.start, e);
      return;
    }
    out.push({ start: s, end: e, text: slice });
  };

  const raw = [];
  if (segmenter) {
    for (const part of segmenter.segment(src)) {
      raw.push([part.index, part.index + part.segment.length]);
    }
  } else {
    const re = /[^.!?…]+[.!?…]+["»”’)]*|[^.!?…]+$/g;
    let m;
    while ((m = re.exec(src))) raw.push([m.index, m.index + m[0].length]);
  }
  for (const [s, e] of raw) push(s, e);

  const final = [];
  for (const seg of out) {
    if (seg.text.length <= maxLen) { final.push(seg); continue; }
    for (const piece of splitLong(seg.text, maxLen)) {
      final.push({ start: seg.start + piece.start, end: seg.start + piece.end, text: piece.text });
    }
  }
  return final;
}

/** Parte una frase demasiado larga por comas o espacios, sin cortar palabras. */
function splitLong(text, maxLen) {
  const out = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxLen);
    if (end < text.length) {
      const window = text.slice(start, end);
      let cut = -1;
      for (const ch of ['; ', ': ', ', ', '. ']) {
        const idx = window.lastIndexOf(ch);
        if (idx > maxLen * 0.45) { cut = idx + ch.length; break; }
      }
      if (cut < 0) {
        const sp = window.lastIndexOf(' ');
        if (sp > maxLen * 0.45) cut = sp + 1;
      }
      if (cut > 0) end = start + cut;
    }
    let s = start;
    let e = end;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) out.push({ start: s, end: e, text: text.slice(s, e) });
    start = end;
  }
  return out;
}

/** Trozos cortos para speechSynthesis: algunos navegadores cortan textos largos. */
export function chunkForSpeech(text, maxLen = 190) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];
  const chunks = [];
  let rest = clean;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    let cut = -1;
    for (const ch of ['. ', '! ', '? ', '; ', ': ', ', ']) {
      const idx = window.lastIndexOf(ch);
      if (idx > maxLen * 0.4) { cut = idx + ch.length; break; }
    }
    if (cut < 0) {
      const sp = window.lastIndexOf(' ');
      cut = sp > maxLen * 0.4 ? sp + 1 : maxLen;
    }
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) {
    if (rest.length < 24 && chunks.length) chunks[chunks.length - 1] += ' ' + rest;
    else chunks.push(rest);
  }
  return chunks.filter(Boolean);
}

/** Cuenta palabras de forma aproximada (para estimar duración). */
export function countWords(text) {
  const m = String(text || '').trim().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}

/** Duración estimada en segundos a una velocidad dada. */
export function estimateSeconds(text, rate = 1) {
  return (countWords(text) / 2.7) / Math.max(0.4, rate);
}

/** Une líneas de una página conservando offsets para poder resaltar frases. */
export function joinLines(lines) {
  const parts = [];
  let offset = 0;
  const maps = [];
  lines.forEach((line, i) => {
    const t = String(line.text || '').trim();
    if (!t) return;
    if (i > 0 && offset > 0) { parts.push(' '); offset += 1; }
    maps.push({ start: offset, end: offset + t.length, rect: line.rect });
    parts.push(t);
    offset += t.length;
  });
  return { text: parts.join(''), maps };
}

/** Rectángulos (en fracciones de página) que cubren una frase dentro de un bloque. */
export function rectsForRange(maps, start, end) {
  const out = [];
  for (const line of maps) {
    if (line.end <= start) continue;
    if (line.start >= end) break;
    if (!line.rect) continue;
    out.push(line.rect);
  }
  return out;
}
