# ADR-004 · Marca, icono y splash

**Fecha:** 2026-10-22 · **Owner:** P1 · **Estado:** aceptado

## Contexto

El scaffold no tenía icono, splash ni identidad visual propia. La app se llama **alarmaT**: «alarma» + la letra T, que también suena a «alarmarte/alarmarte». El estilo obligatorio es [Nevera Retro](../../nevera-retro.md), y el launcher Android recorta los iconos con máscara (círculo, squircle, etc.).

Se valoraron dos conceptos:

1. **Campanita:** campana de notificación con el emblema dentro.
2. **Despertador:** reloj de doble campana con el emblema en la esfera.

## Decisión

- **Marca activa: campanita.** Es la que mejor se lee a 48 dp en el launcher y la que ya está conectada en `app.config.ts`. El despertador se conserva generado como alternativa (`clock-*.png`) para poder cambiar sin diseñar otra vez.
- **Emblema: una T mayúscula girada −42°.** Los dos trazos de la T (barra y asta) forman el tick: el asta es el brazo corto, la mitad derecha de la barra el brazo largo y el resto de la barra queda como pie en el vértice. Así el icono se lee como check a tamaño pequeño sin dejar de ser una T reconocible.
- **Paleta de la guía:** puerta `#efe2c4`, campana `#bf3a2f`, emblema `#fff6ec`, badajo `#3b2a1a`; en el despertador, campanas `#e8a33a`.
- **Sin texto, sin degradados, sin tercer color.** Fondo plano; el icono legacy lleva la puerta y el adaptive icon va transparente sobre `#efe2c4`.
- **Vector como fuente:** `assets/brand/*.svg` se versionan y los PNG se generan con `npm run brand:render` (`rsvg-convert`). Los PNG también se versionan para que nadie necesite la herramienta para compilar.
- **Zona segura:** el símbolo se inscribe en el **círculo** del 66 % del adaptive icon, no en un cuadrado. Escalar solo por altura recortaba la falda de la campana con máscaras circulares.

## Consecuencias

- Cambiar de concepto es editar tres rutas en `app.config.ts`; no hay código implicado.
- Cualquier cambio de logo exige `npm run brand:render` y reconstruir la build nativa: el icono y el splash no se actualizan con Fast Refresh.
- No hay icono monochrome para iconos temáticos de Android: el hueco del check necesitaría una máscara propia. Se pospone.
- El icono legacy (iOS) no se ha probado en dispositivo; Android es la plataforma del hackathon.
- El splash usa la misma puerta con `imageWidth: 220`; no se ha validado el arranque en frío en un móvil físico, solo la generación del recurso y la compilación del APK.
