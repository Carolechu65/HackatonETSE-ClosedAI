export type CalendarConfig = { clientId: string; clientSecret: string; encryptionKey: string; redirectUri: string; publicApiUrl: string; appUrl: string };
export function calendarConfig(env: NodeJS.ProcessEnv = process.env): CalendarConfig | null {
  const values = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.CALENDAR_ENCRYPTION_KEY, env.GOOGLE_REDIRECT_URI, env.CALENDAR_PUBLIC_API_URL, env.CALENDAR_APP_URL];
  if (values.every(value => !value)) return null;
  if (values.some(value => !value?.trim())) throw new Error('Falta configuración privada de Google Calendar.');
  const [clientId, clientSecret, encryptionKey, redirectUri, publicApiUrl, appUrl] = values as string[];
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey!)) throw new Error('CALENDAR_ENCRYPTION_KEY debe contener 32 bytes en hexadecimal.');
  for (const value of [redirectUri!, publicApiUrl!, appUrl!]) { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Las URLs de calendario deben usar HTTPS sin credenciales ni parámetros.'); }
  if (new URL(redirectUri!).origin !== new URL(publicApiUrl!).origin) throw new Error('El callback y la API de calendario deben compartir origen.');
  return { clientId: clientId!, clientSecret: clientSecret!, encryptionKey: encryptionKey!, redirectUri: redirectUri!, publicApiUrl: publicApiUrl!.replace(/\/$/, ''), appUrl: appUrl! };
}
