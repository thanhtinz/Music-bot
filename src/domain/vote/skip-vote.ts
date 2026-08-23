/**
 * A skip vote for one track.
 *
 * Held per guild and thrown away when the track changes: a vote is about the
 * song playing now, and carrying it forward would let people skip a track they
 * never heard.
 */
export interface SkipVote {
  /** The track being voted on; a different id means a different vote. */
  readonly trackId: string;
  readonly voters: ReadonlySet<string>;
  /** Listeners at the moment the vote started, for the tally shown. */
  readonly listeners: number;
}

export interface VoteTally {
  votes: number;
  required: number;
  /** True once enough people have asked. */
  passed: boolean;
}

/**
 * How many votes it takes.
 *
 * A simple majority of the people listening, excluding the bot. One other
 * person means both of you have to agree; an empty room means the one person
 * there decides.
 */
export function requiredVotes(listeners: number): number {
  const people = Math.max(1, Math.trunc(listeners));
  return Math.max(1, Math.ceil(people / 2));
}

export function startVote(trackId: string, listeners: number): SkipVote {
  return { trackId, voters: new Set(), listeners: Math.max(1, Math.trunc(listeners)) };
}

/**
 * Adds a voter.
 *
 * Voting twice does not count twice — the second press is somebody impatient,
 * not somebody else.
 */
export function addVoter(vote: SkipVote, userId: string): SkipVote {
  if (vote.voters.has(userId)) return vote;
  return { ...vote, voters: new Set([...vote.voters, userId]) };
}

/** Withdraws a vote, e.g. when the voter leaves the channel. */
export function removeVoter(vote: SkipVote, userId: string): SkipVote {
  if (!vote.voters.has(userId)) return vote;

  const voters = new Set(vote.voters);
  voters.delete(userId);
  return { ...vote, voters };
}

/**
 * Counts the vote against the room as it is now.
 *
 * The listener count is re-read rather than taken from the vote, because people
 * leave: three listeners becoming one should not leave a vote needing two.
 */
export function tally(vote: SkipVote, listeners: number): VoteTally {
  const required = requiredVotes(listeners);
  const votes = vote.voters.size;

  return { votes, required, passed: votes >= required };
}
