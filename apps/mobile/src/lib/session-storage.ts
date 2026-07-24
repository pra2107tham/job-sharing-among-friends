import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { SessionStorage } from '@jobdrop/api-client';

/**
 * Session storage backed by the platform keychain.
 *
 * Why not AsyncStorage: the value being stored is a refresh token. On a lost or
 * rooted device AsyncStorage is a plaintext file; SecureStore is the Keychain
 * (iOS) and EncryptedSharedPreferences (Android).
 *
 * The catch is that SecureStore rejects values over 2048 bytes, and a Supabase
 * session carrying a JWT with custom claims can exceed that. So values are
 * chunked: chunk 0 holds the count, chunks 1..n hold the parts. Reads that find
 * no count key fall back to reading the key directly, so sessions written before
 * chunking existed still load.
 */

const CHUNK_SIZE = 1800; // headroom under the 2048-byte limit
const countKey = (key: string) => `${key}__chunks`;
const chunkKey = (key: string, i: number) => `${key}__${i}`;

async function clearChunks(key: string): Promise<void> {
  const countRaw = await SecureStore.getItemAsync(countKey(key));
  if (!countRaw) return;
  const count = Number.parseInt(countRaw, 10);
  for (let i = 0; i < count; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, i));
  }
  await SecureStore.deleteItemAsync(countKey(key));
}

const secureStorage: SessionStorage = {
  async getItem(key) {
    const countRaw = await SecureStore.getItemAsync(countKey(key));
    if (!countRaw) return SecureStore.getItemAsync(key);

    const count = Number.parseInt(countRaw, 10);
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      // A missing chunk means a torn write; treat the whole value as absent so
      // the user re-authenticates instead of hitting a JSON parse error.
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key, value) {
    await clearChunks(key);
    await SecureStore.deleteItemAsync(key);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    const count = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(
        chunkKey(key, i),
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      );
    }
    await SecureStore.setItemAsync(countKey(key), String(count));
  },

  async removeItem(key) {
    await clearChunks(key);
    await SecureStore.deleteItemAsync(key);
  },
};

/**
 * Web has no SecureStore; supabase-js uses localStorage when given no adapter,
 * which is the correct behaviour there.
 */
export const sessionStorage: SessionStorage | undefined =
  Platform.OS === 'web' ? undefined : secureStorage;
