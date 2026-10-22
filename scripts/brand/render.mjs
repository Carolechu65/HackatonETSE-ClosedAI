#!/usr/bin/env node
/**
 * Genera los PNG de marca a partir de los SVG de `assets/brand/`.
 *
 * SVG = fuente editable. PNG = artefacto versionado que usa Expo.
 * Requiere `rsvg-convert` (paquete `librsvg2-bin` en Debian/Ubuntu).
 *
 *   node scripts/brand/render.mjs
 *
 * - `<marca>-icon.png`: 1024×1024 con fondo de puerta (icono legacy).
 * - `<marca>-adaptive-icon.png`: 1024×1024 transparente; el símbolo llena el 66 %
 *   central para sobrevivir a la máscara de Android.
 * - `<marca>-splash-icon.png`: 1024×1024 transparente con un poco más de margen.
 * - `icon.png`, `adaptive-icon.png`, `splash-icon.png`: la marca activa (campana).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const brandDir = fileURLToPath(new URL('../../assets/brand/', import.meta.url));
const CANVAS = 1024;
const BACKGROUND = '<rect width="1024" height="1024" fill="#efe2c4"/>';

/**
 * Caja real de cada símbolo dentro del lienzo de 1024 (sin el fondo).
 * Se usa para centrar y escalar el adaptive icon: no se supone que el arte
 * llene el SVG, porque el icono legacy necesita aire alrededor.
 */
const marks = [
  { name: 'bell', title: 'campana', box: { minX: 306, maxX: 718, minY: 248, maxY: 746 } },
  { name: 'clock', title: 'despertador', box: { minX: 258, maxX: 766, minY: 182, maxY: 840 } },
];

function foregroundSvg(source, title, box, { fraction, byDiagonal }) {
  const [, rest] = source.split(BACKGROUND);
  if (!rest) {
    throw new Error('El SVG de marca debe declarar el fondo de puerta para poder separarlo.');
  }
  const body = rest.replace('</svg>', '').trim();
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  // El adaptive icon se recorta con una máscara circular: el símbolo debe caber
  // en el círculo seguro, no solo en un cuadrado.
  const reference = byDiagonal ? Math.hypot(width, height) : Math.max(width, height);
  const scale = (CANVAS * fraction) / reference;
  const centerX = box.minX + width / 2;
  const centerY = box.minY + height / 2;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">`,
    `  <!-- ${title}: símbolo sin fondo, escalado al ${Math.round(fraction * 100)} % del ${byDiagonal ? 'círculo seguro' : 'lienzo'} -->`,
    `  <g transform="translate(${CANVAS / 2} ${CANVAS / 2}) scale(${scale.toFixed(4)}) translate(-${centerX} -${centerY})">`,
    indent(body),
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}

function indent(fragment) {
  return fragment
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => `    ${line.trim()}`)
    .join('\n');
}

function render(svgPath, pngPath, size = CANVAS) {
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), svgPath, '-o', pngPath]);
}

for (const mark of marks) {
  const svgPath = path.join(brandDir, `${mark.name}.svg`);
  const source = readFileSync(svgPath, 'utf8');

  const adaptiveSvg = foregroundSvg(source, mark.title, mark.box, { fraction: 0.66, byDiagonal: true });
  const adaptivePath = path.join(brandDir, `${mark.name}-foreground.svg`);
  writeFileSync(adaptivePath, adaptiveSvg);

  const splashSvg = foregroundSvg(source, mark.title, mark.box, { fraction: 0.74, byDiagonal: false });
  const splashPath = path.join(brandDir, `${mark.name}-splash.svg`);
  writeFileSync(splashPath, splashSvg);

  render(svgPath, path.join(brandDir, `${mark.name}-icon.png`));
  render(adaptivePath, path.join(brandDir, `${mark.name}-adaptive-icon.png`));
  render(splashPath, path.join(brandDir, `${mark.name}-splash-icon.png`));

  console.log(`Marca "${mark.title}": icon, adaptive-icon y splash-icon generados.`);
}

// Nombres estables que lee app.config.ts (marca activa: campana).
render(path.join(brandDir, 'bell.svg'), path.join(brandDir, 'icon.png'));
render(path.join(brandDir, 'bell-foreground.svg'), path.join(brandDir, 'adaptive-icon.png'));
render(path.join(brandDir, 'bell-splash.svg'), path.join(brandDir, 'splash-icon.png'));
console.log('Icono activo: campana (bell). Para usar el despertador, cambia las rutas en app.config.ts.');
