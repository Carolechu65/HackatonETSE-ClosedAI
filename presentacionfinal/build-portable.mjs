#!/usr/bin/env node
/**
 * Genera un único HTML con todo dentro (CSS, JS, fuentes e imágenes) para abrirlo
 * con doble clic en cualquier ordenador, sin servidor y sin red.
 *
 * Uso: node presentacionfinal/build-portable.mjs
 * Salida: presentacion-portable.html
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const output = path.join(root, 'presentacion-portable.html');

const MIME = {
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

async function dataUri(relativePath) {
  const absolute = path.join(here, relativePath);
  const buffer = await readFile(absolute);
  const mime = MIME[path.extname(relativePath).toLowerCase()];
  if (!mime) throw new Error(`Extensión no soportada: ${relativePath}`);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

const html = await readFile(path.join(here, 'index.html'), 'utf8');
let css = await readFile(path.join(here, 'styles.css'), 'utf8');
let js = await readFile(path.join(here, 'deck.js'), 'utf8');

// Fuentes del CSS → data URI
for (const match of [...css.matchAll(/url\('(fonts\/[^']+)'\)/g)]) {
  css = css.replace(match[0], `url('${await dataUri(match[1])}')`);
}

// Imágenes del HTML (svg, png) → data URI
const imgSources = [...html.matchAll(/src="(img\/[^"]+)"/g)].map((match) => match[1]);
let portable = html;
for (const source of imgSources) {
  portable = portable.replaceAll(`src="${source}"`, `src="${await dataUri(source)}"`);
}

portable = portable.replace(
  /<link rel="stylesheet" href="styles\.css[^"]*" \/>/,
  `<style>\n${css}\n</style>`,
);
portable = portable.replace(
  /<script src="deck\.js[^"]*"><\/script>/,
  `<script>\n${js}\n</script>`,
);

// Marca de versión portable en el título
portable = portable.replace(
  /<title>([^<]+)<\/title>/,
  '<title>$1 · portable</title>',
);

if (/src="img\/|href="styles\.css|src="deck\.js|url\('fonts\//.test(portable)) {
  throw new Error('Quedan referencias externas: el archivo no sería portable.');
}

await writeFile(output, portable, 'utf8');
const kb = Math.round(Buffer.byteLength(portable, 'utf8') / 1024);
console.log(`Escrito ${path.relative(root, output)} (${kb} KB, ${imgSources.length} imágenes y 4 fuentes incrustadas).`);
