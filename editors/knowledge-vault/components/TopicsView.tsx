import { useMemo } from "react";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";
import { prefetchOnHover } from "../lib/prefetch.js";
import { hubMap, rankedTopics, topicSize } from "../lib/vault-lookups.js";
import { LIBRARY_CSS } from "./library-css.js";
import { LoadingLine } from "./LoadingStates.js";
import { VaultIcon } from "./vault-icons.js";

/**
 * The Topics place (design: docs/design/vault-view, "Topics"): every topic
 * the vault has gathered its notes into, largest first, under the overview
 * every topic hangs from. A topic opens in today's topic-map editor.
 */
export function TopicsView({
  mocs,
  isLoading = false,
  onOpen,
  onNewTopic,
}: {
  mocs: MocInfo[];
  /** The first read of the vault is still in flight. */
  isLoading?: boolean;
  onOpen: (id: string) => void;
  onNewTopic?: () => void;
}) {
  const hub = useMemo(() => hubMap(mocs), [mocs]);
  const topics = useMemo(() => rankedTopics(mocs), [mocs]);
  const loading = isLoading && mocs.length === 0;

  return (
    <div className="vault-libwrap">
      <style aria-hidden="true">{LIBRARY_CSS}</style>
      <section className="vault-lib" aria-label="Topics">
        <div className="lib-head">
          <h1>Topics</h1>
          {!loading && <span className="count">{topics.length}</span>}
          {onNewTopic && (
            <div className="lib-tools">
              <button type="button" className="btn btn-quiet" onClick={onNewTopic}>
                <VaultIcon name="plus" />
                New topic
              </button>
            </div>
          )}
        </div>
        <p className="lib-sub">
          Each topic gathers the notes on one theme. New notes are placed in topics as they're written.
        </p>

        {loading ? (
          <div className="lib-loading">
            <LoadingLine label="Loading topics…" />
          </div>
        ) : (
          <>
            {hub && (
              <button
                type="button"
                className="overview"
                onClick={() => onOpen(hub.id)}
                {...prefetchOnHover(hub.id)}
              >
                <OverviewGlyph seeds={topics.map((t) => t.id)} />
                <span>
                  <span className="ov-title">{hub.title} overview</span>
                  <span className="ov-sub">The vault's entry point. Every topic hangs from here.</span>
                </span>
                <span className="btn btn-quiet">Open</span>
              </button>
            )}
            {topics.length === 0 ? (
              <div className="calm">
                No topics yet. As notes are written, the vault gathers them into topics.
              </div>
            ) : (
              <ul className="topic-list">
                {topics.map((topic) => (
                  <li key={topic.id}>
                    <button
                      type="button"
                      className="topic"
                      onClick={() => onOpen(topic.id)}
                      {...prefetchOnHover(topic.id)}
                    >
                      <span className="tt">
                        <span>{topic.title}</span>
                        <span className="n">{topicSize(topic)}</span>
                      </span>
                      {topic.description && <span className="td">{topic.description}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** At most this many topics around the hub: past it the figure is a blur. */
const GLYPH_TOPICS = 24;

/**
 * The overview's figure: the hub and its topics around it, each placed from
 * its id so a vault always draws the same shape (as the glyph beside the
 * vault's name does).
 */
export function overviewPoints(seeds: readonly string[]): { x: number; y: number }[] {
  const picked = seeds.slice(0, GLYPH_TOPICS);
  return picked.map((id, i) => {
    const h = hash(id);
    const angle = (i / picked.length) * Math.PI * 2 - Math.PI / 2 + (((h % 31) - 15) * Math.PI) / 360;
    // Two rings so a crowded overview still reads as separate dots.
    const ring = i % 2 === 0 ? 1 : 0.72;
    const rx = (36 + (h % 7)) * ring;
    const ry = (24 + (h % 5)) * ring;
    return {
      x: Math.round((50 + Math.cos(angle) * rx) * 10) / 10,
      y: Math.round((35 + Math.sin(angle) * ry) * 10) / 10,
    };
  });
}

function OverviewGlyph({ seeds }: { seeds: readonly string[] }) {
  const points = overviewPoints(seeds);
  return (
    <svg viewBox="0 0 100 70" aria-hidden="true">
      {points.map((p, i) => (
        <line key={`l${i}`} x1={50} y1={35} x2={p.x} y2={p.y} />
      ))}
      {points.map((p, i) => (
        <circle key={`c${i}`} cx={p.x} cy={p.y} r={2.8} />
      ))}
      <circle className="hub" cx={50} cy={35} r={4.2} />
    </svg>
  );
}
