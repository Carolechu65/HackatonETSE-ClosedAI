# Marca · alarmaT

Dos propuestas de icono, ambas vectoriales y con la paleta de [Nevera Retro](../../nevera-retro.md). La **activa es la campana**; el despertador queda generado como alternativa.

| Concepto | Fuente | Uso |
|---|---|---|
| **Campanita** (activa) | `bell.svg` | `icon.png`, `adaptive-icon.png`, `splash-icon.png` |
| **Despertador** (alternativa) | `clock.svg` | `clock-icon.png`, `clock-adaptive-icon.png`, `clock-splash-icon.png` |

La marca: una campana (o un despertador de doble campana) con una **T mayúscula girada −42°** que se lee como tick. El asta de la T es el brazo corto del check, la mitad derecha de la barra el brazo largo y el resto de la barra queda como pie en el vértice. Decisión y alternativas en [ADR-004](../../docs/adr/004-marca-e-icono.md). Sin degradados, sin texto y sin más colores que los de la guía.

## Paleta

| Uso | Color |
|---|---|
| Fondo (puerta) | `#efe2c4` |
| Cuerpo de la campana / reloj | `#bf3a2f` |
| Check de la campana | `#fff6ec` |
| Check del reloj | `#2b2723` |
| Campanas del despertador | `#e8a33a` |
| Badajo, patas y martillo | `#3b2a1a` |

## Archivos

```text
bell.svg / clock.svg              fuente editable 1024×1024 con fondo
bell-foreground.svg               generado: símbolo sin fondo para adaptive icon
bell-splash.svg                   generado: símbolo sin fondo con más margen
*-icon.png                        1024×1024 con fondo (icono legacy)
*-adaptive-icon.png               1024×1024 transparente, 66 % del círculo seguro
*-splash-icon.png                 1024×1024 transparente
icon.png / adaptive-icon.png       marca activa que lee app.config.ts
splash-icon.png
```

`app.config.ts` apunta a los nombres estables (`icon.png`, `adaptive-icon.png`, `splash-icon.png`). El fondo del adaptive icon es `#efe2c4` y el splash usa la misma puerta con `imageWidth: 220`.

## Regenerar

```sh
sudo apt install librsvg2-bin   # solo la primera vez
npm run brand:render
```

El script `scripts/brand/render.mjs` calcula el tamaño del logo a partir de su caja real y lo inscribe en el **círculo seguro** del adaptive icon (66 %), porque Android recorta con máscara circular: escalar solo por altura recortaría la falda de la campana.

## Cambiar de concepto

En `app.config.ts`, cambia las tres rutas a `clock-icon.png`, `clock-adaptive-icon.png` y `clock-splash-icon.png`. No hace falta tocar código.

## Límites

- No hay versión monochrome para iconos temáticos de Android: el check es un hueco y exige máscara propia. Se añade si la demo lo necesita.
- El icono legacy (iOS) no se ha probado en dispositivo; Android es la plataforma del hackathon.
- Los PNG están versionados para que nadie necesite `rsvg-convert` para compilar la app.
