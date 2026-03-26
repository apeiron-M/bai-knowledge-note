import type { LifecycleEvent } from "../../../document-models/knowledge-note/v1/gen/schema/types.js";

type LifecycleTimelineProps = { events: LifecycleEvent[] };

const STATUS_DOT: Record<string, string> = {
  DRAFT: "bg-amber-400", IN_REVIEW: "bg-blue-400", CANONICAL: "bg-emerald-400", ARCHIVED: "bg-gray-500",
};

export function LifecycleTimeline({ events }: LifecycleTimelineProps) {
  if (events.length === 0) {
    return <p className="py-2 text-center text-xs text-gray-600">No lifecycle events yet</p>;
  }

  return (
    <div className="space-y-0">
      {events.map((event, i) => {
        const isLast = i === events.length - 1;
        const date = event.timestamp ? new Date(event.timestamp).toLocaleString() : "";
        return (
          <div key={event.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={`mt-1 h-2.5 w-2.5 rounded-full ${STATUS_DOT[event.toStatus ?? "DRAFT"]}`} />
              {!isLast && <div className="w-px flex-1 bg-white/10" />}
            </div>
            <div className="pb-3">
              <p className="text-xs font-medium text-gray-300">{event.fromStatus} &rarr; {event.toStatus}</p>
              <p className="text-xs text-gray-500">{event.actor} &middot; {date}</p>
              {event.comment && <p className="mt-0.5 text-xs italic text-gray-600">&ldquo;{event.comment}&rdquo;</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
