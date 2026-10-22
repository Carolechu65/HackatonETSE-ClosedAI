# Marca · alarmaT

La marca activa es la **casilla roja con X negra** del logotipo P1 integrado desde GitHub en `alarmat-logo.svg`. El símbolo del launcher, splash y favicon se extrae de su primer grupo vectorial: conserva exactamente el rectángulo, trazados, círculos, colores y grosor originales. Solo cambia la transformación exterior para centrarlo en cada lienzo. `alarmat-logo.svg` y su PNG completo se conservan intactos para la cabecera.

| Archivo | Uso |
|---|---|
| `alarmat-logo.svg` / `.png` | Logotipo completo original P1, casilla y texto |
| `checkbox.svg` / `checkbox-icon.png` | Icono de aplicación 1024×1024, fondo `#efe2c4` |
| `checkbox-foreground.svg` / `checkbox-adaptive-icon.png` | Símbolo transparente 1024×1024, inscrito en círculo seguro 66% |
| `checkbox-splash.svg` / `checkbox-splash-icon.png` | Símbolo transparente 1024×1024, ocupación 74% |
| `icon.png`, `adaptive-icon.png`, `splash-icon.png` | Alias activos que consume `app.config.ts` |
| `favicon.svg` / `favicon.png` | Icono web explícito; PNG 48×48 con fondo |
| `bell*`, `clock*` | Alternativas anteriores, conservadas sin sustituirlas |

La casilla mantiene `#bf3a2f` y la X `#2b2723`. Android dibuja el fondo del icono adaptativo en `#efe2c4`; el splash usa el mismo color con `imageWidth: 220`. La caja vectorial incluye el grosor exterior y el extremo de la X (`179..983` en ambos ejes), evitando recortes. El adaptive icon inscribe la diagonal completa de esa caja en el 66% central del lienzo, de modo que también cabe bajo una máscara circular.

## Regenerar

```sh
npm run brand:render
```

Requiere `rsvg-convert` o ImageMagick (`convert`); el script elige el disponible. Los PNG están versionados y compilar la app no requiere esas herramientas. El render genera SVG de icono a partir del logotipo fuente; no redibuja el símbolo. Si cambia su geometría, debe revisarse su caja en `scripts/brand/render.mjs`.

La ejecución normal actualiza únicamente el icono activo y sus alias. Para regenerar además los PNG de las alternativas anteriores, conservando sus SVG:

```sh
node scripts/brand/render.mjs --all
```

## Validación

Launcher, adaptive y splash se generan a 1024×1024; favicon a 48×48. El launcher se ha inspeccionado visualmente contra el logotipo original. La validación de instalación, máscaras del launcher y arranque en frío corresponde al APK final; no se afirma una prueba física del nuevo icono.
