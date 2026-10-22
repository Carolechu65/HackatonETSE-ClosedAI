/** P5: conectar RNFirebase una sola vez desde el entrypoint, antes de Router. */
export function initializeBootstrap() {
  return {
    mode: 'demo',
    firebaseConnected: false,
    backgroundHandlersRegistered: false,
    persistentStorageReady: false,
  } as const;
}
