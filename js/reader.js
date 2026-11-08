/* Lector: pinta el capítulo, resalta la frase que suena, guarda el marcador
   y maneja la reproducción con las voces del dispositivo. */

import { getContent, getFile, getAsset, getPosition, putPosition } from './db.js';
import { prefs, setPrefs } from './prefs.js';
import {
  Speaker, SpeechCancelled, speechSupported, loadVoices,
  pickVoice, shortVoiceName, normalizeLang
} from './speech.js';
import { splitSentences, joinLines, rectsForRange } from './text.js';
import { $, escapeHtml, debounce, sleep, toast, clamp, initials, clearToasts } from './util.js';
import { openPdfDocument, renderPdfPage } from './pdfdoc.js';

function speechText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function textNodesOf(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  return nodes;
}

function rangeFromOffsets(root, start, end) {
  const nodes = textNodesOf(root);
  let pos = 0;
  let startNode = null;
  let startOff = 0;
  let endNode = null;
  let endOff = 0;
  for (const node of nodes) {
    const len = node.nodeValue.length;
    if (!startNode && start <= pos + len) {
      startNode = node;
      startOff = Math.max(0, start - pos);
    }
    if (startNode && end <= pos + len) {
      endNode = node;
      endOff = Math.max(0, end - pos);
      break;
    }
    pos += len;
  }
  if (!startNode || !endNode) return null;
  try {
    const range = document.createRange();
    range.setStart(startNode, Math.min(startOff, startNode.nodeValue.length));
    range.setEnd(endNode, Math.min(endOff, endNode.nodeValue.length));
    return range;
  } catch {
    return null;
  }
}

export class Reader {
  constructor(options = {}) {
    this.options = options;
    this.book = null;
    this.content = null;
    this.chapterIndex = 0;
    this.segmentIndex = 0;
    this.segments = [];
    this.renderedChapter = -1;
    this.mode = 'idle';
    this.token = 0;
    this.speaker = new Speaker();
    this.assetUrls = [];
    this.spokenBlock = null;
    this.pdf = null;
    this.pdfPromise = null;
    this.pdfRenderToken = 0;
    this.pdfMode = prefs.pdfView === 'text' ? 'text' : prefs.pdfView === 'page' ? 'page' : null;
    this.wakeLock = null;
    this.mounted = false;
    this.savePosition = debounce(() => this.#writePosition(), 600);
    this.onKey = this.onKey.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    this.onResize = debounce(() => {
      if (!this.mounted) return;
      // Al girar el teléfono o cambiar el ancho, el texto se reflowa:
      // las cajas del resaltado calculadas antes ya no sirven.
      this.highlightCurrent({ scroll: false });
    }, 120);
  }

  /* --------------------------------------------------------------- montaje */
  mount() {
    document.body.classList.add('reading', 'has-player');
    clearToasts();
    const view = $('#view');
    view.innerHTML = `
      <div class="reader" data-theme="${escapeHtml(prefs.theme)}" id="reader">
        <header class="reader-top">
          <button class="icon-btn" id="readerBack" aria-label="Volver a la biblioteca" title="Biblioteca (Esc)">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="reader-titles">
            <div class="rt-book" id="rtBook"></div>
            <div class="rt-chap" id="rtChap">—</div>
          </div>
          <div class="reader-toolbar">
            <button class="icon-btn" id="pdfViewBtn" title="Ver la página escaneada o el texto reconocido" aria-label="Cambiar vista del PDF" hidden>
              <span id="pdfViewLabel" style="font-size:11px;font-weight:700">Pág.</span>
            </button>
            <button class="icon-btn" id="readerFont" title="Apariencia" aria-label="Apariencia de lectura">
              <span style="font-family:Georgia,serif;font-size:15px;font-weight:700">Aa</span>
            </button>
            <button class="icon-btn" id="readerToc" title="Índice" aria-label="Índice del libro">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 6h16M4 11h16M4 16h16M4 21h10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            </button>
          </div>
        </header>
        <div class="reader-body" id="readerBody">
          <div class="reader-page" id="readerPage"></div>
        </div>
        <div class="reader-footnote"><span id="readerNote"></span></div>
      </div>`;
    this.root = $('#reader');
    this.scroller = $('#readerBody');
    this.pageEl = $('#readerPage');
    this.hlLayer = null;
    this.mounted = true;

    $('#readerBack').onclick = () => this.exit();
    $('#readerFont').onclick = () => this.options.onSettings?.(this);
    $('#readerToc').onclick = () => this.options.onTOC?.(this);
    $('#pdfViewBtn').onclick = () => this.togglePdfView();

    this.applyTypography();
    $('#rtBook').textContent = this.book?.title || '';
    $('#rtChap').textContent = this.content?.chapters[this.chapterIndex]?.title || '';

    const player = $('#player');
    player.hidden = false;
    player.classList.remove('mini');
    this.bindPlayer();
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
  }

  bindPlayer() {
    $('#playBtn').onclick = () => this.toggle();
    $('#prevBtn').onclick = () => this.step(-1, { fromUser: true });
    $('#nextBtn').onclick = () => this.step(1, { fromUser: true });
    $('#speedBtn').onclick = () => this.cycleSpeed();
    $('#voiceBtn').onclick = () => this.options.onVoice?.(this);
    $('#tocBtn').onclick = () => this.options.onTOC?.(this);
    $('#playerCover').onclick = null;
  }

  updatePlayIcon() {
    const play = $('#playBtn');
    if (!play) return;
    const speaking = this.mode === 'speaking';
    play.querySelector('.ico-play').hidden = speaking;
    play.querySelector('.ico-pause').hidden = !speaking;
    play.setAttribute('aria-label', speaking ? 'Pausar' : 'Reproducir');
    play.setAttribute('title', speaking ? 'Pausar (espacio)' : 'Reproducir (espacio)');
    const spinner = play.querySelector('.spinner');
    if (spinner) spinner.hidden = true;
  }

  /* ---------------------------------------------------------------- apertura */
  async open(book) {
    this.book = book;
    this.book.language = normalizeLang(this.book.language || 'es');
    this.content = await getContent(book.id);
    if (!this.content?.chapters?.length) throw new Error('El contenido de este libro no está disponible. Vuelve a subirlo.');
    this.book.format = this.book.format || this.content.source || 'epub';

    this.chapterCounts = this.content.chapters.map((ch) => ch.blocks.reduce(
      (n, b) => n + (b.t === 'img' ? 0 : splitSentences(b.text || '').length), 0
    ));
    this.cum = [];
    let acc = 0;
    for (const c of this.chapterCounts) { this.cum.push(acc); acc += c; }
    this.totalSegments = Math.max(1, acc);

    const pos = await getPosition(book.id);
    this.savedPosition = pos || null;
    this.chapterIndex = clamp(pos?.chapter ?? 0, 0, this.content.chapters.length - 1);
    this.segmentIndex = Math.max(0, pos?.segment ?? 0);

    if (this.book.format === 'pdf') {
      this.pdfMode = this.pdfMode || (this.content.chapters.some((c) => c.ocr) ? 'text' : 'page');
    }

    this.mount();
    await this.renderChapter();
    this.segmentIndex = clamp(this.segmentIndex, 0, Math.max(0, this.segments.length - 1));
    this.setSegment(this.segmentIndex, { scroll: !!pos, smooth: false });
    this.updatePlayer();
    this.refreshVoiceInfo();
    this.syncMediaSession();

    if (!speechSupported) {
      setTimeout(() => toast('Este navegador no tiene voces. Prueba con Chrome, Edge o Safari.', 'err', 7000), 800);
    }
  }

  async refreshVoiceInfo() {
    const voices = await loadVoices();
    const voice = pickVoice(prefs.voiceURI, this.book?.language || 'es', voices);
    this.voice = voice;
    const label = $('#voiceLabel');
    if (label) {
      const shortName = shortVoiceName(voice);
      label.textContent = shortName ? shortName.slice(0, 16) : 'Voz';
    }
  }

  /* ------------------------------------------------------------------ render */
  applyTypography() {
    if (!this.root) return;
    this.root.style.setProperty('--reader-size', `${prefs.fontSize}px`);
    this.root.style.setProperty('--reader-leading', String(prefs.lineHeight));
    this.root.dataset.theme = prefs.theme;
    if (this.hlLayer) this.highlightCurrent({ scroll: false });
  }

  async renderChapter() {
    if (this.renderedChapter === this.chapterIndex && !this.forceRender) return;
    this.forceRender = false;
    this.revokeAssets();
    this.renderedChapter = this.chapterIndex;
    const ch = this.content.chapters[this.chapterIndex];
    if (!ch) return;
    this.hlLayer = null;
    this.pageEl.innerHTML = '';
    this.pageEl.classList.toggle('pdf-page-view', this.book.format === 'pdf' && this.pdfMode === 'page');
    this.segments = [];
    this.spokenBlock = null;

    if (this.book.format === 'pdf' && this.pdfMode === 'page') {
      await this.renderPdfPageMode(ch);
    } else if (this.book.format === 'pdf') {
      this.renderPdfTextMode(ch);
    } else {
      this.renderEpubChapter(ch);
    }

    const chapEl = $('#rtChap');
    if (chapEl) chapEl.textContent = ch.title || '';
    const pdfBtn = $('#pdfViewBtn');
    if (pdfBtn) {
      pdfBtn.hidden = this.book.format !== 'pdf';
      const label = $('#pdfViewLabel');
      if (label) label.textContent = this.pdfMode === 'page' ? 'Pág.' : 'Texto';
    }
    this.updatePlayer();
    this.syncMediaSession();
  }

  chapterKicker(ch) {
    if (this.book.format === 'pdf') {
      const mark = ch.ocr ? ' · texto reconocido' : '';
      return `Página ${ch.page || this.chapterIndex + 1} de ${this.content.chapters.length}${mark}`;
    }
    return `Capítulo ${this.chapterIndex + 1} de ${this.content.chapters.length}`;
  }

  renderEpubChapter(ch) {
    const frag = document.createElement('div');
    frag.innerHTML = `<div class="page-kicker">${escapeHtml(this.chapterKicker(ch))}</div>`;
    this.pageEl.appendChild(frag);
    const holder = document.createElement('div');
    holder.innerHTML = ch.blocks.map((b, i) => this.blockHtml(b, i)).join('');
    while (holder.firstChild) this.pageEl.appendChild(holder.firstChild);
    this.hlLayer = document.createElement('div');
    this.hlLayer.className = 'hl-layer';
    this.pageEl.appendChild(this.hlLayer);
    this.buildSegmentsFromDom();
    this.loadImages();
  }

  blockHtml(b, i) {
    const attrs = `data-block="${i}" id="b${i}"`;
    const content = b.html || escapeHtml(b.text);
    switch (b.t) {
      case 'h1': return `<h1 ${attrs} class="block-tap epub-h1">${content}</h1>`;
      case 'h2': return `<h2 ${attrs} class="block-tap epub-h2">${content}</h2>`;
      case 'h3': case 'h4': case 'h5': case 'h6':
        return `<h3 ${attrs} class="block-tap epub-h3">${content}</h3>`;
      case 'li': return `<div ${attrs} class="block-tap epub-li">${content}</div>`;
      case 'quote': return `<blockquote ${attrs} class="block-tap epub-quote">${content}</blockquote>`;
      case 'pre': return `<pre class="epub-pre" id="b${i}">${escapeHtml(b.text)}</pre>`;
      case 'caption': return `<figcaption class="epub-caption" id="b${i}">${content}</figcaption>`;
      case 'img': return `<figure class="epub-img" data-asset="${escapeHtml(b.asset)}" data-alt="${escapeHtml(b.alt || '')}"><span class="spinner"></span></figure>`;
      default: return `<p ${attrs} class="block-tap epub-p">${content}</p>`;
    }
  }

  renderPdfTextMode(ch) {
    const frag = document.createElement('div');
    frag.innerHTML = `<div class="page-kicker">${escapeHtml(this.chapterKicker(ch))}</div>`;
    this.pageEl.appendChild(frag);
    const holder = document.createElement('div');
    holder.innerHTML = ch.blocks.map((b, i) => `<p data-block="${i}" class="epub-p block-tap" id="b${i}">${escapeHtml(b.text)}</p>`).join('');
    while (holder.firstChild) this.pageEl.appendChild(holder.firstChild);
    this.hlLayer = document.createElement('div');
    this.hlLayer.className = 'hl-layer';
    this.pageEl.appendChild(this.hlLayer);
    this.buildSegmentsFromDom();
  }

  async renderPdfPageMode(ch) {
    this.pdfRenderToken++;
    const myToken = this.pdfRenderToken;
    const pageNumber = ch.page || this.chapterIndex + 1;
    this.pageEl.innerHTML = `
      <div class="page-kicker">${escapeHtml(this.chapterKicker(ch))}</div>
      <div class="pdf-stage">
        <div class="pdf-page-wrap" id="pdfWrap">
          <canvas id="pdfCanvas"></canvas>
          <div class="pdf-hl-layer" id="pdfHl"></div>
          <div class="pdf-loading" id="pdfLoading"><span class="spinner"></span><span>Preparando la página…</span></div>
        </div>
        <div class="pdf-page-nav">
          <button class="btn btn-ghost btn-sm" id="pdfPrevPage" ${pageNumber <= 1 ? 'disabled' : ''}>Página anterior</button>
          <span>${pageNumber} / ${this.content.chapters.length}</span>
          <button class="btn btn-ghost btn-sm" id="pdfNextPage" ${pageNumber >= this.content.chapters.length ? 'disabled' : ''}>Página siguiente</button>
        </div>
        ${ch.ocr ? '<div class="pdf-text-note">Esta página se reconoció con OCR. Si el texto se lee mejor, cambia a vista <b>Texto</b>.</div>' : ''}
      </div>`;
    this.hlLayer = $('#pdfHl');
    $('#pdfPrevPage').onclick = () => this.goTo(this.chapterIndex - 1, 0);
    $('#pdfNextPage').onclick = () => this.goTo(this.chapterIndex + 1, 0);

    // Los segmentos no dependen del dibujo: se preparan ya para poder
    // empezar a escuchar aunque la página tarde en renderizarse.
    for (let i = 0; i < ch.blocks.length; i++) {
      const b = ch.blocks[i];
      if (!b.text) continue;
      const joined = joinLines(b.lines || []);
      const source = joined.text || b.text;
      for (const seg of splitSentences(source)) {
        this.segments.push({
          blockIndex: i,
          start: seg.start,
          end: seg.end,
          text: seg.text,
          rects: b.lines ? rectsForRange(joined.maps, seg.start, seg.end) : []
        });
      }
    }

    const canvas = $('#pdfCanvas');
    const wrap = $('#pdfWrap');
    try {
      const pdf = await this.ensurePdf();
      const width = Math.min(1000, Math.max(280, wrap.clientWidth || 800));
      await renderPdfPage(pdf, pageNumber, canvas, width);
      if (myToken !== this.pdfRenderToken) return;
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      $('#pdfLoading')?.remove();
    } catch (err) {
      if (myToken !== this.pdfRenderToken) return;
      const loading = $('#pdfLoading');
      if (loading) loading.innerHTML = `<div style="padding:20px;text-align:center;color:#7a2e26">No pude dibujar la página.<br><small>${escapeHtml(err?.message || '')}</small></div>`;
    }
  }

  buildSegmentsFromDom() {
    const blocks = [...this.pageEl.querySelectorAll('[data-block]')];
    for (const el of blocks) {
      if (el.tagName === 'FIGURE') continue;
      const text = el.textContent || '';
      if (!text.trim()) continue;
      const blockIndex = Number(el.dataset.block);
      for (const seg of splitSentences(text)) {
        this.segments.push({
          blockIndex,
          start: seg.start,
          end: seg.end,
          text: seg.text,
          el
        });
      }
    }
  }

  async loadImages() {
    const figures = [...this.pageEl.querySelectorAll('[data-asset]')];
    for (const fig of figures) {
      const id = fig.dataset.asset;
      if (!id) continue;
      try {
        const asset = await getAsset(id);
        if (!asset?.blob) { fig.remove(); continue; }
        const url = URL.createObjectURL(asset.blob);
        this.assetUrls.push(url);
        const img = document.createElement('img');
        img.src = url;
        img.alt = fig.dataset.alt || '';
        img.loading = 'lazy';
        fig.replaceChildren(img);
      } catch {
        fig.remove();
      }
    }
    // Las imágenes pueden cambiar la altura del capítulo: recoloca el resaltado.
    if (this.mounted && this.hlLayer) this.highlightCurrent({ scroll: false });
  }

  revokeAssets() {
    for (const url of this.assetUrls) {
      try { URL.revokeObjectURL(url); } catch { /* noop */ }
    }
    this.assetUrls = [];
  }

  async ensurePdf() {
    if (this.pdf) return this.pdf;
    if (!this.pdfPromise) {
      this.pdfPromise = (async () => {
        const file = await getFile(this.book.id);
        if (!file?.blob) throw new Error('Falta el PDF original en este dispositivo.');
        return openPdfDocument(file.blob);
      })();
    }
    this.pdf = await this.pdfPromise;
    return this.pdf;
  }

  /* ----------------------------------------------------------------- posición */
  get chapter() { return this.content?.chapters[this.chapterIndex]; }

  overallPercent() {
    if (!this.content) return 0;
    const before = this.cum?.[this.chapterIndex] || 0;
    return clamp((before + this.segmentIndex + 1) / this.totalSegments, 0, 1);
  }

  setSegment(index, { scroll = true, smooth = true } = {}) {
    if (!this.segments.length) return;
    this.segmentIndex = clamp(index, 0, this.segments.length - 1);
    this.highlightCurrent({ scroll, smooth });
    this.updatePlayer();
    this.savePosition();
  }

  highlightCurrent({ scroll = true, smooth = true } = {}) {
    if (!this.mounted) return;
    if (this.hlLayer) this.hlLayer.innerHTML = '';
    const seg = this.segments[this.segmentIndex];
    if (!seg) return;

    if (this.book.format === 'pdf' && this.pdfMode === 'page') {
      const rects = seg.rects || [];
      if (prefs.highlight) {
        for (const r of rects) {
          const div = document.createElement('div');
          div.className = 'pdf-hl';
          div.style.left = `${r[0] * 100}%`;
          div.style.top = `${r[1] * 100}%`;
          div.style.width = `${r[2] * 100}%`;
          div.style.height = `${r[3] * 100}%`;
          this.hlLayer?.appendChild(div);
        }
      }
      if (scroll && rects.length) {
        const wrap = $('#pdfWrap');
        const wr = wrap?.getBoundingClientRect();
        if (wr) {
          const first = rects[0];
          const last = rects[rects.length - 1];
          const top = wr.top + first[1] * wr.height;
          const bottom = wr.top + (last[1] + last[3]) * wr.height;
          const sRect = this.scroller.getBoundingClientRect();
          if (top < sRect.top + 78 || bottom > sRect.bottom - 128) {
            const target = this.scroller.scrollTop + top - sRect.top - sRect.height * 0.32;
            if (smooth && prefs.autoScroll) this.scroller.scrollTo({ top: target, behavior: 'smooth' });
            else this.scroller.scrollTop = target;
          }
        }
      }
      if (scroll) this.scrollPageIntoView();
      return;
    }

    const el = seg.el || this.pageEl.querySelector(`[data-block="${seg.blockIndex}"]`);
    if (!el) return;
    const range = rangeFromOffsets(el, seg.start, seg.end);
    const rects = range ? [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1) : [];
    const pageRect = this.pageEl.getBoundingClientRect();
    if (prefs.highlight) {
      for (const r of rects) {
        const div = document.createElement('div');
        div.className = 'hl-rect';
        div.style.left = `${r.left - pageRect.left}px`;
        div.style.top = `${r.top - pageRect.top}px`;
        div.style.width = `${r.width}px`;
        div.style.height = `${r.height}px`;
        this.hlLayer?.appendChild(div);
      }
    }
    if (!scroll) return;
    const sRect = this.scroller.getBoundingClientRect();
    const top = rects.length ? rects[0].top : el.getBoundingClientRect().top;
    const bottom = rects.length ? rects[rects.length - 1].bottom : el.getBoundingClientRect().bottom;
    if (top < sRect.top + 72 || bottom > sRect.bottom - 130) {
      const target = this.scroller.scrollTop + top - sRect.top - sRect.height * 0.34;
      if (smooth && prefs.autoScroll) this.scroller.scrollTo({ top: target, behavior: 'smooth' });
      else this.scroller.scrollTop = target;
    }
  }

  scrollPageIntoView() {
    const wrap = $('#pdfWrap');
    if (!wrap) return;
    const sRect = this.scroller.getBoundingClientRect();
    const wRect = wrap.getBoundingClientRect();
    if (wRect.top < sRect.top + 50) {
      this.scroller.scrollBy({ top: wRect.top - sRect.top - 60, behavior: 'smooth' });
    }
  }

  async #writePosition() {
    if (!this.book || !this.content) return;
    const ch = this.content.chapters[this.chapterIndex];
    const seg = this.segments[this.segmentIndex];
    try {
      await putPosition({
        bookId: this.book.id,
        chapter: this.chapterIndex,
        segment: this.segmentIndex,
        percent: this.overallPercent(),
        chapterTitle: ch?.title || '',
        preview: seg ? speechText(seg.text).slice(0, 140) : '',
        format: this.book.format
      });
      prefs.lastBookId = this.book.id;
    } catch { /* cuota llena: se reintenta al salir */ }
  }

  saveNow() {
    this.savePosition.cancel();
    this.#writePosition();
  }
  updatePlayer() {
    if (!this.mounted) return;
    const ch = this.chapter;
    const pct = Math.round(this.overallPercent() * 100);
    $('#playerTitle').textContent = this.book?.title || '—';
    $('#playerSub').textContent = `${ch?.title || ''} · ${pct} %`;
    $('#playerProgressFill').style.width = `${pct}%`;
    const cover = $('#playerCover');
    if (cover && this._coverKey !== this.book?.id) {
      this._coverKey = this.book?.id;
      cover.innerHTML = this.book?.cover
        ? `<img src="${escapeHtml(this.book.cover)}" alt="">`
        : `<div style="width:100%;height:100%;display:grid;place-items:center;color:#e2a75a;font-family:Georgia,serif;font-size:18px">${escapeHtml(initials(this.book?.title))}</div>`;
    }
    $('#speedBtn').textContent = `${Number(prefs.rate).toFixed(1)}×`;
    this.updatePlayIcon();
  }

  showNote(text) {
    const note = $('#readerNote');
    if (!note) return;
    note.textContent = text;
    note.classList.toggle('show', !!text);
  }

  /* --------------------------------------------------------------- reproducción */
  async toggle() {
    if (this.mode === 'speaking') this.pause();
    else this.play();
  }

  play() {
    if (!speechSupported) {
      toast('Este navegador no ofrece lectura en voz alta. En iPhone usa Safari; en Android instala una voz en Ajustes.', 'err', 7000);
      return;
    }
    if (this.mode === 'speaking') return;
    if (!this.segments.length) {
      toast('Este capítulo no tiene texto para leer.', 'err');
      return;
    }
    this.speaker.unlock();
    if (this.segmentIndex >= this.segments.length - 1 && this.chapterIndex >= this.content.chapters.length - 1 && this.mode === 'ended') {
      this.segmentIndex = 0;
      this.goTo(0, 0, { autoplay: true });
      return;
    }
    this.mode = 'speaking';
    this.token++;
    const token = this.token;
    this.updatePlayIcon();
    this.requestWakeLock();
    this.runLoop(token);
  }

  async runLoop(token) {
    while (this.mode === 'speaking' && token === this.token) {
      const seg = this.segments[this.segmentIndex];
      if (!seg) { this.finishBook(); return; }
      this.highlightCurrent({ scroll: prefs.autoScroll });
      // Una pausa breve entre párrafos hace la lectura menos mecánica.
      if (this.spokenBlock != null && this.spokenBlock !== seg.blockIndex) {
        await sleep(160);
        if (this.mode !== 'speaking' || token !== this.token) return;
      }
      this.spokenBlock = seg.blockIndex;
      this.savePosition();

      let voiceURI = prefs.voiceURI;
      if (!navigator.onLine && this.voice && !this.voice.localService) {
        // La voz elegida es neuronal online: sin red, usa una local.
        voiceURI = '';
        if (!this._offlineVoiceNoticeShown) {
          this._offlineVoiceNoticeShown = true;
          toast('Sin conexión: uso una voz local para seguir leyendo.', '', 4500);
        }
      }

      try {
        await this.speaker.speak(speechText(seg.text), {
          rate: Number(prefs.rate) || 1,
          pitch: Number(prefs.pitch) || 1,
          volume: Number(prefs.volume) ?? 1,
          lang: this.book?.language || 'es',
          voiceURI
        });
      } catch (err) {
        if (err instanceof SpeechCancelled) return;
        this.mode = 'paused';
        this.updatePlayIcon();
        this.releaseWakeLock();
        if (err?.name === 'SpeechTimeout') {
          toast('La voz se detuvo sin avisar. Pulsa play para continuar.', 'err', 5000);
        } else if (!navigator.onLine && this.voice && !this.voice.localService) {
          toast('Sin conexión: la voz elegida es neuronal en línea. Elige una voz local en el botón de voz.', 'err', 6500);
        } else {
          toast(err?.message || 'No se pudo leer en voz alta.', 'err', 6000);
        }
        return;
      }
      if (this.mode !== 'speaking' || token !== this.token) return;

      const advanced = await this.advance(1, { auto: true });
      if (!advanced) { this.finishBook(); return; }
    }
  }

  pause() {
    if (this.mode !== 'speaking') return;
    this.mode = 'paused';
    this.token++;
    this.speaker.stop();
    this.releaseWakeLock();
    this.updatePlayIcon();
    this.saveNow();
  }

  finishBook() {
    this.mode = 'ended';
    this.updatePlayIcon();
    this.releaseWakeLock();
    this.saveNow();
    this.showNote('Has llegado al final del libro.');
    toast(`Terminaste «${this.book?.title || 'el libro'}».`, 'ok', 5000);
    setTimeout(() => this.showNote(''), 5000);
  }

  async advance(delta, { auto = false } = {}) {
    const scroll = auto ? prefs.autoScroll : true;
    if (delta > 0) {
      if (this.segmentIndex < this.segments.length - 1) {
        this.setSegment(this.segmentIndex + 1, { scroll });
        return true;
      }
      if (this.chapterIndex < this.content.chapters.length - 1) {
        this.chapterIndex++;
        this.forceRender = true;
        await this.renderChapter();
        this.setSegment(0, { scroll, smooth: false });
        return true;
      }
      return false;
    }
    if (this.segmentIndex > 0) {
      this.setSegment(this.segmentIndex - 1, { scroll });
      return true;
    }
    if (this.chapterIndex > 0) {
      this.chapterIndex--;
      this.forceRender = true;
      await this.renderChapter();
      this.setSegment(this.segments.length - 1, { scroll, smooth: false });
      return true;
    }
    return false;
  }

  async step(delta, { fromUser = false } = {}) {
    const wasSpeaking = this.mode === 'speaking';
    if (wasSpeaking) {
      this.token++;
      this.speaker.stop();
      this.mode = 'paused';
      this.updatePlayIcon();
    }
    const moved = await this.advance(delta);
    if (!moved && delta < 0) this.showNote('Inicio del libro');
    if (wasSpeaking) {
      await sleep(90);
      this.play();
    }
  }

  async goTo(chapterIndex, segmentIndex = 0, { autoplay = false } = {}) {
    if (chapterIndex < 0 || chapterIndex >= this.content.chapters.length) return;
    const wasSpeaking = this.mode === 'speaking' || autoplay;
    this.token++;
    this.speaker.stop();
    this.mode = 'paused';
    this.updatePlayIcon();
    this.chapterIndex = chapterIndex;
    this.forceRender = true;
    await this.renderChapter();
    this.setSegment(clamp(segmentIndex, 0, Math.max(0, this.segments.length - 1)), { smooth: false });
    this.scroller.scrollTo({ top: 0, behavior: 'auto' });
    if (wasSpeaking) {
      await sleep(90);
      this.play();
    } else {
      this.saveNow();
    }
  }

  seekToBlock(blockIndex) {
    const idx = this.segments.findIndex((s) => s.blockIndex === blockIndex);
    if (idx < 0) return;
    const wasSpeaking = this.mode === 'speaking';
    this.token++;
    this.speaker.stop();
    this.mode = 'paused';
    this.updatePlayIcon();
    this.setSegment(idx);
    if (wasSpeaking) setTimeout(() => this.play(), 90);
    else this.saveNow();
  }

  cycleSpeed() {
    const steps = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2];
    const idx = steps.findIndex((s) => Math.abs(s - Number(prefs.rate)) < 0.01);
    const next = steps[(idx + 1) % steps.length];
    setPrefs({ rate: next });
    this.updatePlayer();
    toast(`Velocidad ${next.toFixed(2)}×`, '', 1600);
    if (this.mode === 'speaking') {
      this.token++;
      this.speaker.stop();
      this.mode = 'paused';
      setTimeout(() => this.play(), 90);
    }
  }

  togglePdfView() {
    if (this.book.format !== 'pdf') return;
    this.pdfMode = this.pdfMode === 'page' ? 'text' : 'page';
    const seg = this.segmentIndex;
    const wasSpeaking = this.mode === 'speaking';
    this.token++;
    this.speaker.stop();
    this.mode = 'paused';
    this.forceRender = true;
    this.renderChapter().then(() => {
      this.setSegment(Math.min(seg, this.segments.length - 1), { smooth: false });
      const btn = $('#pdfViewLabel');
      if (btn) btn.textContent = this.pdfMode === 'page' ? 'Pág.' : 'Texto';
      if (wasSpeaking) setTimeout(() => this.play(), 100);
    });
  }

  /* ------------------------------------------------------------------- varios */
  onKey(e) {
    if (e.defaultPrevented) return;
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      this.toggle();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.step(1, { fromUser: true });
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.step(-1, { fromUser: true });
    } else if (e.key === 'Escape') {
      if (!$('#sheet')?.hidden) return;
      e.preventDefault();
      this.exit();
    } else if (String(e.key || '').toLowerCase() === 't') {
      this.options.onTOC?.(this);
    }
  }

  onVisibility() {
    if (document.hidden) this.saveNow();
    else if (this.mode === 'speaking') this.requestWakeLock();
  }

  async requestWakeLock() {
    try {
      if (!('wakeLock' in navigator) || document.hidden) return;
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch { this.wakeLock = null; }
  }

  releaseWakeLock() {
    try { this.wakeLock?.release?.(); } catch { /* noop */ }
    this.wakeLock = null;
  }

  syncMediaSession() {
    if (!('mediaSession' in navigator) || !this.book) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.book.title,
        artist: this.book.author || 'LectorStudio',
        album: this.chapter?.title || 'Audiolibro',
        artwork: this.book.cover ? [{ src: this.book.cover, sizes: '512x512', type: 'image/jpeg' }] : []
      });
      navigator.mediaSession.setActionHandler('play', () => this.play());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.step(-1, { fromUser: true }));
      navigator.mediaSession.setActionHandler('nexttrack', () => this.step(1, { fromUser: true }));
    } catch { /* Safari antiguo */ }
  }

  updateTocProgress() {
    return (ch) => {
      const total = this.totalSegments || 1;
      return Math.round(((this.cum?.[ch] || 0) / total) * 100);
    };
  }

  async exit() {
    this.saveNow();
    this.token++;
    this.speaker.stop();
    this.releaseWakeLock();
    this.savePosition.cancel();
    try { await this.#writePosition(); } catch { /* noop */ }
    this.destroy();
    this.options.onExit?.();
  }

  destroy() {
    this.mounted = false;
    this.token++;
    try { this.speaker.stop(); } catch { /* noop */ }
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    this.revokeAssets();
    try { this.pdf?.destroy(); } catch { /* noop */ }
    this.pdf = null;
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
      try {
        for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward']) {
          navigator.mediaSession.setActionHandler(action, null);
        }
      } catch { /* noop */ }
    }
    document.body.classList.remove('reading', 'has-player');
    $('#player').hidden = true;
    $('#view').innerHTML = '';
  }
}
