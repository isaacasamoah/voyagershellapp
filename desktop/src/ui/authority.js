const authority = (() => {
  const ranks = ['admiral', 'commodore', 'captain', 'crew'];
  const rankName = (rank) => rank?.[0].toUpperCase() + rank?.slice(1);
  function supervisors(sessions, kind, rank, target = null) {
    return sessions.filter(
      (s) =>
        s.id !== target &&
        s.removed_ms == null &&
        s.kind === 'codex' &&
        (kind === 'shell'
          ? ranks.slice(0, 3).includes(s.rank)
          : ranks.indexOf(s.rank) === ranks.indexOf(rank) - 1),
    );
  }
  return { ranks, rankName, supervisors };
})();
if (typeof module !== 'undefined') module.exports = authority;
