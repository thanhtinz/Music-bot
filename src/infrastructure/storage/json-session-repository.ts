import type { SessionRepository } from '../../application/session/session-repository';
import type { PlayerSession } from '../../application/session/player-session';

import { JsonStore } from './json-store';

/** Live sessions in a JSON file, on the store the other two use. */
export class JsonSessionRepository implements SessionRepository {
  private readonly store: JsonStore<PlayerSession>;

  constructor(filePath: string) {
    this.store = new JsonStore<PlayerSession>({
      filePath,
      version: 1,
      collectionKey: 'sessions',
      label: 'session store',
      idOf: (session) => session.guildId,
      isValid: isSession,
    });
  }

  async all(): Promise<PlayerSession[]> {
    return this.store.all();
  }

  async save(session: PlayerSession): Promise<void> {
    await this.store.put(session);
  }

  async delete(guildId: string): Promise<void> {
    await this.store.remove(guildId);
  }
}

function isSession(value: unknown): value is PlayerSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PlayerSession>;

  return (
    typeof candidate.guildId === 'string' &&
    typeof candidate.voiceChannelId === 'string' &&
    Array.isArray(candidate.tracks) &&
    typeof candidate.savedAt === 'number'
  );
}
