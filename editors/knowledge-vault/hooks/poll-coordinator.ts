/**
 * One timer per distinct id set, however many components ask for it.
 *
 * Three separate components read the vault's scope-of-work documents —
 * `DriveExplorer` (60 s), `ProjectsView` (30 s) and `ScopeOfWorkView` (30 s)
 * — over the *identical* id set. Each owned its own `setInterval`, and
 * because `fetchThroughCache` dedupes only CONCURRENT reads, three timers on
 * different phases meant the same list was fetched three times per cycle.
 *
 * Registering by the spec-set key fixes that structurally: members of a
 * group are notified in the same tick, so their fetches overlap and collapse
 * into one request. The group runs at the SHORTEST period any member asked
 * for — nobody gets a slower refresh than they requested.
 *
 * Visibility and live-feed backoff live here too, so the rule is stated once
 * rather than repeated per call site.
 */

export type PollCoordinator = {
  /** Join the group for `key`; returns the leave function. */
  register: (key: string, periodMs: number, fn: () => void) => () => void;
  /** Test/diagnostic view: how many timers are currently running. */
  activeGroups: () => number;
};

type Member = { periodMs: number; fn: () => void };

type Group = {
  members: Map<object, Member>;
  timer: ReturnType<typeof setInterval> | null;
  periodMs: number;
  lastPollAt: number;
};

export function createPollCoordinator(deps: {
  now?: () => number;
  isLive?: () => boolean;
  isVisible?: () => boolean;
  /** Cadence a group falls back to while the change feed is delivering. */
  liveSafetyNetMs?: number;
}): PollCoordinator {
  const now = deps.now ?? (() => Date.now());
  const isLive = deps.isLive ?? (() => false);
  const isVisible = deps.isVisible ?? (() => true);
  const liveSafetyNetMs = deps.liveSafetyNetMs ?? 5 * 60_000;

  const groups = new Map<string, Group>();

  function tick(group: Group): void {
    // A background tab has no reader to serve.
    if (!isVisible()) return;
    // The change feed is pushing every write already; this is the safety net
    // for a socket that acked its handshake and then went quiet.
    if (isLive() && now() - group.lastPollAt < liveSafetyNetMs) return;
    group.lastPollAt = now();
    // Copy: a member may leave from inside its own callback.
    for (const member of [...group.members.values()]) member.fn();
  }

  function retune(group: Group): void {
    let shortest = Number.POSITIVE_INFINITY;
    for (const member of group.members.values()) {
      if (member.periodMs < shortest) shortest = member.periodMs;
    }
    if (group.timer && shortest === group.periodMs) return;
    if (group.timer) clearInterval(group.timer);
    group.periodMs = shortest;
    group.timer = setInterval(() => tick(group), shortest);
  }

  return {
    register(key, periodMs, fn) {
      let group = groups.get(key);
      if (!group) {
        group = {
          members: new Map(),
          timer: null,
          periodMs: Number.POSITIVE_INFINITY,
          lastPollAt: now(),
        };
        groups.set(key, group);
      }
      const token = {};
      const joined = group;
      joined.members.set(token, { periodMs, fn });
      retune(joined);

      return () => {
        joined.members.delete(token);
        if (joined.members.size > 0) {
          retune(joined);
          return;
        }
        if (joined.timer) clearInterval(joined.timer);
        joined.timer = null;
        // Only drop the entry if it is still ours: a re-register under the
        // same key between these two lines would otherwise be orphaned.
        if (groups.get(key) === joined) groups.delete(key);
      };
    },

    activeGroups: () => groups.size,
  };
}
