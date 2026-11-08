/* Utilidades de interfaz y formato. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

export function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export function debounce(fn, wait = 400) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function fmtDate(ts) {
  if (!ts) return '';
  try {
    return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ts));
  } catch { return ''; }
}

export function fmtTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

export function fileExt(name = '') {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function normalizeSpace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------------ toasts */
export function toast(message, kind = '', ms = 3600) {
  const host = $('#toasts');
  if (!host) return;
  const node = document.createElement('div');
  node.className = 'toast' + (kind ? ' ' + kind : '');
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s, transform .25s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 260);
  }, ms);
  return node;
}

export function clearToasts() {
  $('#toasts')?.replaceChildren();
}

/* ------------------------------------------------------------------ hojas */
let sheetCleanup = null;

export function openSheet(title, build, { onClose } = {}) {
  const scrim = $('#scrim');
  const sheet = $('#sheet');
  const body = $('#sheetBody');
  $('#sheetTitle').textContent = title;
  body.innerHTML = '';
  const result = build(body);
  scrim.hidden = false;
  sheet.hidden = false;
  document.body.classList.add('no-scroll');
  if (sheetCleanup) { try { sheetCleanup(); } catch { /* noop */ } }
  sheetCleanup = onClose || null;
  const close = () => closeSheet();
  $('#sheetClose').onclick = close;
  scrim.onclick = close;
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); }
  };
  document.addEventListener('keydown', onKey);
  const prevCleanup = sheetCleanup;
  sheetCleanup = () => {
    document.removeEventListener('keydown', onKey);
    if (prevCleanup) { try { prevCleanup(); } catch { /* noop */ } }
  };
  return result;
}

export function closeSheet() {
  const scrim = $('#scrim');
  const sheet = $('#sheet');
  if (!sheet || sheet.hidden) return;
  sheet.hidden = true;
  scrim.hidden = true;
  document.body.classList.remove('no-scroll');
  if (sheetCleanup) {
    try { sheetCleanup(); } catch { /* noop */ }
    sheetCleanup = null;
  }
}

/* ---------------------------------------------------------------- diálogo */
export function confirmDialog(title, text, { ok = 'Continuar', cancel = 'Cancelar', danger = false, extra = null } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'scrim';
    wrap.style.zIndex = '70';
    const extraBtn = extra ? `<button class="btn ${extra.danger ? 'btn-danger' : 'btn-ghost'}" data-act="extra">${escapeHtml(extra.label)}</button>` : '';
    wrap.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        <p>${text}</p>
        <div class="dialog-actions">
          <button class="btn btn-ghost" data-act="cancel">${escapeHtml(cancel)}</button>
          ${extraBtn}
          <button class="btn ${danger ? 'btn-danger' : 'btn-gold'}" data-act="ok">${escapeHtml(ok)}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const onKey = (e) => {
      if (e.key === 'Escape') done(false);
    };
    const done = (value) => {
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      resolve(value);
    };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) done(act === 'ok' ? true : act === 'extra' ? 'extra' : false);
      else if (e.target === wrap) done(false);
    });
    wrap.querySelector('[data-act="ok"]').focus();
  });
}

/* ------------------------------------------------------------ portada/imagen */
export async function imageToCover(blob, maxW = 420, maxH = 640, quality = 0.82) {
  if (!blob) return '';
  try {
    const bitmap = await createImageBitmap(blob);
    const ratio = Math.min(maxW / bitmap.width, maxH / bitmap.height, 1);
    const w = Math.max(1, Math.round(bitmap.width * ratio));
    const h = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f4edde';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return '';
  }
}

export function canvasToCover(canvas, maxW = 420, quality = 0.82) {
  try {
    const ratio = Math.min(maxW / canvas.width, 1);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(canvas.width * ratio));
    out.height = Math.max(1, Math.round(canvas.height * ratio));
    out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', quality);
  } catch { return ''; }
}

export function initials(title = '') {
  const words = normalizeSpace(title).split(' ').filter((w) => w.length > 2);
  return (words.slice(0, 2).map((w) => w[0]).join('') || 'L').toUpperCase();
}
