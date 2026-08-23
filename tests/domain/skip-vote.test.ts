import { describe, expect, it } from 'vitest';

import { addVoter, removeVoter, requiredVotes, startVote, tally } from '../../src/domain/vote';

describe('requiredVotes', () => {
  it('asks a simple majority of the room', () => {
    expect(requiredVotes(2)).toBe(1);
    expect(requiredVotes(3)).toBe(2);
    expect(requiredVotes(4)).toBe(2);
    expect(requiredVotes(5)).toBe(3);
  });

  it('never asks for fewer than one', () => {
    expect(requiredVotes(0)).toBe(1);
    expect(requiredVotes(-4)).toBe(1);
  });

  it('ignores a fractional count rather than rounding it up twice', () => {
    expect(requiredVotes(3.9)).toBe(2);
  });
});

describe('addVoter', () => {
  it('counts a person once, however many times they ask', () => {
    let vote = startVote('track', 4);
    vote = addVoter(vote, 'alice');
    vote = addVoter(vote, 'alice');

    expect(vote.voters.size).toBe(1);
  });

  it('does not mutate the vote it was given', () => {
    const before = startVote('track', 4);
    const after = addVoter(before, 'alice');

    expect(before.voters.size).toBe(0);
    expect(after.voters.size).toBe(1);
  });

  it('counts different people separately', () => {
    let vote = startVote('track', 4);
    vote = addVoter(vote, 'alice');
    vote = addVoter(vote, 'bob');

    expect(vote.voters.size).toBe(2);
  });
});

describe('removeVoter', () => {
  it('withdraws a vote', () => {
    const vote = removeVoter(addVoter(startVote('track', 4), 'alice'), 'alice');
    expect(vote.voters.size).toBe(0);
  });

  it('ignores someone who never voted', () => {
    const vote = addVoter(startVote('track', 4), 'alice');
    expect(removeVoter(vote, 'bob')).toBe(vote);
  });
});

describe('tally', () => {
  it('passes once the majority has asked', () => {
    let vote = startVote('track', 3);
    expect(tally(vote, 3)).toMatchObject({ votes: 0, required: 2, passed: false });

    vote = addVoter(vote, 'alice');
    expect(tally(vote, 3).passed).toBe(false);

    vote = addVoter(vote, 'bob');
    expect(tally(vote, 3)).toMatchObject({ votes: 2, required: 2, passed: true });
  });

  it('counts against the room as it is now, not as it was', () => {
    // Three people voted one in; two of them left, so one vote is now enough.
    const vote = addVoter(startVote('track', 3), 'alice');

    expect(tally(vote, 3).passed).toBe(false);
    expect(tally(vote, 1).passed).toBe(true);
  });

  it('lets one person decide in an empty room', () => {
    expect(tally(addVoter(startVote('track', 1), 'alice'), 1).passed).toBe(true);
  });
});
