import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { createLogger } from '../../telemetry/logger';

const logger = createLogger('json-store');

/**
 * The file's shape.
 *
 * The array's key is configurable so each store keeps a name that means
 * something on disk — `playlists`, not `records` — and so an existing file is
 * still read after this was factored out of the playlist store.
 */
type StoreFile<T> = { version: number } & Record<string, T[] | number>;

export interface JsonStoreOptions<T> {
  filePath: string;
  /** Bumped when the on-disk shape changes, so an old file is recognisable. */
  version: number;
  /** Key a record is stored under. */
  idOf: (record: T) => string;
  /**
   * Guard against a hand-edited or half-migrated file poisoning the cache.
   * Records that fail are dropped, not repaired.
   */
  isValid: (value: unknown) => value is T;
  /** Name used in logs. */
  label: string;
  /** Key the array is stored under, e.g. `playlists`. */
  collectionKey: string;
}

/**
 * A keyed collection of records in one JSON file.
 *
 * Playlists and guild settings both need the same three things — read once,
 * write the whole file, never leave a half-written file behind — so they share
 * one implementation rather than each getting its own nearly-identical copy.
 *
 * Writes go through a single chain and land via a rename, which is atomic
 * within a filesystem. That is the property that matters: a crash mid-write
 * leaves the previous file intact rather than a truncated one.
 */
export class JsonStore<T> {
  private readonly path: string;
  private readonly records = new Map<string, T>();
  private loaded = false;
  /** Serialises writes; a rename is atomic but two of them still race. */
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly options: JsonStoreOptions<T>) {
    this.path = resolve(options.filePath);
  }

  async all(): Promise<T[]> {
    await this.load();
    return [...this.records.values()];
  }

  async get(id: string): Promise<T | undefined> {
    await this.load();
    return this.records.get(id);
  }

  /** First record matching `predicate`, in insertion order. */
  async find(predicate: (record: T) => boolean): Promise<T | undefined> {
    await this.load();
    return [...this.records.values()].find(predicate);
  }

  async put(record: T): Promise<void> {
    await this.load();
    this.records.set(this.options.idOf(record), record);
    await this.flush();
  }

  async remove(id: string): Promise<void> {
    await this.load();
    if (!this.records.delete(id)) return;
    await this.flush();
  }

  /**
   * Reads the file once.
   *
   * A missing file is the normal first run. A corrupt one is reported and
   * treated as empty rather than thrown: losing saved data is bad, but a bot
   * that will not start is worse, and the bad file is left on disk to be
   * recovered by hand.
   */
  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ err: error, path: this.path }, `could not read the ${this.options.label}`);
      }
      return;
    }

    try {
      const parsed = JSON.parse(raw) as StoreFile<T>;
      const stored = parsed[this.options.collectionKey];
      const records = Array.isArray(stored) ? stored : [];

      for (const record of records) {
        if (this.options.isValid(record)) this.records.set(this.options.idOf(record), record);
      }

      logger.info(
        { count: this.records.size, path: this.path },
        `loaded the ${this.options.label}`,
      );
    } catch (error) {
      logger.error(
        { err: error, path: this.path },
        `the ${this.options.label} is unreadable; starting empty and leaving the file alone`,
      );
    }
  }

  private async flush(): Promise<void> {
    const snapshot: StoreFile<T> = {
      version: this.options.version,
      [this.options.collectionKey]: [...this.records.values()],
    };

    this.writes = this.writes.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });

      // Written beside the target so the rename stays on one filesystem, which
      // is what makes it atomic.
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(snapshot, null, 2), 'utf8');
      await rename(temporary, this.path);
    });

    await this.writes;
  }
}
