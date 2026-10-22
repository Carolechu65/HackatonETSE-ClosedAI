# Estilo «Nevera Retro»: guía de diseño

Guía completa del estilo visual **Nevera Retro** para la app de compañeros de piso. Está pensada para que cualquier agente o persona pueda reproducir el estilo sin ver la maqueta original. Cuando esta guía y tu criterio no coincidan, manda la guía.

- **Maqueta de referencia:** https://claude.ai/artifact/QAFPqD4PU3bmdEMGswDv1f#retro (grupo «Nevera», versión «Nevera Retro»)
- **Tipo de app:** organización de un piso compartido: turnos de limpieza, gastos a medias, lista de la compra, avisos, planes y tareas.
- **Plataforma:** móvil, en vertical. La maqueta está dibujada a 320 px de ancho útil.

---

## 1. La idea en una frase

La pantalla es **la puerta de una nevera de los años cincuenta**: esmalte color crema, notas de papel en tonos pastel sujetas con **imanes redondos de colores con brillo**, cada una algo torcida. Todo lo que el piso necesita saber está pegado ahí.

### Principios

1. **Fondo = puerta, contenido = papel.** La información va siempre sobre una nota de papel. No hay tarjetas «de interfaz» con bordes y sombras genéricas.
2. **Hecho a mano, pero ordenado.** Las notas se inclinan un poco (como mucho ±1,6°), pero se colocan en una rejilla limpia. Desordenado sí, caótico no.
3. **Pocos colores fuertes y siempre pequeños.** El color saturado solo aparece en los imanes, en el botón principal y en el subrayado de la pestaña activa. El resto es crema y pastel.
4. **Serif cálida para lo que se lee, mono para lo que se consulta.** Los títulos van en Fraunces; los datos, etiquetas y textos de apoyo, en DM Mono.
5. **Sin fotos ni ilustraciones.** La información se apoya en tipografía, importes grandes, listas para marcar, tablas pequeñas e iniciales de los compañeros.

---

## 2. Color

### 2.1 Tokens

| Token | Valor | Uso |
|---|---|---|
| `--wall` | `#efe2c4` | Fondo de la pantalla (la puerta de la nevera). |
| `--tx` | `#3b2a1a` | Texto sobre la puerta: cabecera, pestañas, filtros. Marrón café, nunca negro. |
| `--mu` | `#7f705b` | Texto secundario sobre la puerta. Sale de mezclar 62 % de `--tx` con `--wall`. |
| `--ln` | `#c4b69b` | Líneas finas sobre la puerta. Sale de mezclar 24 % de `--tx` con `--wall`. |
| `--ac` | `#d9473b` | Acento: botón principal, subrayado activo, imán por defecto. Rojo cereza. |
| `--onac` | `#fff6ec` | Texto sobre el acento. |
| `--ntx` | `#2b2723` | Texto dentro de las notas de papel. |

Fórmulas de los tokens derivados:

```css
--mu: color-mix(in srgb, var(--tx) 62%, var(--wall));
--ln: color-mix(in srgb, var(--tx) 24%, var(--wall));
```

### 2.2 Papel de las notas (siempre en este orden)

| # | Nombre | Valor |
|---|---|---|
| 1 | Mantequilla | `#f5df9a` |
| 2 | Menta | `#bfe0cf` |
| 3 | Cereza clara | `#f2b8b0` |
| 4 | Cielo | `#bcd6e6` |
| 5 | Nata | `#f7f0e1` |
| 6 | Galleta | `#e9c9a7` |

En una lista de más de seis notas, la secuencia vuelve a empezar. Dos notas contiguas nunca deben tener el mismo color.

### 2.3 Imanes (siempre en este orden)

| # | Nombre | Valor |
|---|---|---|
| 1 | Rojo cereza | `#d9473b` |
| 2 | Verde botella | `#2f7d6d` |
| 3 | Mostaza | `#e8a33a` |
| 4 | Azul esmalte | `#3c6ea8` |
| 5 | Rojo cereza | `#d9473b` |
| 6 | Verde botella | `#2f7d6d` |

El imán de cada nota **no** sigue el color del papel: va con su propia secuencia, desfasada. Así sale la mezcla aleatoria de una nevera de verdad.

### 2.4 Texto dentro de una nota

El texto de una nota toma siempre `--ntx` (`#2b2723`) y sus variaciones con transparencia:

| Elemento | Color |
|---|---|
| Títulos, importes, texto principal | `#2b2723` |
| Texto de apoyo | `color-mix(in srgb, #2b2723 78%, transparent)` |
| Etiquetas en mayúsculas | `color-mix(in srgb, #2b2723 60%, transparent)` |
| Líneas de tablas | `color-mix(in srgb, #2b2723 20%, transparent)` |

### 2.5 Contraste (WCAG)

| Pareja | Ratio | Nivel |
|---|---|---|
| `--tx` sobre `--wall` | 10,67 | AAA |
| `--ntx` sobre cualquier papel | entre 8,65 y 13,06 | AAA |
| `--mu` sobre `--wall` | 3,74 | Solo AA para texto grande |
| `--onac` sobre `--ac` (botón) | 4,00 | Solo AA para texto grande |
| Etiquetas (60 %) sobre papel | ~3,5 | Solo AA para texto grande |

**Ajuste recomendado para producción** (la estética casi no cambia):

- Botón principal: `--ac: #bf3a2f`. El texto pasa a 5,09:1.
- Texto secundario sobre la puerta: `--mu: #6a5c48`. Pasa a 5,05:1.
- Etiquetas dentro de las notas: subir la opacidad al 72 %.

Los imanes y los subrayados son decoración y no tienen que cumplir contraste de texto.

---

## 3. Tipografía

Las dos familias están en Google Fonts:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=DM+Mono:wght@300;400&display=swap">
```

| Rol | Familia | Peso | Pila de respaldo |
|---|---|---|---|
| Títulos (display) | **Fraunces** | 400 (600 solo si hace falta énfasis) | `'Fraunces', Georgia, serif` |
| Texto y datos | **DM Mono** | 300 normal, 400 para cifras y etiquetas activas | `'DM Mono', ui-monospace, monospace` |

### Escala

Medidas para una pantalla de 320 px; si el ancho es mayor, se escalan en proporción.

| Elemento | Familia | Tamaño | Interlineado | Otros |
|---|---|---|---|---|
| Título de pantalla («Tablón») | Fraunces | 58 px | 0,9 | `letter-spacing: -0.015em` |
| Título del detalle | Fraunces | 45 px | 0,92 | |
| Importe del detalle | Fraunces | 64 px | 0,9 | `tabular-nums` |
| Campo de importe al escribir | Fraunces | 46 px | 1,1 | |
| Título de una nota | Fraunces | 19 px | 1,02 | |
| Importe dentro de una nota | Fraunces | 30 px | 0,95 | `tabular-nums` |
| Campo de texto de formulario | Fraunces | 24 px | 1,1 | |
| Comentario citado | Fraunces | 17 px | 1,2 | Entre comillas latinas « » |
| Texto | DM Mono 300 | 12 px | 1,55 | |
| Texto de apoyo en nota | DM Mono 300 | 11 px | 1,55 | |
| Etiqueta (mayúsculas) | DM Mono | 9,5 px | — | `letter-spacing: .16em; text-transform: uppercase` |
| Pestañas y filtros | DM Mono | 9,5–10 px | — | `letter-spacing: .14em; uppercase` |
| Texto del botón principal | DM Mono 400 | 10,5 px | — | `letter-spacing: .16em; uppercase` |

Reglas:

- Los títulos **nunca** van en mayúsculas. Las etiquetas **siempre**.
- Todas las cifras (dinero, horas, recuentos) llevan `font-variant-numeric: tabular-nums`.
- El dinero se escribe en formato español: `84,20 €`, con coma decimal y el símbolo detrás separado por un espacio.

---

## 4. Forma, medidas y profundidad

| Propiedad | Valor |
|---|---|
| Radio del papel, chips y botones | **2 px**. Esquinas casi rectas, como papel cortado. |
| Radio de los avatares | 50 % (círculos) |
| Grosor de línea | 1 px |
| Margen lateral de la pantalla | 18 px |
| Margen interior de una nota | 18 px arriba (deja sitio al imán), 10 px a los lados y 12 px abajo |
| Separación entre notas | 16 px en vertical y 10 px en horizontal |
| Sombra del papel | `0 1px 1px rgba(40,30,20,.12), 0 6px 14px -8px rgba(40,30,20,.40)` |
| Sombra de una hoja grande | `0 1px 1px rgba(40,30,20,.12), 0 10px 20px -10px rgba(40,30,20,.45)` |
| Sombra del imán | `0 2px 3px rgba(0,0,0,.35)` |

Las sombras son **cálidas**, con base marrón y nunca gris neutro, y muy cortas: el papel está pegado a la puerta, no flota. Los elementos de interfaz que no son papel (pestañas, filtros, cabecera) no llevan sombra.

---

## 5. Componentes

### 5.1 La puerta (fondo)

- Un color plano `#efe2c4`, sin degradados ni textura.
- Arriba de todo, la barra de estado del sistema en DM Mono 11 px y color `--tx`.

### 5.2 Cabecera de pantalla

```
LA PUERTA DE LA NEVERA        ← etiqueta, --mu
Tablón                         ← Fraunces 58 px, --tx
```

- Margen: 8 px arriba y 16 px abajo.
- Alineada a la izquierda, nunca centrada.

### 5.3 Filtros

- Fila horizontal con 14 px de separación: `TODO · GASTOS · TAREAS · COMPRA · PLANES`.
- Inactivo: color `--mu`. Activo: color `--tx` y `border-bottom: 2px solid var(--ac)`.
- Sin cajas ni fondos. Si no caben, se corta la fila (no se parte en dos líneas).

### 5.4 Nota de papel (`.n-note`)

Es la pieza central del estilo.

```css
.n-note {
  position: relative;
  padding: 18px 10px 12px;
  color: #2b2723;
  border-radius: 2px;
  box-shadow: 0 1px 1px rgba(40,30,20,.12), 0 6px 14px -8px rgba(40,30,20,.4);
  display: grid;
  gap: 4px;
}
```

**Inclinación.** Cada nota gira según su posición, con esta secuencia exacta (en grados): `-1.6, 1.2, 0.8, -1, 1.5, -0.7`. A partir de la séptima, la secuencia vuelve a empezar.

**Contenido, en este orden:**

1. Etiqueta: `TIPO · CUÁNDO` (por ejemplo `GASTO · AYER`). Si la nota está fijada, solo el tipo.
2. Título en Fraunces 19 px.
3. El bloque propio de cada tipo (ver 5.6).

### 5.5 Imán redondo (`::before` de la nota)

```css
.n-note::before {
  content: "";
  position: absolute;
  top: -8px;               /* sobresale del borde superior */
  left: 50%;
  width: 20px; height: 20px;
  margin-left: -10px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 35% 30%, rgba(255,255,255,.6), transparent 45%),
    var(--mg);             /* color del imán según la secuencia */
  box-shadow: 0 2px 3px rgba(0,0,0,.35);
}
```

- Siempre **centrado arriba** y sobresaliendo unos 8 px por encima del papel.
- El brillo blanco arriba a la izquierda es imprescindible: es lo que lo hace parecer plástico de los cincuenta.
- Un solo imán por nota. Nada de chinchetas, celo ni clips: eso corresponde a otras variantes.

### 5.6 Qué lleva cada tipo de nota

| Tipo | Bloque propio |
|---|---|
| **Limpieza / turnos** | Tabla de dos columnas (zona, persona) con líneas finas y la persona alineada a la derecha. Ocupa **todo el ancho** de la rejilla. |
| **Gasto** | Importe grande en Fraunces 30 px y debajo el reparto (`21,05 € cada uno · sept y oct`). |
| **Compra** | Lista para marcar: cuadrado de 11 px con borde de 1 px; si está hecho, el cuadrado se rellena y el texto queda tachado y en gris. |
| **Plan** | Fila de avatares solapados (−5 px) y texto `3 de 4 van`. Avatar relleno = va; vacío = no ha respondido. |
| **Aviso** | Solo texto de apoyo, 11 px. |
| **Tarea** | Texto de apoyo y una barra de progreso de 6 px (fondo `--ntx` al 12 %, relleno `--ntx`). |

### 5.7 Avatares

- Círculo de 24 px (38 px en formularios) con borde de 1 px del color del texto y la inicial en DM Mono 10 px.
- Seleccionado o relleno: fondo `--ntx` e inicial `#fff8ef`.
- No se usan fotos de perfil.

### 5.8 Hoja grande (detalle y formularios)

En las pantallas de detalle y de añadir, todo el contenido va sobre **una sola hoja de papel grande**:

- Papel: **menta `#bfe0cf`** (el color nº 2).
- Imán: **rojo cereza** (el nº 1), con el mismo estilo que en 5.5.
- Inclinación: `-0.6deg`, menos que una nota.
- Margen interior: 22 px arriba y 14 px a los lados.
- Sombra: la de «hoja grande» (sección 4).
- Dentro de la hoja, los importes y el acento toman `--ntx` en lugar del rojo, para que se lean bien sobre el verde.

### 5.9 Botón principal

```css
.cta {
  display: block; width: 100%;
  background: var(--ac); color: var(--onac);
  font: 400 10.5px 'DM Mono', monospace;
  letter-spacing: .16em; text-transform: uppercase;
  padding: 13px; border-radius: 2px;
  border: 1px solid var(--ln);
  margin-top: 14px;
}
```

- Va **fuera** de la hoja de papel, sobre la puerta, ocupando todo el ancho.
- El texto dice exactamente qué pasa: «Marcar mi parte como pagada», «Añadir gasto».

### 5.10 Chips de selección

- Borde de 1 px, radio de 2 px, DM Mono 10 px en mayúsculas y 4 × 9 px de relleno.
- Seleccionado: fondo del color del texto y texto del color del papel.

### 5.11 Interruptor

- 38 × 20 px, completamente redondo, con borde de 1 px del color del texto.
- Activado: relleno del color de acento y bolita de 12 px a la derecha.

### 5.12 Barra de pestañas

- Fija abajo, con `border-top: 1px solid var(--ln)` y relleno de 11 px arriba y 18 px abajo.
- Cuatro pestañas: `TABLÓN · GASTOS · TAREAS · PISO`, en DM Mono 9,5 px y mayúsculas.
- Activa: color `--tx` y subrayado de 2 px en `--ac` separado 5 px del texto. Inactivas: `--mu`.
- Sin iconos. Si hubiera que ponerlos, de línea fina de 1,5 px y en el mismo color que el texto.

---

## 6. Pantallas

### 6.1 Tablón

```
┌───────────────────────────────┐
│ 9:41                5G · 82%  │
│ LA PUERTA DE LA NEVERA        │
│ Tablón                        │  ← Fraunces 58
│ TODO  GASTOS  TAREAS  COMPRA  │  ← "TODO" subrayado en rojo
│ ┌──────── ● ──────────────┐   │  ← nota ancha (turnos), mantequilla
│ │ LIMPIEZA                 │  │
│ │ Turnos de noviembre      │  │
│ │ Cocina ........... Dani  │  │
│ │ Baño ............ Lucía  │  │
│ └──────────────────────────┘  │
│ ┌──── ● ────┐ ┌──── ● ────┐   │  ← 2 columnas, cada una inclinada
│ │ GASTO     │ │ COMPRA    │   │
│ │ Factura…  │ │ Lo que…   │   │
│ │ 84,20 €   │ │ ☐ Aceite  │   │
│ └───────────┘ └───────────┘   │
│ …                             │
│ TABLÓN  GASTOS  TAREAS  PISO  │
└───────────────────────────────┘
```

- Rejilla de **dos columnas** iguales (`grid-template-columns: 1fr 1fr`) con `align-items: start`, para que cada nota tenga su propia altura.
- La nota de turnos de limpieza (la fijada) ocupa las dos columnas y va siempre la primera.
- Orden habitual: fijada → gasto → compra → aviso → plan → tarea. En producción, la fijada primero y después por fecha, de la más reciente a la más antigua.

### 6.2 Detalle de un gasto

Sobre la puerta: fila `← GASTOS` y `Nº 030` en etiqueta. Debajo, la hoja grande de color menta, con este contenido:

1. Etiqueta `GASTO · SUMINISTROS`.
2. Título «Factura de la luz» (Fraunces 45 px).
3. Importe «84,20 €» (Fraunces 64 px).
4. Lista de definiciones entre dos líneas finas: Pagó / Fecha / Periodo / Reparto.
5. Etiqueta `QUIÉN DEBE QUÉ` y filas con avatar, nombre, estado en etiqueta (Pendiente o Pagado el 22 oct) e importe a la derecha. Lo ya pagado va en gris.
6. Un comentario: autor y hora en etiqueta, y el texto en Fraunces 17 px entre « ».

Debajo de la hoja, sobre la puerta: botón rojo «Marcar mi parte como pagada».

### 6.3 Añadir

Hoja grande de color menta con:

1. Cabecera `AÑADIR AL TABLÓN` / «Nuevo».
2. **Tipo:** chips `AVISO · GASTO · TAREA · COMPRA · PLAN`, con «Gasto» seleccionado.
3. **Concepto:** texto en Fraunces 24 px sobre una línea inferior de 1 px. Sin caja.
4. **Importe:** Fraunces 46 px con cursor parpadeante.
5. **Repartir entre:** cuatro avatares de 38 px con el nombre debajo; los elegidos van rellenos. La etiqueta muestra el cálculo: `15,60 € CADA UNO`.
6. **Fijar en el tablón:** interruptor con explicación en 10 px («Arriba del todo hasta que se pague»).

Debajo de la hoja: botón rojo «Añadir gasto».

---

## 7. Movimiento

- **Al aparecer:** las notas caen 6 px y se asientan con su inclinación final (`transform` y `opacity`, 220 ms, `cubic-bezier(.2,.7,.3,1)`), con 40 ms de retraso entre una y la siguiente.
- **Al pulsar una nota:** se endereza a 0° y sube 2 px (150 ms). Al soltar vuelve a su ángulo.
- **Al marcar un elemento de la compra:** el tachado se dibuja de izquierda a derecha en 200 ms.
- **Al borrar o archivar una nota:** se desliza hacia abajo y desaparece, como si se despegara.
- Con `prefers-reduced-motion: reduce` se quitan todas las animaciones; las notas conservan su inclinación estática.

---

## 8. Textos (tono)

- En español de España, tuteando y con frases cortas, como escribiría un compañero de piso.
- Nombres de cosas reales: «Turnos de noviembre», «Lo que falta en casa», «El casero viene el martes».
- Botones que dicen la acción exacta. Nada de «Aceptar» u «OK».
- Fechas relativas en las notas («hace 2 h», «ayer», «mar») y absolutas en el detalle («21 oct · 21:40»).
- Sin emojis.

---

## 9. Qué no hacer

- ❌ Tarjetas blancas con sombra gris genérica: todo es papel con color y sombra cálida.
- ❌ Esquinas muy redondeadas (más de 4 px) en el papel.
- ❌ Inclinaciones de más de 2°, o todas las notas giradas hacia el mismo lado.
- ❌ Negro puro (`#000`) o blanco puro (`#fff`) en fondos o texto.
- ❌ Imanes del mismo color que su papel, o varios imanes por nota.
- ❌ Fotos, ilustraciones, degradados en el fondo o texturas de madera o corcho.
- ❌ Títulos en mayúsculas, o etiquetas en minúsculas.
- ❌ Un tercer tipo de letra. Solo Fraunces y DM Mono.
- ❌ El rojo de acento en grandes superficies: solo en el botón, el subrayado y los imanes.
- ❌ Mezclar elementos de otras variantes de Nevera (celo de Post‑it, imanes cuadrados de Acero, letras de imán).

---

## 10. CSS de referencia

```css
:root {
  /* Nevera Retro */
  --wall: #efe2c4;
  --tx:   #3b2a1a;
  --mu:   color-mix(in srgb, var(--tx) 62%, var(--wall));
  --ln:   color-mix(in srgb, var(--tx) 24%, var(--wall));
  --ac:   #d9473b;   /* producción accesible: #bf3a2f */
  --onac: #fff6ec;
  --ntx:  #2b2723;

  --paper-1: #f5df9a; --paper-2: #bfe0cf; --paper-3: #f2b8b0;
  --paper-4: #bcd6e6; --paper-5: #f7f0e1; --paper-6: #e9c9a7;
  --magnet-1: #d9473b; --magnet-2: #2f7d6d; --magnet-3: #e8a33a; --magnet-4: #3c6ea8;

  --font-display: 'Fraunces', Georgia, serif;
  --font-body: 'DM Mono', ui-monospace, monospace;

  --radius: 2px;
  --gutter: 18px;
  --shadow-paper: 0 1px 1px rgba(40,30,20,.12), 0 6px 14px -8px rgba(40,30,20,.4);
  --shadow-sheet: 0 1px 1px rgba(40,30,20,.12), 0 10px 20px -10px rgba(40,30,20,.45);
  --shadow-magnet: 0 2px 3px rgba(0,0,0,.35);
}

body { background: var(--wall); color: var(--tx); font: 300 12px/1.55 var(--font-body); }
.title { font: 400 58px/.9 var(--font-display); letter-spacing: -0.015em; margin: 0; }
.label { font-size: 9.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--mu); }

.board { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 10px; align-items: start; }
.note  { position: relative; padding: 18px 10px 12px; border-radius: var(--radius);
         color: var(--ntx); box-shadow: var(--shadow-paper); display: grid; gap: 4px; }
.note--wide { grid-column: 1 / -1; }
.note .label { color: color-mix(in srgb, var(--ntx) 60%, transparent); }
.note h2 { font: 400 19px/1.02 var(--font-display); margin: 0; }

.note::before {
  content: ""; position: absolute; top: -8px; left: 50%;
  width: 20px; height: 20px; margin-left: -10px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.6), transparent 45%), var(--mg);
  box-shadow: var(--shadow-magnet);
}

/* papel, imán e inclinación por posición */
.note:nth-child(6n+1) { background: var(--paper-1); --mg: var(--magnet-1); transform: rotate(-1.6deg); }
.note:nth-child(6n+2) { background: var(--paper-2); --mg: var(--magnet-2); transform: rotate(1.2deg); }
.note:nth-child(6n+3) { background: var(--paper-3); --mg: var(--magnet-3); transform: rotate(.8deg); }
.note:nth-child(6n+4) { background: var(--paper-4); --mg: var(--magnet-4); transform: rotate(-1deg); }
.note:nth-child(6n+5) { background: var(--paper-5); --mg: var(--magnet-1); transform: rotate(1.5deg); }
.note:nth-child(6n+6) { background: var(--paper-6); --mg: var(--magnet-2); transform: rotate(-.7deg); }

.sheet { position: relative; background: var(--paper-2); --mg: var(--magnet-1); color: var(--ntx);
         padding: 22px 14px 16px; border-radius: var(--radius); box-shadow: var(--shadow-sheet);
         transform: rotate(-.6deg); }
.sheet::before { /* el mismo imán que .note::before */ }

.cta { display: block; width: 100%; background: var(--ac); color: var(--onac);
       font: 400 10.5px var(--font-body); letter-spacing: .16em; text-transform: uppercase;
       padding: 13px; border-radius: var(--radius); border: 1px solid var(--ln); margin-top: 14px; }

.tabs { display: flex; justify-content: space-around; border-top: 1px solid var(--ln);
        padding: 11px 6px 18px; font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--mu); }
.tabs .is-active { color: var(--tx); text-decoration: underline; text-decoration-color: var(--ac);
                   text-decoration-thickness: 2px; text-underline-offset: 5px; }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
```

---

## 11. Comprobación final

Antes de dar una pantalla por terminada:

- [ ] El fondo es `#efe2c4` plano y todo el contenido va sobre papel.
- [ ] Los papeles y los imanes siguen sus secuencias, y no hay dos notas contiguas del mismo color.
- [ ] Cada nota tiene un único imán redondo con brillo, centrado arriba y sobresaliendo.
- [ ] Las inclinaciones siguen `-1.6, 1.2, 0.8, -1, 1.5, -0.7` y ninguna pasa de 2°.
- [ ] Los títulos van en Fraunces, sin mayúsculas, y el resto en DM Mono.
- [ ] Las etiquetas van en mayúsculas espaciadas y las cifras tienen `tabular-nums`.
- [ ] El rojo solo aparece en el botón, el subrayado activo y los imanes.
- [ ] El detalle y los formularios van sobre una hoja menta con imán rojo, y el botón queda fuera de la hoja.
- [ ] Los radios son de 2 px (círculos solo en avatares, imanes e interruptor).
- [ ] No hay fotos, emojis, negro puro ni blanco puro.
- [ ] El contraste del texto pequeño llega a 4,5:1 (con el ajuste de la sección 2.5 si es producción).
