import {
  AccountError,
  AccountService,
  AccountUser,
  SaveLayerInput,
  SavedLayerMeta,
  SavedLayerRecord,
} from './types';

/**
 * Device-local account provider. Users and their layers live in IndexedDB on
 * this browser only. Passwords are stored as PBKDF2 hashes (WebCrypto). Used
 * automatically when no API server is reachable (e.g. static hosting).
 */

const DB_NAME = 'fieldar-account';
const DB_VERSION = 1;
const SESSION_KEY = 'fieldar.session';

interface StoredUser {
  id: string;
  email: string;
  salt: string;
  hash: string;
}

interface StoredLayer extends SavedLayerRecord {
  userId: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'email' });
      }
      if (!db.objectStoreNames.contains('layers')) {
        const store = db.createObjectStore('layers', { keyPath: 'id' });
        store.createIndex('userId', 'userId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  storeName: 'users' | 'layers',
  writeMode: boolean,
  fn: (store: IDBObjectStore) => Promise<T>
): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(storeName, writeMode ? 'readwrite' : 'readonly');
    return await fn(tx.objectStore(storeName));
  } finally {
    db.close();
  }
}

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 150_000, hash: 'SHA-256' },
    key,
    256
  );
  return bufferToHex(new Uint8Array(bits));
}

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return bufferToHex(array);
}

function readSession(): AccountUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AccountUser) : null;
  } catch {
    return null;
  }
}

export class LocalAccountService implements AccountService {
  readonly mode = 'local' as const;
  private user: AccountUser | null = readSession();

  async currentUser(): Promise<AccountUser | null> {
    return this.user;
  }

  async register(email: string, password: string): Promise<AccountUser> {
    const normalized = email.trim().toLowerCase();
    if (!normalized || password.length < 6) throw new AccountError('WEAK_CREDENTIALS');
    const existing = await withStore('users', false, (store) =>
      requestToPromise(store.get(normalized) as IDBRequest<StoredUser | undefined>)
    );
    if (existing) throw new AccountError('EMAIL_TAKEN');

    const salt = randomHex(16);
    const stored: StoredUser = {
      id: `user-${randomHex(8)}`,
      email: normalized,
      salt,
      hash: await hashPassword(password, salt),
    };
    await withStore('users', true, (store) => requestToPromise(store.put(stored)));
    return this.setSession({ id: stored.id, email: stored.email });
  }

  async login(email: string, password: string): Promise<AccountUser> {
    const normalized = email.trim().toLowerCase();
    const stored = await withStore('users', false, (store) =>
      requestToPromise(store.get(normalized) as IDBRequest<StoredUser | undefined>)
    );
    if (!stored) throw new AccountError('INVALID_CREDENTIALS');
    const hash = await hashPassword(password, stored.salt);
    if (hash !== stored.hash) throw new AccountError('INVALID_CREDENTIALS');
    return this.setSession({ id: stored.id, email: stored.email });
  }

  async logout(): Promise<void> {
    this.user = null;
    localStorage.removeItem(SESSION_KEY);
  }

  async listLayers(): Promise<SavedLayerMeta[]> {
    const user = this.requireUser();
    const layers = await withStore('layers', false, (store) =>
      requestToPromise(store.index('userId').getAll(user.id) as IDBRequest<StoredLayer[]>)
    );
    return layers
      .map(({ id, name, sourceFormat, createdAt, featureCount }) => ({
        id,
        name,
        sourceFormat,
        createdAt,
        featureCount,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveLayer(input: SaveLayerInput): Promise<SavedLayerMeta> {
    const user = this.requireUser();
    const record: StoredLayer = {
      id: `saved-${randomHex(8)}`,
      userId: user.id,
      name: input.name,
      sourceFormat: input.sourceFormat,
      createdAt: new Date().toISOString(),
      featureCount: input.geojson.features.length,
      style: input.style,
      geojson: input.geojson,
    };
    await withStore('layers', true, (store) => requestToPromise(store.put(record)));
    const { id, name, sourceFormat, createdAt, featureCount } = record;
    return { id, name, sourceFormat, createdAt, featureCount };
  }

  async loadLayer(id: string): Promise<SavedLayerRecord> {
    const user = this.requireUser();
    const record = await withStore('layers', false, (store) =>
      requestToPromise(store.get(id) as IDBRequest<StoredLayer | undefined>)
    );
    if (!record || record.userId !== user.id) throw new AccountError('NOT_FOUND');
    return record;
  }

  async deleteLayer(id: string): Promise<void> {
    const user = this.requireUser();
    const record = await withStore('layers', false, (store) =>
      requestToPromise(store.get(id) as IDBRequest<StoredLayer | undefined>)
    );
    if (!record || record.userId !== user.id) return;
    await withStore('layers', true, (store) => requestToPromise(store.delete(id)));
  }

  private requireUser(): AccountUser {
    if (!this.user) throw new AccountError('NOT_LOGGED_IN');
    return this.user;
  }

  private setSession(user: AccountUser): AccountUser {
    this.user = user;
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    return user;
  }
}
