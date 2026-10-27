/** Minimal key-value store (implemented over Redis or a file in src/node/store.ts). */
export interface KeyValueStore {
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

export interface Env {
  DATA: KeyValueStore;
  /** Called after a sync document changed; `room` is `roomFor(token)`. */
  notify?: (room: string) => void;
  ALLOWED_ORIGINS?: string;
  ALLOWED_UPSTREAMS?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_JWK?: string;
  VAPID_SUBJECT?: string;
}

export const list = (value: string | undefined): string[] =>
  (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);

export const toBase64Url = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = '';
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

export const sha256 = async (text: string): Promise<string> =>
  toBase64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
