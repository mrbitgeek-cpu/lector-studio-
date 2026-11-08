# Guía de uso · LectorStudio

LectorStudio es una biblioteca que lee en voz alta. Los libros se guardan en el dispositivo donde los abres; no hay cuentas ni nube.

---

## 1. En la computadora

1. Abre la carpeta del workspace y haz doble clic en **`LectorStudio.bat`**.
2. Se abrirá **Microsoft Edge** en `http://127.0.0.1:8840/` (si Edge no está, el navegador predeterminado). Edge incluye las voces neuronales **Dalia** y **Jorge**.
3. Si el navegador no se abre solo, entra a esa dirección.
4. Para apagar la app, cierra la ventana negra del servidor.

> Si prefieres Chrome, abre `http://127.0.0.1:8840/` en Chrome: funciona igual, pero solo verá las voces locales SAPI (más robóticas). La app te avisará y te ofrecerá abrir Edge.

No necesitas internet para leer: las voces locales funcionan sin conexión. Las voces neuronales sí usan internet.

> También puedes arrancarla desde **`Servidores.bat`** → *LectorStudio* → *Iniciar*.

## 2. En el teléfono o la tablet

### Opción A (recomendada): instalar la PWA

Para instalar la app y que funcione sin conexión, necesita una dirección **HTTPS**. La carpeta `lector-studio/` es estática: no hay que compilar nada.

**Con Netlify Drop (5 minutos, gratis):**

1. Entra a <https://app.netlify.com/drop> desde la computadora.
2. Arrastra la carpeta **`lector-studio`** completa (con `index.html`, `js`, `vendor`, etc.).
3. Espera a que termine la subida y copia la dirección que aparece, por ejemplo `https://algo-random.netlify.app`.
4. Abre esa dirección en el teléfono:
   - **iPhone/iPad**: en **Safari**, toca **Compartir** → **Añadir a pantalla de inicio**.
   - **Android**: en **Chrome**, menú `⋮` → **Instalar aplicación** (o *Añadir a pantalla de inicio*).
5. Abre LectorStudio desde su icono. A partir de ahí funciona sin conexión y los libros quedan guardados en el teléfono.

Alternativas equivalentes: Cloudflare Pages, GitHub Pages, Vercel o cualquier hosting estático con HTTPS. No subas la carpeta padre del workspace: solo `lector-studio/`.

**Con GitHub Pages:**

1. Crea un repositorio y sube el contenido de `lector-studio/`.
2. *Settings → Pages → Deploy from a branch → main / (root)*.
3. Abre `https://TU-USUARIO.github.io/TU-REPO/` en el teléfono e instálala como arriba.

### Opción B: usarla por wifi sin instalar

1. En la PC, doble clic en **`LectorStudio-Red.bat`**.
2. Apunta la dirección que muestra la ventana: `http://192.168.x.x:8840/`.
3. Ábrela en el navegador del teléfono (misma red wifi).
4. Windows puede pedir permiso de firewall la primera vez: acepta para redes privadas.

Así la app funciona, pero **no se instala** y **no queda disponible sin conexión** (el service worker exige HTTPS). Los libros sí se guardan en el teléfono mientras uses esa misma dirección.

> Si cambias de red o la IP de la PC cambia, la dirección también cambia y el navegador lo trata como otro sitio: la biblioteca anterior no aparece. Para uso diario en el teléfono, conviene la Opción A.

## 3. Añadir libros

Pulsa **Añadir libros** o arrastra los archivos a la ventana. Se aceptan:

- **EPUB** (sin DRM).
- **PDF con texto** (libros digitales, documentos exportados).
- **PDF escaneado o fotocopia** (una foto por página, sin texto seleccionable).

La app procesa los archivos de uno en uno y muestra el progreso. Puedes cerrar el panel: la importación sigue.

- Un EPUB tarda menos de un segundo.
- Un PDF digital extrae el texto en décimas de segundo por página.
- Un PDF escaneado pasa por OCR: **3–8 segundos por página** según el equipo. La primera vez se cargan los datos de idioma (unos 8 MB) y puede tardar un poco más.

Si el PDF tiene más de 24 páginas, la app pregunta si quieres reconocer todo o importar solo el texto existente. En un libro escaneado conviene elegir **Reconocer todo**, dejarlo cargando y no cerrar la pestaña.

## 4. Leer y escuchar

Abre un libro tocando su portada.

- **Botón central**: reproducir / pausar la lectura en voz alta.
- **Flechas**: frase anterior / siguiente (también con las teclas `←` y `→`).
- **Espacio**: reproducir o pausar (en computadora).
- **1.0×**: cambia la velocidad (0,8× a 2×).
- **Icono de bocina**: elige otra voz.
- **Aa**: tamaño de letra, interlineado, tema (claro, sepia, oscuro), resaltado y desplazamiento automático.
- **Índice** (arriba a la derecha): capítulos o páginas, con el porcentaje de avance.
- **Toca un párrafo** para empezar a leer desde ahí.

Mientras suena una frase, se resalta en la página y, si hace falta, la vista se desplaza sola. Al pausar o salir, el marcador se guarda solo.

### PDF: página o texto

- En un **PDF escaneado**, la app abre la vista **Texto** (el OCR reflowado), que se lee mejor en el teléfono. El botón *Pág./Texto* cambia a la página original, con la frase resaltada encima de la imagen.
- En un **PDF digital**, abre la página original. También puedes pasar a *Texto* para leer sin zoom.

### Voces en iPhone y Android

La app usa las voces del sistema; no puede usar las voces neuronales de Edge de escritorio.

- **iPhone/iPad**: *Ajustes → Accesibilidad → Contenido leído → Voces → Español*. Descarga una voz **Premium** o **Mejorada** (Mónica, Paulina, etc.). Safari decide cuáles muestra a la web; las Premium suelen aparecer, las de Siri no siempre. La app prioriza las que vea.
- **Android**: instala **Google TTS** y descarga la voz de español (*Ajustes → Accesibilidad → Texto a voz*). La app prioriza las voces de Google sobre las del fabricante; para `es-MX` prefiere el español de EE. UU. antes que el de España. Necesitan internet; sin conexión cae a una voz local.
- En ambos, abre **Elegir voz** para probar las variantes y quedarte con la que más te guste. Las voces **Locales** funcionan sin internet; las **En línea** suenan mejor pero necesitan red.

Para instalar la app en el teléfono, consulta la sección 2: hace falta abrirla por HTTPS y usar *Añadir a pantalla de inicio*.

### Voces

La app usa las voces instaladas en el sistema. No descarga voces propias, pero sí elige y ordena las mejores.

- **Windows, la voz natural**: abre la app con **`LectorStudio-Edge.bat`**, no con Chrome. Microsoft Edge expone las voces **neuronales** Dalia y Jorge (español de México), Elvira y Álvaro (España), etc. La app las pone primero y elige **Dalia** automáticamente para un libro en `es-MX`.
  - Chrome solo ve las voces locales SAPI (Raul/Sabina), que son las que suenan más robóticas.
  - Si abres la app en Chrome, *Ajustes → Voz* muestra un aviso con un enlace **Abrir en Edge**.
- **Android**: *Ajustes → Accesibilidad → Texto a voz* (Google TTS trae varias). La app muestra las voces disponibles y las etiqueta.
- **iPhone/iPad**: *Ajustes → Accesibilidad → Contenido leído → Voces → Español*. Descarga una voz **Mejorada** o **Premium**; suenan mucho más naturales. La app también prioriza las voces Siri/mejoradas.

En la hoja **Elegir voz**:

- **Neuronales · recomendadas**: las más naturales (necesitan internet).
- **Locales · sin internet**: funcionan siempre, aunque suenen más mecánicas.
- **En línea**: otras voces de red.
- **Otros idiomas**: plegado al final.

Toca una voz para oír una muestra; se queda elegida. Si no hay internet, la app usa una voz local automáticamente. La lectura hace pausas breves entre párrafos para sonar menos atropellada.

Si la lista aparece vacía, instala una voz en el sistema y recarga la app.

## 5. Marcador y progreso

- Cada libro guarda **capítulo y frase**, no solo la página.
- La tarjeta **«Sigue donde lo dejaste»** aparece arriba de la estantería con el porcentaje.
- Las tarjetas muestran el avance y la barra dorada.
- *Menú del libro (⋮)* → **Volver al principio** reinicia el marcador.

No hay sincronización automática entre dispositivos: cada uno guarda su copia. Para pasarla, usa el respaldo.

## 6. Respaldo y restauración

*Ajustes* (engranaje arriba a la derecha) → **Exportar respaldo**.

Se descarga un ZIP con:

- los archivos originales (EPUB/PDF),
- el texto reconocido (no hay que repetir el OCR),
- las portadas,
- los marcadores.

Para restaurarlo en otro dispositivo: copia el ZIP, abre LectorStudio allí y usa *Ajustes → Restaurar respaldo*. Los libros se añaden; si ya existe el mismo identificador, se reemplaza.

> En iPhone, Safari puede borrar los datos de webs que no se usan durante días. Instala la app en la pantalla de inicio y exporta un respaldo de vez en cuando.

## 7. Problemas frecuentes

| Síntoma | Qué hacer |
|---|---|
| «No pude extraer texto de este EPUB» | El libro tiene DRM o está dañado. Pruébalo en otro lector. |
| El PDF no muestra texto | Activa *Ajustes → Reconocer fotocopias* y vuelve a importarlo. También puedes usar el menú del libro → *Volver a reconocer el texto (OCR)*. |
| El OCR tarda mucho | Es normal en libros escaneados. Deja la pestaña abierta y el equipo cargando. |
| No hay voces | Instala una voz de español en los ajustes del sistema y recarga. En iPhone usa Safari. |
| La voz suena robótica | En Windows abre la app con `LectorStudio-Edge.bat` y elige Dalia o Jorge; en iPhone descarga una voz Premium. |
| La voz se corta | Baja la velocidad o elige otra voz; algunas voces del sistema fallan en frases muy largas. |
| «No hay espacio suficiente» | Borra libros que no uses desde el menú ⋮ o libera almacenamiento del navegador. |
| Se borró la biblioteca | Restaura el último respaldo. En iPhone, instala la app y ábrela con frecuencia. |
| La app no se instala en el teléfono | Debe ser HTTPS. Por `http://192.168...` solo funciona en el navegador. |
| Cambié de red y no veo mis libros | Cada dirección web es un almacenamiento distinto. Vuelve a la dirección original o usa el respaldo. |

## 8. Privacidad

- Los archivos no se suben a ningún servidor: se leen y se guardan en el navegador.
- El OCR corre en el dispositivo (WebAssembly); no se envía la fotocopia a ninguna parte.
- Las **voces locales** tampoco salen del equipo. Las **voces neuronales en línea** (Dalia en Edge, las de Google) envían solo el texto que se está leyendo a su proveedor para generar el audio. Si quieres privacidad total, elige una voz **Local**.
- La app no pide cuenta, correo ni permisos especiales.
- Si publicas la carpeta en un hosting, solo se descarga el código de la app; los libros siguen siendo locales.
