/* Hojas de la interfaz: ajustes, voces, índice, menú de libro e instalación. */

import {
  clearLibrary, storageInfo, requestPersistent
} from './db.js';
import { prefs, setPrefs } from './prefs.js';
import {
  loadVoices, voicesForLang, pickVoice, languageName, testVoice, voiceLang, speechSupported,
  isNaturalVoice, voiceTags
} from './speech.js';
import { exportBackup, importBackup } from './backup.js';
import {
  $, $$, escapeHtml, openSheet, closeSheet, confirmDialog, toast,
  fmtBytes, fmtDate
} from './util.js';

const APP_VERSION = '1.0.0';

/* ------------------------------------------------------------------ ajustes */
export function openSettingsSheet({ reader = null, onLibraryChange = () => {} } = {}) {
  openSheet('Ajustes', (body) => {
    const lang = reader?.book?.language || 'es';
    body.innerHTML = `
      <section class="sheet-section">
        <h3>Voz</h3>
        <div class="field" style="align-items:flex-start">
          <div class="field-label">Voz del dispositivo<small>Se usa para leer en voz alta</small></div>
        </div>
        <div id="voicePicker" class="voice-list" style="max-height:190px"><div class="voice-empty">Cargando voces…</div></div>
        <div id="voiceHint"></div>
        <div class="field" style="padding-top:10px">
          <button class="btn btn-ghost btn-sm" id="testVoice">Probar voz</button>
          <button class="btn btn-ghost btn-sm" id="openVoices">Ver todas</button>
        </div>
        <div class="field">
          <div class="field-label">Velocidad<small>Más alta ahorra tiempo; más baja, más pausado</small></div>
          <div style="display:flex;align-items:center;gap:10px">
            <input type="range" id="rateRange" min="0.6" max="2.2" step="0.05" value="${prefs.rate}">
            <span class="range-val" id="rateVal">${Number(prefs.rate).toFixed(1)}×</span>
          </div>
        </div>
        <div class="field">
          <div class="field-label">Tono<small>Grave o agudo</small></div>
          <div style="display:flex;align-items:center;gap:10px">
            <input type="range" id="pitchRange" min="0.6" max="1.6" step="0.05" value="${prefs.pitch}">
            <span class="range-val" id="pitchVal">${Number(prefs.pitch).toFixed(1)}</span>
          </div>
        </div>
        <div class="field">
          <div class="field-label">Volumen</div>
          <div style="display:flex;align-items:center;gap:10px">
            <input type="range" id="volRange" min="0" max="1" step="0.05" value="${prefs.volume}">
            <span class="range-val" id="volVal">${Math.round(prefs.volume * 100)} %</span>
          </div>
        </div>
      </section>

      <section class="sheet-section">
        <h3>Lectura de PDF</h3>
        <div class="field">
          <div class="field-label">Reconocer fotocopias<small>OCR local en las páginas sin texto</small></div>
          <label class="switch"><input type="checkbox" id="ocrToggle" ${prefs.ocrEnabled ? 'checked' : ''}><i></i></label>
        </div>
        <div class="field">
          <div class="field-label">Idioma del OCR<small>Se aplica a los próximos PDF</small></div>
          <select id="ocrLang">
            <option value="spa">Español</option>
            <option value="spa+eng">Español + inglés</option>
            <option value="eng">Inglés</option>
          </select>
        </div>
        <p class="note">El reconocimiento usa <b>Tesseract</b> dentro de este dispositivo. La primera vez descarga el idioma (unos 8 MB) y puede tardar varios minutos en un libro escaneado completo.</p>
      </section>

      <section class="sheet-section">
        <h3>Apariencia</h3>
        <div class="field">
          <div class="field-label">Tema de lectura</div>
          <div class="seg" id="themeSeg">
            <button data-theme="light" class="${prefs.theme === 'light' ? 'on' : ''}">Claro</button>
            <button data-theme="sepia" class="${prefs.theme === 'sepia' ? 'on' : ''}">Sepia</button>
            <button data-theme="dark" class="${prefs.theme === 'dark' ? 'on' : ''}">Oscuro</button>
          </div>
        </div>
        <div class="field">
          <div class="field-label">Tamaño de letra</div>
          <div style="display:flex;align-items:center;gap:10px">
            <input type="range" id="fontRange" min="15" max="28" step="1" value="${prefs.fontSize}">
            <span class="range-val" id="fontVal">${prefs.fontSize} px</span>
          </div>
        </div>
        <div class="field">
          <div class="field-label">Interlineado</div>
          <div style="display:flex;align-items:center;gap:10px">
            <input type="range" id="lineRange" min="1.35" max="2.2" step="0.05" value="${prefs.lineHeight}">
            <span class="range-val" id="lineVal">${Number(prefs.lineHeight).toFixed(2)}</span>
          </div>
        </div>
        <div class="field">
          <div class="field-label">Resaltar la frase que suena</div>
          <label class="switch"><input type="checkbox" id="hlToggle" ${prefs.highlight ? 'checked' : ''}><i></i></label>
        </div>
        <div class="field">
          <div class="field-label">Desplazar la página sola<small>Sigue la lectura sin tocar la pantalla</small></div>
          <label class="switch"><input type="checkbox" id="scrollToggle" ${prefs.autoScroll ? 'checked' : ''}><i></i></label>
        </div>
      </section>

      <section class="sheet-section">
        <h3>Datos en este dispositivo</h3>
        <div id="storageBlock"><div class="kv"><span>Calculando…</span></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-ghost btn-sm" id="exportBtn">Exportar respaldo</button>
          <button class="btn btn-ghost btn-sm" id="importBtn">Restaurar respaldo</button>
        </div>
        <p class="note" style="margin-top:12px">El respaldo es un ZIP con tus libros, el texto reconocido y los marcadores. Úsalo para pasar la biblioteca a otro dispositivo o si vas a borrar los datos del navegador.</p>
        <div style="margin-top:12px">
          <button class="btn btn-danger btn-sm" id="wipeBtn">Borrar toda la biblioteca</button>
        </div>
      </section>

      <div class="about">
        <b>LectorStudio ${APP_VERSION}</b><br>
        Biblioteca local · OCR en el dispositivo · voces del sistema<br>
        Funciona sin conexión una vez instalada.
      </div>`;

    /* ------- voces ------- */
    const picker = $('#voicePicker', body);
    loadVoices().then((voices) => {
      if (!picker) return;
      if (!voices.length) {
        picker.innerHTML = `<div class="voice-warn">Este navegador no expone voces del sistema. En iPhone abre la app en Safari; en Android instala una voz en Ajustes → Accesibilidad → Texto a voz. En escritorio, Chrome o Edge suelen traer voces.</div>`;
        return;
      }
      const current = pickVoice(prefs.voiceURI, lang, voices);
      const list = voicesForLang(lang, voices);
      const natural = list.filter(isNaturalVoice);
      const autoVoice = pickVoice('', lang, voices);
      const autoKind = autoVoice ? (isNaturalVoice(autoVoice) ? 'neuronal' : (autoVoice.localService ? 'local' : 'en línea')) : 'local';
      picker.innerHTML = [
        `<button class="voice-opt ${!prefs.voiceURI ? 'on' : ''}" data-voice="">
          <span>Automática<small>La mejor voz disponible: ${autoKind} para ${escapeHtml(languageName(lang))}</small></span>
          <span class="check">${!prefs.voiceURI ? '✓' : ''}</span>
        </button>`,
        ...list.map((v) => voiceOption(v, current))
      ].join('');
      $$('.voice-opt', picker).forEach((btn) => {
        btn.addEventListener('click', () => {
          setPrefs({ voiceURI: btn.dataset.voice || '' });
          $$('.voice-opt', picker).forEach((b) => { b.classList.remove('on'); b.querySelector('.check').textContent = ''; });
          btn.classList.add('on');
          btn.querySelector('.check').textContent = '✓';
          reader?.refreshVoiceInfo?.();
          reader?.updatePlayer?.();
        });
      });
      renderVoiceHint($('#voiceHint', body), natural, lang);
    });

    $('#testVoice', body).onclick = async () => {
      const voices = await loadVoices();
      if (!voices.length) { toast('No hay voces disponibles en este navegador.', 'err', 5000); return; }
      reader?.pause?.();
      const v = pickVoice(prefs.voiceURI, lang, voices);
      toast(`Probando ${v ? v.name : 'la voz automática'}…`);
      const ok = await testVoice(prefs.voiceURI, 'Así se escuchará tu biblioteca en LectorStudio.', lang, Number(prefs.rate));
      if (!ok) toast('No pude reproducir esa voz. Prueba con otra.', 'err', 5000);
    };
    $('#openVoices', body).onclick = () => openVoiceSheet({ reader });

    /* ------- rangos ------- */
    $('#rateRange', body).oninput = (e) => {
      const val = Number(e.target.value);
      setPrefs({ rate: val });
      $('#rateVal', body).textContent = `${val.toFixed(2)}×`;
      reader?.updatePlayer?.();
    };
    $('#pitchRange', body).oninput = (e) => {
      const val = Number(e.target.value);
      setPrefs({ pitch: val });
      $('#pitchVal', body).textContent = val.toFixed(2);
    };
    $('#volRange', body).oninput = (e) => {
      const val = Number(e.target.value);
      setPrefs({ volume: val });
      $('#volVal', body).textContent = `${Math.round(val * 100)} %`;
    };
    $('#fontRange', body).oninput = (e) => {
      const val = Number(e.target.value);
      setPrefs({ fontSize: val });
      $('#fontVal', body).textContent = `${val} px`;
      reader?.applyTypography?.();
    };
    $('#lineRange', body).oninput = (e) => {
      const val = Number(e.target.value);
      setPrefs({ lineHeight: val });
      $('#lineVal', body).textContent = val.toFixed(2);
      reader?.applyTypography?.();
    };

    /* ------- otros ------- */
    $('#ocrToggle', body).onchange = (e) => setPrefs({ ocrEnabled: e.target.checked });
    $('#ocrLang', body).onchange = (e) => setPrefs({ ocrLang: e.target.value });
    $('#ocrLang', body).value = prefs.ocrLang;
    $('#hlToggle', body).onchange = (e) => {
      setPrefs({ highlight: e.target.checked });
      reader?.applyTypography?.();
      if (e.target.checked) reader?.highlightCurrent?.({ scroll: false });
    };
    $('#scrollToggle', body).onchange = (e) => setPrefs({ autoScroll: e.target.checked });

    $$('#themeSeg button', body).forEach((btn) => {
      btn.onclick = () => {
        setPrefs({ theme: btn.dataset.theme });
        $$('#themeSeg button', body).forEach((b) => b.classList.toggle('on', b === btn));
        reader?.applyTypography?.();
      };
    });

    /* ------- almacenamiento ------- */
    const renderStorage = async () => {
      const info = await storageInfo();
      const block = $('#storageBlock', body);
      if (!block) return;
      const pct = info.quota ? Math.min(100, (info.usage / info.quota) * 100) : 0;
      block.innerHTML = `
        <div class="storage-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
        <div class="kv"><span>Usado por la app y el navegador</span><b>${fmtBytes(info.usage)}</b></div>
        <div class="kv"><span>Disponible aproximado</span><b>${fmtBytes(Math.max(0, info.quota - info.usage))}</b></div>
        <div class="kv"><span>Protección contra borrado automático</span><b>${info.persisted ? 'Activa' : 'No activa'}</b></div>
        ${info.persisted ? '' : '<button class="btn btn-ghost btn-sm" id="persistBtn" style="margin-top:8px">Proteger mis datos</button>'}`;
      $('#persistBtn', block)?.addEventListener('click', async () => {
        const ok = await requestPersistent();
        toast(ok ? 'El navegador protegerá los datos de esta app.' : 'El navegador no concedió la protección. Haz respaldos con frecuencia.', ok ? 'ok' : '', 6000);
        renderStorage();
      });
    };
    renderStorage();

    $('#exportBtn', body).onclick = async () => {
      const note = toast('Preparando respaldo…', '', 600000);
      try {
        const result = await exportBackup((p) => {
          if (note) note.textContent = `${p.phase} · ${Math.round((p.progress || 0) * 100)} %`;
        });
        note?.remove();
        toast(`Respaldo listo: ${result.books} libro(s), ${fmtBytes(result.size)}.`, 'ok', 7000);
      } catch (err) {
        note?.remove();
        toast(err?.message || 'No se pudo crear el respaldo.', 'err', 7000);
      }
    };

    $('#importBtn', body).onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.zip,application/zip';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const ok = await confirmDialog('Restaurar respaldo', 'Se añadirán los libros del respaldo a esta biblioteca. Los libros con el mismo identificador se reemplazan. ¿Continuar?', { ok: 'Restaurar' });
        if (!ok) return;
        const note = toast('Restaurando respaldo…', '', 600000);
        try {
          const result = await importBackup(file);
          note?.remove();
          toast(`Respaldo restaurado: ${result.books} libro(s).`, 'ok', 6000);
          onLibraryChange();
          closeSheet();
        } catch (err) {
          note?.remove();
          toast(err?.message || 'No se pudo restaurar el respaldo.', 'err', 7000);
        }
      };
      input.click();
    };

    $('#wipeBtn', body).onclick = async () => {
      const ok = await confirmDialog('Borrar toda la biblioteca', 'Se eliminarán todos los libros, el texto reconocido y los marcadores de <b>este dispositivo</b>. Esta acción no se puede deshacer. ¿Seguro?', { ok: 'Sí, borrar todo', danger: true });
      if (!ok) return;
      await clearLibrary();
      setPrefs({ lastBookId: '' });
      toast('Biblioteca borrada.', 'ok');
      closeSheet();
      if (reader) reader.exit();
      else onLibraryChange();
    };
  });
}

function voiceOption(v, current) {
  const on = !!(prefs.voiceURI && current && v.voiceURI === current.voiceURI && v.voiceURI === prefs.voiceURI);
  const tags = voiceTags(v);
  return `<button class="voice-opt ${on ? 'on' : ''}" data-voice="${escapeHtml(v.voiceURI)}">
    <span>${escapeHtml(v.name)}<small>${escapeHtml(v.lang)}${tags.length ? ' · ' + tags.map(escapeHtml).join(' · ') : ''}</small></span>
    <span class="check">${on ? '✓' : ''}</span>
  </button>`;
}

function renderVoiceHint(host, natural, lang) {
  if (!host) return;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  if (natural.length) {
    const exact = natural.filter((v) => voiceLang(v).toLowerCase() === String(lang).toLowerCase());
    const names = (exact.length ? exact : natural).slice(0, 4)
      .map((v) => escapeHtml(v.name.replace(/^Microsoft\s+/i, '').replace(/\s+Online.*$/i, '')));
    host.innerHTML = `<div class="voice-good"><b>Voces neuronales disponibles:</b> ${names.join(', ')}. Suenan más naturales que las voces locales antiguas.</div>`;
    return;
  }
  if (android) {
    host.innerHTML = `<div class="voice-warn">En Android, la app prioriza las voces de <b>Google TTS</b>, que suelen sonar mejor que las del fabricante y necesitan internet. Si no aparecen, instálalas en Ajustes → Accesibilidad → Texto a voz. En la hoja de voces puedes probar las variantes de Google.</div>`;
    return;
  }
  if (ios) {
    host.innerHTML = `<div class="voice-warn">En iPhone/iPad, descarga una voz <b>Premium</b> o <b>Mejorada</b> en Ajustes → Accesibilidad → Contenido leído → Voces → Español. Safari no siempre expone todas las voces de Siri a la web; la app usará la mejor que vea.</div>`;
    return;
  }
  const edge = /Edg\//.test(ua);
  if (/Windows/i.test(ua) && !edge) {
    host.innerHTML = `<div class="voice-warn">En Windows, las voces locales del sistema son las más robóticas. Abre esta app en <b>Microsoft Edge</b> para usar las voces neuronales Dalia y Jorge (español de México). <a href="microsoft-edge:${escapeHtml(location.href)}">Abrir en Edge</a></div>`;
    return;
  }
  host.innerHTML = `<div class="voice-warn">No encontré voces neuronales para ${escapeHtml(languageName(lang))} en este dispositivo. Las locales funcionan sin internet, pero suenan más mecánicas.</div>`;
}

/* -------------------------------------------------------------------- voces */
export function openVoiceSheet({ reader = null } = {}) {
  const lang = reader?.book?.language || 'es';
  openSheet('Elegir voz', (body) => {
    body.innerHTML = `<div id="voiceHint2"></div>
      <div id="allVoices"><div class="voice-empty">Cargando voces del dispositivo…</div></div>
      <p class="note" style="margin-top:14px">Las voces <b>neuronales</b> suenan más naturales, pero necesitan internet. Las <b>locales</b> funcionan sin conexión. Toca una voz para oírla y dejarla elegida.</p>`;
    loadVoices().then((voices) => {
      const host = $('#allVoices', body);
      if (!host) return;
      if (!voices.length) {
        host.innerHTML = `<div class="voice-warn">No hay voces disponibles. ${speechSupported ? 'Puedes instalar más voces en los ajustes del sistema.' : 'Este navegador no soporta lectura en voz alta.'}</div>`;
        return;
      }
      const current = pickVoice(prefs.voiceURI, lang, voices);
      const preferred = voicesForLang(lang, voices);
      const natural = preferred.filter(isNaturalVoice);
      const local = preferred.filter((v) => !isNaturalVoice(v) && v.localService);
      const online = preferred.filter((v) => !isNaturalVoice(v) && !v.localService);
      const rest = voices.filter((v) => !preferred.includes(v));
      const groups = new Map();
      for (const v of rest) {
        const base = voiceLang(v).split('-')[0];
        if (!groups.has(base)) groups.set(base, []);
        groups.get(base).push(v);
      }
      renderVoiceHint($('#voiceHint2', body), natural, lang);
      host.innerHTML = `
        <div class="voice-list">
          <button class="voice-opt ${!prefs.voiceURI ? 'on' : ''}" data-voice="">
            <span>Automática<small>La mejor voz para el idioma del libro</small></span><span class="check">${!prefs.voiceURI ? '✓' : ''}</span>
          </button>
          ${natural.length ? `<div class="toc-group">Neuronales · recomendadas</div>${natural.map((v) => voiceOption(v, current)).join('')}` : ''}
          ${local.length ? `<div class="toc-group">Locales · sin internet</div>${local.map((v) => voiceOption(v, current)).join('')}` : ''}
          ${online.length ? `<div class="toc-group">En línea</div>${online.map((v) => voiceOption(v, current)).join('')}` : ''}
          ${groups.size ? `<details class="voice-more">
            <summary>Otros idiomas (${rest.length})</summary>
            ${[...groups.entries()].map(([base, list]) => `
              <div class="toc-group">${escapeHtml(languageName(base))}</div>
              ${list.map((v) => voiceOption(v, current)).join('')}`).join('')}
          </details>` : ''}
        </div>`;
      $$('.voice-opt', host).forEach((btn) => {
        btn.onclick = async () => {
          setPrefs({ voiceURI: btn.dataset.voice || '' });
          $$('.voice-opt', host).forEach((b) => { b.classList.remove('on'); b.querySelector('.check').textContent = ''; });
          btn.classList.add('on');
          btn.querySelector('.check').textContent = '✓';
          reader?.refreshVoiceInfo?.();
          reader?.updatePlayer?.();
          reader?.pause?.();
          const v = pickVoice(prefs.voiceURI, lang, voices);
          toast(`Voz: ${v ? v.name : 'automática'}`);
          await testVoice(prefs.voiceURI, 'Así se escuchará tu libro.', lang, Number(prefs.rate));
        };
      });
    });
  });
}

/* ------------------------------------------------------------------- índice */
export function openTocSheet(reader) {
  if (!reader?.content) return;
  const chapters = reader.content.chapters;
  const current = reader.chapterIndex;
  openSheet('Índice', (body) => {
    const total = reader.totalSegments || 1;
    body.innerHTML = `
      <div class="kv" style="padding-bottom:10px"><span>${escapeHtml(reader.book.title)}</span><b>${Math.round(reader.overallPercent() * 100)} % leído</b></div>
      <div class="toc-list">
        ${chapters.map((ch, i) => {
          const pct = Math.round(((reader.cum?.[i] || 0) / total) * 100);
          return `<button class="toc-item ${i === current ? 'on' : ''}" data-chapter="${i}">
            <span class="toc-num">${String(i + 1).padStart(2, '0')}</span>
            <span class="toc-title">${escapeHtml(ch.title || `Capítulo ${i + 1}`)}</span>
            <span class="toc-pct">${pct} %</span>
          </button>`;
        }).join('')}
      </div>`;
    $$('.toc-item', body).forEach((btn) => {
      btn.onclick = () => {
        closeSheet();
        reader.goTo(Number(btn.dataset.chapter), 0, { autoplay: reader.mode === 'speaking' });
      };
    });
  });
}

/* --------------------------------------------------------------- menú libro */
export function openBookMenu(book, options = {}) {
  openSheet(book.title, (body) => {
    const pos = book.position;
    const pct = Math.round((book.percent || 0) * 100);
    body.innerHTML = `
      <div class="kv"><span>${escapeHtml(book.author || '')}</span><b>${book.format === 'pdf' ? 'PDF' : 'EPUB'}</b></div>
      <div class="kv"><span>${book.chapters || 0} ${book.format === 'pdf' ? 'páginas' : 'capítulos'} · ${fmtBytes(book.size || 0)}</span><b>${pct} % leído</b></div>
      ${book.ocr ? `<div class="kv"><span>OCR: ${book.ocr.pages} página(s)</span><b>${escapeHtml(book.ocr.lang || 'spa')}</b></div>` : ''}
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:18px">
        <button class="btn btn-gold" id="mOpen">${pos ? 'Continuar leyendo' : 'Empezar a leer'}</button>
        ${pos ? '<button class="btn btn-ghost" id="mRestart">Volver al principio</button>' : ''}
        ${book.format === 'pdf' ? '<button class="btn btn-ghost" id="mOcr">Volver a reconocer el texto (OCR)</button>' : ''}
        <button class="btn btn-ghost" id="mDetails">Detalles del archivo</button>
        <button class="btn btn-danger" id="mDelete">Eliminar de este dispositivo</button>
      </div>`;
    $('#mOpen', body).onclick = () => { closeSheet(); options.onOpen?.(book); };
    $('#mRestart', body)?.addEventListener('click', () => { closeSheet(); options.onRestart?.(book); });
    $('#mOcr', body)?.addEventListener('click', () => { closeSheet(); options.onReocr?.(book); });
    $('#mDetails', body).onclick = () => {
      openSheet('Detalles', (b) => {
        b.innerHTML = `<div class="kv"><span>Archivo</span><b>${escapeHtml(book.fileName || '')}</b></div>
          <div class="kv"><span>Tamaño</span><b>${fmtBytes(book.size || 0)}</b></div>
          <div class="kv"><span>Añadido</span><b>${fmtDate(book.addedAt)}</b></div>
          <div class="kv"><span>Idioma</span><b>${escapeHtml(book.language || 'es')}</b></div>
          <div class="kv"><span>Capítulos / páginas</span><b>${book.chapters || 0}</b></div>
          ${book.stats?.words ? `<div class="kv"><span>Palabras aprox.</span><b>${Number(book.stats.words).toLocaleString('es-MX')}</b></div>` : ''}
          ${book.stats?.ocrPages ? `<div class="kv"><span>Páginas por OCR</span><b>${book.stats.ocrPages}</b></div>` : ''}
          ${book.warning ? `<p class="note" style="margin-top:14px;border-color:#6b352c;color:#f0b7ad">${escapeHtml(book.warning)}</p>` : ''}
          <p class="note" style="margin-top:14px">Todo se guarda en este dispositivo. Si borras los datos del navegador, el libro desaparece: usa un respaldo.</p>`;
      });
    };
    $('#mDelete', body).onclick = async () => {
      const ok = await confirmDialog('Eliminar libro', `Se borrará «${escapeHtml(book.title)}» y su marcador de <b>este dispositivo</b>.`, { ok: 'Eliminar', danger: true });
      if (!ok) return;
      closeSheet();
      options.onDelete?.(book);
    };
  });
}

/* --------------------------------------------------------------- instalación */
export function openInstallHelp() {
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(navigator.userAgent);
  openSheet('Instalar LectorStudio', (body) => {
    body.innerHTML = `
      <p class="note" style="margin-top:6px">LectorStudio es una aplicación web instalable: se abre como una app, guarda los libros en el dispositivo y funciona sin conexión tras la primera visita.</p>
      ${iOS ? `<h3 style="margin-top:18px;color:var(--gold);font-size:12px;letter-spacing:.12em">EN IPHONE O IPAD</h3>
        <ol style="color:var(--muted);font-size:14px;line-height:1.8;padding-left:20px">
          <li>Abre esta página en <b>Safari</b>.</li>
          <li>Toca el botón <b>Compartir</b> (el cuadro con la flecha).</li>
          <li>Elige <b>Añadir a pantalla de inicio</b>.</li>
          <li>Ábrela desde el icono: así los libros no se borran con la limpieza de Safari.</li>
        </ol>` : android ? `<h3 style="margin-top:18px;color:var(--gold);font-size:12px;letter-spacing:.12em">EN ANDROID</h3>
        <ol style="color:var(--muted);font-size:14px;line-height:1.8;padding-left:20px">
          <li>Abre esta página en <b>Chrome</b>.</li>
          <li>Toca el menú <b>⋮</b> y elige <b>Instalar aplicación</b> o <b>Añadir a pantalla de inicio</b>.</li>
          <li>Ábrela desde el icono.</li>
        </ol>` : `<h3 style="margin-top:18px;color:var(--gold);font-size:12px;letter-spacing:.12em">EN COMPUTADORA</h3>
        <ol style="color:var(--muted);font-size:14px;line-height:1.8;padding-left:20px">
          <li>En Chrome o Edge, usa el icono de instalar de la barra de direcciones.</li>
          <li>O abre el menú y elige <b>Instalar LectorStudio</b>.</li>
        </ol>`}
      <p class="note">La app necesita una dirección web (http o https). Si abres los archivos con doble clic (file://), el service worker y el almacenamiento de la app no funcionan: usa el lanzador <b>LectorStudio.bat</b> o publica la carpeta en un hosting estático.</p>`;
  });
}

/* ------------------------------------------------------------------ aviso iOS */
export function openIosStorageNotice() {
  openSheet('Para que no se borren tus libros', (body) => {
    body.innerHTML = `<p class="note">En iPhone y iPad, Safari puede borrar los datos de una web que no se usa durante varios días. Para evitarlo:</p>
      <ol style="color:var(--muted);font-size:14px;line-height:1.9;padding-left:20px">
        <li>Instala la app con <b>Compartir → Añadir a pantalla de inicio</b>.</li>
        <li>Ábrela de vez en cuando desde ese icono.</li>
        <li>Exporta un <b>respaldo</b> desde Ajustes si tienes libros que no puedes volver a descargar.</li>
      </ol>
      <button class="btn btn-gold btn-block" id="iosOk" style="margin-top:16px">Entendido</button>`;
    $('#iosOk', body).onclick = closeSheet;
  });
}
