import type { PlayerSession } from './player-session';

/**
 * Storage seam for live playback sessions.
 *
 * The same port shape as playlists and settings; the spec puts this in Redis
 * eventually (§21), and that is an implementation of this interface rather
 * than a change to the player.
 */
export interface SessionRepository {
  all(): Promise<PlayerSession[]>;
  save(session: PlayerSession): Promise<void>;
  delete(guildId: string): Promise<void>;
}

/** Non-persistent store, for tests and for running without a state file. */
export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, PlayerSession>();

  async all(): Promise<PlayerSession[]> {
    return [...this.sessions.values()];
  }

  async save(session: PlayerSession): Promise<void> {
    this.sessions.set(session.guildId, session);
  }

  async delete(guildId: string): Promise<void> {
    this.sessions.delete(guildId);
  }
}
