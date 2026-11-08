# Arquitectura · LectorStudio

## Decisión principal: PWA en lugar de app nativa

El requisito era una sola app para PC, Android y iOS, con biblioteca local, OCR y voz. Se eligió una **Progressive Web App** instalable porque:

- Un solo código para los tres sistemas, sin App Store ni Play Store ni cadenas de compilación.
- Acceso a lo necesario sin plugins nativos: `indexedDB` para biblioteca, `speechSynthesis` para voz, `canvas` + WebAssembly para OCR y PDF.
- Se puede servir desde el propio PC (`server.py`) y también publicar como sitio estático con HTTPS para instalarla en el teléfono.
- Funciona sin conexión con un service worker.

Contrapartidas: en iOS el OCR y la voz dependen del motor del sistema; la instalación en teléfono exige HTTPS; y el almacenamiento puede ser desalojado por el navegador (de ahí el respaldo y el aviso en iOS).

## Capas

```
Interfaz (index.html + css/app.css)
  ├─ library.js     estantería, «Continuar», búsqueda/orden
  ├─ reader.js      lector, resaltado, reproducción, marcador
  └─ sheets.js      ajustes, voces, índice, menú, instalación

Dominio
  ├─ epub.js        EPUB → capítulos → bloques
  ├─ pdfdoc.js      PDF → texto / OCR → párrafos con cajas
  ├─ import.js      orquesta importación y re-OCR
  ├─ speech.js      Web Speech API, troceado y cola
  ├─ text.js        frases, trozos de voz, offsets
  └─ backup.js      ZIP completo

Persistencia
  ├─ db.js          IndexedDB
  └─ prefs.js       localStorage (ajustes, no libros)

Infraestructura
  ├─ sw.js          caché offline
  ├─ server.py      servidor estático local
  └─ vendor/        PDF.js, Tesseract.js, JSZip, modelos
```

Sin frameworks ni paso de compilación: módulos ES nativos. Se puede editar y recargar.

## Modelo de datos (IndexedDB `lectorstudio`, versión 1)

| Tienda | Clave | Contenido |
|---|---|---|
| `books` | `id` | título, autor, formato, tamaño, portada (dataURL), idioma, nº de capítulos, estadísticas, `ocr` y avisos |
| `contents` | `id` | `chapters[]` con bloques (`t`, `text`, `html`, `lines`, `page`, `ocr`) |
| `files` | `id` | archivo original (Blob) + metadatos; permite re-renderizar el PDF y rehacer OCR |
| `assets` | `id` (`bookId::ruta`) | imágenes extraídas del EPUB (Blob), índice por `bookId` |
| `positions` | `bookId` | capítulo, frase, porcentaje, título de capítulo, extracto, fecha |

Los libros se guardan completos en el dispositivo. El texto estructurado se separa de los metadatos para que la estantería no cargue capítulos enteros.

## EPUB

1. JSZip abre el contenedor → `META-INF/container.xml` → OPF.
2. Se leen metadatos (`dc:title`, `dc:creator`, `dc:language`), manifiesto, spine (se omiten `linear="no"`) y portada (`cover-image`, `meta name="cover"` o nombre del archivo).
3. Índice: `nav` de EPUB 3 y, si falta, `toc.ncx`.
4. Cada documento del spine se parsea con `DOMParser` (`application/xml`; fallback a `text/html`).
5. Un recorrido del cuerpo produce **bloques**: `p`, `h1..h6`, `li`, `blockquote`, `pre`, `figcaption` e `img`. Los `div`/`section` se recorren; el texto suelto se agrupa en párrafos.
6. El HTML en línea se sanea con lista blanca (`em`, `strong`, `br`, `sup`…), sin atributos, enlaces, scripts ni estilos. Se descarta el CSS del libro: tipografía uniforme y predecible para la lectura.
7. Las imágenes se guardan como Blob en `assets` y se referencian por id; se cargan al abrir el capítulo y se revocan al salir.

Los bloques conservan `text` (normalizado) para estadísticas y `html` seguro para pintar. Al renderizar, las frases se calculan sobre el `textContent` real del bloque para que los desplazamientos del resaltado siempre coincidan.

## PDF

### Detección de texto

- PDF.js `getTextContent()` entrega fragmentos con transformación. Se agrupan por línea base y se reconstruyen líneas con su caja visible usando `viewport.convertToViewportPoint`.
- Una página se considera «con texto» si tiene ≥ 25 caracteres y más del 45 % son letras/números. Si no, se marca para OCR.
- En PDFs mixtos solo se rasterizan las páginas sin texto.

### OCR

- Se renderiza la página a ~1650 px de ancho (máx. escala 3,2) en un canvas blanco.
- Tesseract.js (WASM) reconoce con `spa`, `spa+eng` o `eng`; los modelos están en `vendor/tessdata` y se cachean.
- Se usan las líneas con su `bbox`; se normalizan a fracciones de página `[x, y, w, h]`.
- Un `worker` se reutiliza entre páginas y se reinicia si cambia el idioma.
- El OCR corre en el hilo del worker: la interfaz sigue respondiendo y muestra progreso por página.
- Cancelar importación se comprueba entre páginas.

### Párrafos y resaltado

Las líneas se agrupan en párrafos por hueco vertical, línea corta e indentación. Cada párrafo guarda sus líneas con la caja normalizada. Al leer una frase, `rectsForRange` devuelve las cajas de las líneas que la contienen; en la vista de página se dibujan como capas absolutas sobre el canvas.

### Render

La vista de página usa `page.render()` sobre un canvas con `devicePixelRatio` limitado a 2 y ancho máximo ~900 CSS px. Solo se dibuja la página actual; el resto se libera.

## Lector y marcador

- El estado es `chapterIndex` + `segmentIndex`. Un segmento es una **frase** con `blockIndex`, `start`, `end` y texto.
- El porcentaje global se calcula con el número de frases por capítulo (prefijo acumulado).
- Al abrir, se carga `positions/<bookId>` y se coloca el segmento; el contenedor `.reader-body` se desplaza para dejar la frase a ~34 % de la altura.
- El resaltado usa `Range.getClientRects()` y capas absolutas; así funciona aunque la frase cruce cursivas o negritas, sin modificar el DOM.
- El marcador se guarda con debounce (600 ms) y de forma forzada al pausar, salir, ocultar la pestaña o cerrar.
- En PDF se puede alternar página/texto conservando la frase.
- `Media Session` publica título, portada y controles; `Wake Lock` evita que se apague la pantalla mientras se escucha.

## Voz

- `speechSynthesis` con las voces del sistema. Se ordenan por calidad: **neuronales/naturales** primero (Dalia, Jorge, Elvira, Siri, voces «Enhanced»), luego la coincidencia regional (`es-MX`), después las locales y por último las de red.
- En Windows, **Microsoft Edge** expone las voces neuronales online de Microsoft; Chrome solo las SAPI locales. El lanzador `LectorStudio-Edge.bat` abre la app en Edge y `server.py --browser edge` hace lo mismo. La app también muestra un aviso con enlace a Edge si detecta solo voces locales.
- Cada frase se trocea a ≤ 190 caracteres por puntuación, para evitar el corte de utterances largas en Chrome.
- La cola avanza en `onend`; un watchdog por duración estimada evita quedarse colgada si el motor no avisa.
- Entre párrafos se intercala una pausa de 160 ms para que la lectura no suene atropellada.
- **iOS**: la primera locución se lanza dentro del gesto del usuario y se hace un desbloqueo silencioso. Después, la cadena de frases funciona sin gesto.
- Pausar detiene la locución y reanudar repite la frase actual (más predecible que `pause()` en todos los navegadores).
- Al cambiar velocidad o voz con la lectura activa, se reinicia desde la frase actual.
- En **Android** se prioriza Google TTS (y el español de EE. UU. para libros `es-MX`); en **iOS**, las voces Siri/Enhanced/Premium que Safari exponga. Los navegadores móviles no ofrecen las voces neuronales de Edge de escritorio.
- Sin conexión, la selección automática prefiere una voz local; si había una voz neuronal online fijada, se sustituye por una local y se avisa.
- Un modo de voz por servidor (edge-tts en la PC por wifi o un backend en la nube) permitiría las mismas voces de Edge en el teléfono, pero rompe el funcionamiento offline y no está incluido.

## Almacenamiento y respaldo

- Se pide `navigator.storage.persist()` al importar, para reducir el riesgo de desalojo.
- Ajustes muestra uso/cuota y permite exportar/restaurar.
- El respaldo es un ZIP sin compresión (los EPUB/PDF ya están comprimidos): `library.json` + `files/` + `assets/`, con los Blob originales.

## Service worker

- Precarga la interfaz, los módulos, PDF.js y las muestras.
- Estrategia *stale-while-revalidate* para estáticos; navegación con red primero y caché de respaldo.
- Tesseract, sus modelos y las fuentes de PDF.js se cachean al primer uso (son pesados).
- Cambiar archivos de la app requiere subir `CACHE` en `sw.js` para forzar la actualización.

## Seguridad

- Todo el contenido de EPUB se sanea antes de insertarse; no se ejecuta JavaScript de los libros.
- El texto de PDF y OCR se inserta con `textContent` o `escapeHtml`.
- No hay `eval`, ni carga remota, ni claves.
- El servidor local solo sirve archivos del proyecto y bloquea rutas fuera de la carpeta (`SimpleHTTPRequestHandler` con `directory`).

## Límites conocidos

- EPUB con DRM no se abre.
- El OCR es óptico: una fotocopia muy torcida, con poco contraste o letra diminuta puede producir errores.
- No hay detección de columnas múltiples en PDF; en revistas a dos columnas el orden de lectura puede mezclarse.
- Los PDF con rotaciones complejas o formularios pueden perder la posición exacta del resaltado.
- El OCR de un libro de 300 páginas tarda decenas de minutos y consume batería.
- No hay sincronización automática entre dispositivos; el transporte es el ZIP de respaldo.
- En iOS, el navegador puede desalojar el almacenamiento si la app no se usa; el aviso y el respaldo cubren ese riesgo.
