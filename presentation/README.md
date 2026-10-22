# Presentación de alarmaT

> **Estado: borrador.** No es la versión final: sirve para revisar contenido y diseño con el equipo. Las cifras y capturas están al día del 22 de octubre de 2026; el guion y las diapositivas pueden cambiar.

Deck estático para exponer el proyecto. Misma estética que la app (Nevera Retro), fuentes locales y capturas reales de la rama `P1-Esqueleto`.

## Ver en local

```sh
python3 -m http.server 4173 --directory presentation
# http://localhost:4173
```

No necesita instalación ni build. Todo es HTML, CSS y JavaScript; las fuentes y las capturas viven en `fonts/` e `img/`.

## Controles

| Tecla / acción | Efecto |
|---|---|
| `←` `→`, `Espacio`, `PageUp/PageDown` | Navegar |
| `Home` / `End` | Primera / última |
| `N` | Mostrar u ocultar notas del ponente |
| `F` | Pantalla completa |
| Botones inferiores | Navegar y saltar a una diapositiva |
| `#3` en la URL | Abrir una diapositiva concreta |

Imprimir a PDF: `Ctrl/Cmd + P` (una diapositiva por página, sin barra ni notas).

## Contenido

8 diapositivas: portada, problema, idea, los cuatro menús, interacción, tecnologías con logos, estado real (hecho y pendiente) y cierre.

Criterio editorial: **nada se presenta como terminado sin evidencia**. Las capturas salen de la app real; los datos de la UI son de ejemplo.

## Actualizar las capturas

Con la app en `localhost:8081`, capturar Tablón, Tareas, Gastos y Piso a 1296 × 861 y recortar:

```sh
python3 - <<'EOF'
from PIL import Image
src = {'tablon': 'tablon.png', 'tareas': 'tareas.png', 'gastos': 'gastos.png', 'piso': 'piso.png'}
for name, path in src.items():
    Image.open(path).convert('RGB').crop((410, 0, 890, 822)).save(f'img/{name}.png', optimize=True)
Image.open('tareas.png').convert('RGB').crop((80, 822, 1216, 861)).save('img/tabs.png', optimize=True)
EOF
```

Las capturas actuales están hechas con el estado de ejemplo tras recargar (1 tarea hecha, 114,10 € pendientes, 3 de 4 en casa).

## Logos

El logotipo de la portada es `alarmat-logo.svg` (etiqueta con la casilla, la X a pluma y «alarmaT»), copiado a `img/alarmat-logo.svg` y recortado con `viewBox` al dibujo para quitar el margen interno. Los ocho logos están en `img/logos/` en SVG, descargados de [Simple Icons](https://simpleicons.org/) (CC0) con color `#3b2a1a` para respetar la paleta. No se cargan desde internet al presentar.

## Fuentes

Fraunces 400/600 y DM Mono 300/400, copiadas de `@expo-google-fonts` (SIL Open Font License).
