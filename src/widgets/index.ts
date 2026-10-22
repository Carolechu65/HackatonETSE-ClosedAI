/**
 * Punto de entrada puro de P6 (sin React Native).
 *
 * `publisher.ts` no se exporta aquí a propósito: importa la plantilla nativa y
 * solo la app debe cargarla. Los tests de Node importan estos módulos.
 */
export * from './snapshot.ts';
export * from './links.ts';
export * from './viewModel.ts';
