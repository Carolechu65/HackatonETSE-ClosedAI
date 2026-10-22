/**
 * Configuración de la API (P1).
 *
 * La URL llega por `EXPO_PUBLIC_API_URL` (Metro la incrusta en el bundle).
 * Nunca contiene credenciales: el token de sesión vive en SecureStore y viaja
 * en la cabecera `Authorization`, no en la URL.
 */

export const API_BASE_URL_ENV = 'EXPO_PUBLIC_API_URL';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2']);

export type ApiUrlOptions = {
  /** Permite `http://localhost` para emulador/dispositivo en desarrollo. */
  allowLocalHttp?: boolean;
};

/** Valida y normaliza la URL base. Lanza si la configuración no es segura. */
export function readApiBaseUrl(raw: string | undefined, options: ApiUrlOptions = {}): string {
  const value = raw?.trim();
  if (!value) {
    throw new Error(`${API_BASE_URL_ENV} no está definida. Copia .env.example y apunta a la API HTTPS.`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${API_BASE_URL_ENV} no es una URL válida: ${value}`);
  }

  const isLocal = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(options.allowLocalHttp === true && isLocal && url.protocol === 'http:')) {
    throw new Error(`${API_BASE_URL_ENV} debe usar HTTPS (solo localhost admite HTTP en desarrollo).`);
  }
  if (url.username || url.password) {
    throw new Error(`${API_BASE_URL_ENV} no puede incluir usuario ni contraseña.`);
  }
  if (url.search || url.hash) {
    throw new Error(`${API_BASE_URL_ENV} no admite query ni fragmento.`);
  }

  return url.toString().replace(/\/$/, '');
}

/** URL base de la API en runtime; sin valor, falla en vez de inventar un host. */
export function apiBaseUrlFromEnv(options: ApiUrlOptions = {}): string {
  return readApiBaseUrl(process.env.EXPO_PUBLIC_API_URL, options);
}
