# Pruebas · LectorStudio

Todas las pruebas se hicieron con la app servida en `http://127.0.0.1:8840` y **Chrome 156 / Edge 157 headless** en Windows, controlados por CDP. El perfil de cada navegador se creó vacío en cada corrida, así que los resultados incluyen el primer arranque real (sin caché ni bases de datos previas).

## Escenarios y resultado

| # | Escenario | Resultado |
|---|---|---|
| 1 | Carga inicial sin libros | Estantería vacía, estado vacío, manifest y PWA detectados, sin errores de consola. |
| 2 | Importar EPUB desde el selector de archivos real | `Voces de papel`, 3 capítulos, portada extraída, 1.3 s (incluye el sondeo de la interfaz). |
| 3 | Abrir el libro y renderizar | 11 frases en el capítulo 1, 6 bloques, barra del reproductor y portada en el reproductor. |
| 4 | Resaltado de una frase | 4 rectángulos sobre la frase, sin modificar el texto; visible al hacer scroll. |
| 5 | Guardar marcador | Frase 9 de 11 (30 %), guardada en IndexedDB. |
| 6 | Recargar la página y continuar | La tarjeta «Continúa» conserva 30 %; al abrir vuelve a la frase 9 y al capítulo 1. |
| 7 | Imagen dentro de un EPUB | Capítulo 2 muestra la figura extraída del ZIP y su pie de foto. |
| 8 | Importar PDF escaneado (fotocopia) | OCR en español, 1094 caracteres, 195 palabras, acentos y comillas correctos; 5–7 s para una página A4. |
| 9 | Vista «Texto» del OCR | 14 frases, párrafos legibles, resaltado de la frase activa. |
| 10 | Vista «Página» del OCR | Canvas de 900×1273 px, recuadro dorado sobre el texto reconocido. |
| 11 | Importar PDF digital | 3 páginas, 3 capítulos, 2543 caracteres, **sin OCR** (0 páginas), 0.5 s. |
| 12 | Alternar página/texto en PDF digital | Conserva la frase; el texto se reflowa en 5 párrafos. |
| 13 | Reproducción en voz alta | Con las 21 voces del sistema: avanza de la frase 0 a la 1 y a la 2; pausa y reanudación funcionan; «siguiente» salta a la frase 3 y sigue hablando. |
| 13b | Voces neuronales en Edge | Edge 157 expone 323 voces, 47 en español. La app elige automáticamente **Dalia** (es-MX, neuronal) para el EPUB, la muestra en el reproductor y avanza de la frase 0 a la 1 sin errores. |
| 13c | Agrupación y aviso de voces | La hoja separa Neuronales / Locales / En línea y deja Otros idiomas plegado. En Chrome (solo SAPI) aparece el aviso para abrir en Edge. |
| 13d | Ranking móvil (simulado con listas de voces) | Android elige primero Google es-US para un libro `es-MX`; iOS elige Mónica (Enhanced); sin conexión, ambas configuraciones caen a una voz local. |
| 14 | Respaldo ZIP | 431 KB: 3 libros, 3 contenidos, 3 archivos, 1 imagen y 3 marcadores. |
| 15 | Restaurar respaldo | Se borra un libro y se restaura: vuelven los 3 libros, la portada y el marcador. |
| 16 | Sin conexión | Con el service worker activo y la red desactivada: la biblioteca carga con sus 3 libros y un libro se abre y muestra sus 12 frases. |
| 17 | Viewport móvil 390×844 | Sin desbordamiento horizontal; biblioteca y lector se adaptan; al reabrir, el lector se desplaza a la frase guardada. |
| 18 | Ajustes | 5 opciones en el resumen para `es-MX` (automática + 4 voces), hoja completa con 22 opciones, 3 temas, almacenamiento (14.2 MB usados de 10 GB), botones de respaldo. En Edge el resumen muestra las 47 voces españolas. |
| 19 | Menú y detalles de libro | Metadatos correctos (archivo, tamaño, páginas, palabras, fecha). |
| 20 | Índice | 3 capítulos con el actual marcado; tocar el tercero abre «Voces prestadas». |
| 21 | Hoja de voces | 22 opciones, agrupadas por idioma; selección y prueba de voz. |
| 22 | Re-OCR desde el menú | «Listo · OCR en 1 pág.» sin duplicar el libro. |
| 23 | Eliminar libro | Confirmación y descenso de 3 a 2 tarjetas. |

## Evidencia visual

- [Biblioteca vacía](capturas/biblioteca-vacia.png)
- [Biblioteca con libros y «Continuar»](capturas/biblioteca.png)
- [Lector en escritorio](capturas/lector-escritorio.png)
- [Fotocopia reconocida, vista texto](capturas/pdf-fotocopia-texto.png)
- [Fotocopia original con el texto resaltado](capturas/pdf-fotocopia-pagina.png)
- [Lector en móvil, retomando la frase guardada](capturas/movil-lector.png)
- [Lector en Edge con la voz neuronal Dalia](capturas/lector-edge.png)
- [Voces neuronales en Edge](capturas/voces-neuronales.png)
- [Ajustes](capturas/ajustes.png)

## Cómo se probó

- **Navegador**: Chrome 156 y Edge 157 (`--headless=new`), protocolo CDP con `Runtime.evaluate`, `Page.captureScreenshot`, `Network.emulateNetworkConditions` y `DOM.setFileInputFiles`.
- **Datos**: `samples/libro-demo.epub` (3 capítulos, portada e imagen), `samples/fotocopia.pdf` (A4 escaneada, con ruido y giro de 0.35°), `samples/libro-texto.pdf` (3 páginas con capa de texto, generado con Chrome).
- **Medición**: tiempos de `performance.now()` y de la interfaz; el OCR se midió con una página A4 a 1650 px de ancho.

### Comprobaciones manuales sugeridas antes de publicar

1. Abrir la app en un **iPhone real** (Safari) y probar *Compartir → Añadir a pantalla de inicio*, la voz Premium y el marcador.
2. Abrir en un **Android real** con Chrome y comprobar la instalación, Google TTS y el marcador.
3. Importar un PDF escaneado de **más de 50 páginas** y verificar el aviso de tiempo y la cancelación.
4. Exportar un respaldo grande (> 200 MB) y restaurarlo en otro equipo.
5. Probar un EPUB con DRM para confirmar el mensaje de error.

## Lo que no se pudo probar aquí

- Safari/iOS y Chrome/Android en hardware físico (solo emulación de viewport).
- Voces de Siri y voces «Premium» de iOS.
- Comportamiento del navegador ante cuotas de almacenamiento llenas.
- PDFs con columnas múltiples, formularios o rotaciones complejas.
- Lectura de EPUB con DRM (no soportada por diseño).
