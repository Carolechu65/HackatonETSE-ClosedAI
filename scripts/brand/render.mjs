#!/usr/bin/env node
/** Reproduce the active checkbox mark directly from the checked-in P1 logo.
 * No paths, colors, or stroke widths are redrawn. Only the enclosing transform
 * changes to fit each output canvas. Legacy bell/clock alternatives are retained.
 * Requires rsvg-convert OR ImageMagick convert. Use --all for legacy PNGs too.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const brandDir = fileURLToPath(new URL('../../assets/brand/', import.meta.url));
const CANVAS = 1024;
const background = '<rect width="1024" height="1024" fill="#efe2c4"/>';
const renderer = spawnSync('rsvg-convert', ['--version']).status === 0 ? 'rsvg-convert' : 'convert';
if (spawnSync(renderer, ['-version']).error) throw new Error('Install librsvg2-bin or ImageMagick to render brand assets.');

// Extract only the first group, retaining the rect and X vector commands exactly.
// The logo's outer group positions it alongside the wordmark; icons use their
// own positioning transform, without altering its vector geometry.
function firstGroupContents(source) {
  const start = source.search(/<g\b/);
  if (start < 0) throw new Error('P1 logo is missing its symbol group.');
  const openEnd = source.indexOf('>', start) + 1;
  const tags = /<\/?g\b[^>]*>/g; tags.lastIndex = start;
  let depth = 0;
  for (let token; (token = tags.exec(source));) {
    depth += token[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return source.slice(openEnd, token.index).trim();
  }
  throw new Error('P1 logo has an unclosed symbol group.');
}
function svg(body, box, fraction, circle = false, opaque = false) {
  const width = box.maxX - box.minX, height = box.maxY - box.minY;
  const scale = CANVAS * fraction / (circle ? Math.hypot(width, height) : Math.max(width, height));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">\n<!-- Generated from alarmat-logo.svg; original checkbox and X paths retained. -->\n${opaque ? background : ''}\n<g transform="translate(512 512) scale(${scale.toFixed(8)}) translate(-${(box.minX + box.maxX) / 2} -${(box.minY + box.maxY) / 2})">\n${body}\n</g>\n</svg>\n`;
}
function render(source, output, size = CANVAS) {
  if (renderer === 'rsvg-convert') execFileSync(renderer, ['-w', String(size), '-h', String(size), source, '-o', output]);
  else execFileSync(renderer, ['-background', 'none', source, '-resize', `${size}x${size}`, '-strip', `PNG32:${output}`]);
}
const symbol = firstGroupContents(readFileSync(path.join(brandDir, 'alarmat-logo.svg'), 'utf8'));
if (!symbol.includes('width="624"') || !symbol.includes('cx="960"')) throw new Error('P1 symbol geometry changed; review its bounds before regenerating.');
// Includes stroke on x/y=200 (42/2), and the final X round cap at960+23.
const box = { minX: 179, minY: 179, maxX: 983, maxY: 983 };
for (const variant of [
  { source: 'checkbox.svg', output: 'checkbox-icon.png', fraction: .78, opaque: true },
  { source: 'checkbox-foreground.svg', output: 'checkbox-adaptive-icon.png', fraction: .66, circle: true },
  { source: 'checkbox-splash.svg', output: 'checkbox-splash-icon.png', fraction: .74 },
]) {
  const source = path.join(brandDir, variant.source);
  writeFileSync(source, svg(symbol, box, variant.fraction, variant.circle, variant.opaque));
  render(source, path.join(brandDir, variant.output));
}
for (const name of ['icon', 'adaptive-icon', 'splash-icon']) copyFileSync(path.join(brandDir, `checkbox-${name}.png`), path.join(brandDir, `${name}.png`));
copyFileSync(path.join(brandDir, 'checkbox.svg'), path.join(brandDir, 'favicon.svg'));
render(path.join(brandDir, 'favicon.svg'), path.join(brandDir, 'favicon.png'), 48);
if (process.argv.includes('--all')) {
  for (const mark of ['bell', 'clock']) {
    render(path.join(brandDir, `${mark}.svg`), path.join(brandDir, `${mark}-icon.png`));
    render(path.join(brandDir, `${mark}-foreground.svg`), path.join(brandDir, `${mark}-adaptive-icon.png`));
    render(path.join(brandDir, `${mark}-splash.svg`), path.join(brandDir, `${mark}-splash-icon.png`));
  }
}
console.log(`Active mark: P1 checkbox + X. Launcher/adaptive/splash1024px; favicon48px. Renderer: ${renderer}.`);
