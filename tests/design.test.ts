import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  colors,
  layout,
  magnets,
  noteStyleFor,
  paper,
  sheet,
  tilts,
} from '../src/ui/tokens.ts';

function toRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function linearize(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Mezcla un color con alfa sobre el fondo, como hace `rgba()` en pantalla. */
function blend(foregroundHex: string, backgroundHex: string, alpha: number): string {
  const foreground = toRgb(foregroundHex);
  const background = toRgb(backgroundHex);
  return toHex(foreground.map((channel, index) => channel * alpha + background[index]! * (1 - alpha)));
}

function alphaOf(rgba: string): number {
  const match = /rgba\([^)]*,\s*([0-9.]+)\)/.exec(rgba);
  assert.ok(match, `color con alfa ilegible: ${rgba}`);
  return Number(match[1]);
}

test('el texto sobre la puerta cumple contraste AA o superior', () => {
  assert.ok(contrast(colors.tx, colors.wall) >= 10, 'título sobre la puerta');
  assert.ok(contrast(colors.mu, colors.wall) >= 4.5, 'texto secundario sobre la puerta');
  assert.ok(contrast(colors.onac, colors.ac) >= 4.5, 'texto del botón principal');
});

test('el texto de las notas cumple AA en los seis papeles', () => {
  for (const background of paper) {
    assert.ok(contrast(colors.ntx, background) >= 8, `título sobre ${background}`);
    const label = blend(colors.ntx, background, alphaOf(colors.noteLabel));
    assert.ok(contrast(label, background) >= 4.5, `etiqueta sobre ${background}`);
    const support = blend(colors.ntx, background, alphaOf(colors.noteMuted));
    assert.ok(contrast(support, background) >= 4.5, `texto de apoyo sobre ${background}`);
  }
});

test('papeles e imanes siguen sus secuencias sin repetir contiguos', () => {
  assert.equal(paper.length, 6);
  assert.equal(new Set(paper).size, 6);
  assert.equal(magnets.length, 6);
  for (let index = 0; index < paper.length; index += 1) {
    assert.notEqual(paper[index], paper[(index + 1) % paper.length]);
    assert.notEqual(magnets[index], magnets[(index + 1) % magnets.length]);
  }
});

test('ninguna nota se inclina más de 2° ni repite el ángulo de al lado', () => {
  assert.deepEqual([...tilts], [-1.6, 1.2, 0.8, -1, 1.5, -0.7]);
  for (const tilt of tilts) {
    assert.ok(Math.abs(tilt) <= 2);
  }
  for (let index = 0; index < tilts.length; index += 1) {
    assert.notEqual(tilts[index], tilts[(index + 1) % tilts.length]);
  }
});

test('la secuencia de papel, imán e inclinación se reutiliza por posición', () => {
  assert.deepEqual(noteStyleFor(0), { backgroundColor: paper[0], magnet: magnets[0], tilt: tilts[0] });
  assert.deepEqual(noteStyleFor(6), noteStyleFor(0));
  assert.deepEqual(noteStyleFor(-1), noteStyleFor(5));
  // El imán no sigue el color del papel: la secuencia va desfasada.
  assert.notEqual(noteStyleFor(2).magnet, noteStyleFor(2).backgroundColor);
});

test('medidas base de la guía y hoja grande', () => {
  assert.equal(layout.radius, 2);
  assert.equal(layout.gutter, 18);
  assert.equal(layout.magnetSize, 20);
  assert.equal(layout.magnetOverhang, 8);
  assert.ok(layout.minTouchTarget >= 44);
  assert.equal(sheet.paper, paper[1]);
  assert.equal(sheet.magnet, magnets[0]);
  assert.ok(Math.abs(sheet.tilt) <= 2);
});
