import * as SecureStore from 'expo-secure-store';
import type { SecureStorage } from './session.ts';

/** Keep the native import separate so transport/session tests run without a native runtime. */
export const expoSecureStorage: SecureStorage = {
  getItemAsync: key => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItemAsync: key => SecureStore.deleteItemAsync(key),
};
