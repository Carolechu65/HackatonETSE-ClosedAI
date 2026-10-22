/**
 * P6 · Contrato de enlaces del widget (`docs/ROUTES.md`).
 *
 * El widget solo abre rutas. Un enlace **nunca** transporta consentimiento,
 * una decisión ni una hora elegida: la pantalla de destino carga la entidad
 * vigente, comprueba sesión y pide una acción explícita.
 *
 * Se validan los identificadores antes de construir o aceptar un enlace para no
 * propagar rutas arbitrarias (`..`, barras codificadas, otros hosts/esquemas).
 */

/** Debe coincidir con `scheme` de `app.config.ts` (P1). */
export const WIDGET_LINK_SCHEME = 'alarmat';

/** Igual que `CONTRACT_LIMITS.identifierLength`; los IDs de Firestore son más cortos. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type WidgetLink =
  | { readonly kind: 'inbox' }
  | { readonly kind: 'tasks' }
  | { readonly kind: 'alarm'; readonly requestId: string }
  | { readonly kind: 'task'; readonly taskId: string };

export function isSafeLinkId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** Tablón: propuestas y próximas alarmas. */
export function inboxLink(): string {
  return `${WIDGET_LINK_SCHEME}:///`;
}

/** All pending and completed tasks in the selected household. */
export function tasksLink(): string {
  return `${WIDGET_LINK_SCHEME}://tasks`;
}

/** Detalle de una propuesta. Abrir no acepta ni programa nada. */
export function alarmLink(requestId: string): string {
  if (!isSafeLinkId(requestId)) {
    throw new Error('Identificador de propuesta inválido para un enlace.');
  }
  return `${WIDGET_LINK_SCHEME}://alarm/${requestId}`;
}

/** Detalle de una tarea vinculada. */
export function taskLink(taskId: string): string {
  if (!isSafeLinkId(taskId)) {
    throw new Error('Identificador de tarea inválido para un enlace.');
  }
  return `${WIDGET_LINK_SCHEME}://task/${taskId}`;
}

/**
 * Interpreta un enlace recibido por la app. Devuelve `null` para esquemas ajenos,
 * rutas no soportadas, identificadores inválidos o parámetros inesperados
 * (`?accept=1`, `?decision=…`): esos enlaces no pueden alterar estado.
 */
export function parseWidgetLink(url: unknown): WidgetLink | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2_048) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== `${WIDGET_LINK_SCHEME}:`) return null;
  // Un enlace con query o fragmento podría intentar arrastrar una decisión.
  if (parsed.search !== '' || parsed.hash !== '' || parsed.username !== '' || parsed.password !== '') {
    return null;
  }
  // En esquemas no especiales, `alarmat://alarm/x` deja `alarm` como hostname.
  // Se aceptan las dos formas (`alarmat://alarm/x` y `alarmat:///alarm/x`), pero
  // un host con más segmentos (`alarmat://evil.com/alarm/x`) no es una ruta válida.
  const pathSegments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  const segments = parsed.hostname === '' ? pathSegments : [parsed.hostname, ...pathSegments];
  if (segments.length === 0) return { kind: 'inbox' };
  if (segments.length === 1 && segments[0] === 'tasks') return { kind: 'tasks' };
  if (segments.length !== 2) return null;

  const [section, id] = segments;
  if (id === undefined || !isSafeLinkId(id)) return null;
  if (section === 'alarm') return { kind: 'alarm', requestId: id };
  if (section === 'task') return { kind: 'task', taskId: id };
  return null;
}

/** Ruta interna equivalente; `null` si el enlace no es válido. */
export function widgetLinkToRoute(url: unknown): string | null {
  const link = parseWidgetLink(url);
  if (link === null) return null;
  switch (link.kind) {
    case 'inbox':
      return '/';
    case 'tasks':
      return '/tasks';
    case 'alarm':
      return `/alarm/${link.requestId}`;
    case 'task':
      return `/task/${link.taskId}`;
    default:
      return null;
  }
}
