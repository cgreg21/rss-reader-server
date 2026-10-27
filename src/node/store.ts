import { readFile, writeFile } from 'node:fs/promises';

import { KeyValueStore } from '../env';

type ListResult = Awaited<ReturnType<KeyValueStore['list']>>;

/** Persistent store on Upstash Redis (REST): survives Render's ephemeral disk. */
export class RedisStore implements KeyValueStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async command<T>(...args: (string | number)[]): Promise<T> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(args),
    });
    const body = (await response.json()) as { result?: T; error?: string };
    if (!response.ok || body.error) throw new Error(body.error ?? `Redis ${response.status}`);
    return body.result as T;
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.command<string | null>('GET', key);
    return value === null ? null : (JSON.parse(value) as T);
  }

  async put(key: string, value: string): Promise<void> {
    await this.command('SET', key, value);
  }

  async delete(key: string): Promise<void> {
    await this.command('DEL', key);
  }

  async list({ prefix, cursor }: { prefix: string; cursor?: string }): Promise<ListResult> {
    const [next, keys] = await this.command<[string, string[]]>('SCAN', cursor ?? '0', 'MATCH', `${prefix}*`, 'COUNT', 200);
    return { keys: keys.map((name) => ({ name })), list_complete: next === '0', cursor: next === '0' ? undefined : next };
  }
}

/** Local JSON file: fine for development; on Render's free tier the disk is wiped on every restart. */
export class FileStore implements KeyValueStore {
  private data = new Map<string, string>();
  private ready: Promise<void>;
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {
    this.ready = readFile(path, 'utf8')
      .then((text) => {
        this.data = new Map(Object.entries(JSON.parse(text) as Record<string, string>));
      })
      .catch(() => undefined);
  }

  private save(): void {
    this.saving = this.saving.then(() => writeFile(this.path, JSON.stringify(Object.fromEntries(this.data))).catch(() => undefined));
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ready;
    const value = this.data.get(key);
    return value === undefined ? null : (JSON.parse(value) as T);
  }

  async put(key: string, value: string): Promise<void> {
    await this.ready;
    this.data.set(key, value);
    this.save();
  }

  async delete(key: string): Promise<void> {
    await this.ready;
    this.data.delete(key);
    this.save();
  }

  async list({ prefix }: { prefix: string }): Promise<ListResult> {
    await this.ready;
    return { keys: [...this.data.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
  }
}
