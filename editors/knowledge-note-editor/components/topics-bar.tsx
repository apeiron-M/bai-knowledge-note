import { useState } from "react";
import { generateId } from "document-model/core";
import type { Topic } from "../../../document-models/knowledge-note/v1/gen/schema/types.js";

type TopicsBarProps = {
  topics: Topic[];
  onAddTopic: (id: string, name: string) => void;
  onRemoveTopic: (id: string) => void;
};

export function TopicsBar({
  topics,
  onAddTopic,
  onRemoveTopic,
}: TopicsBarProps) {
  const [input, setInput] = useState("");

  function handleAdd() {
    const name = input.trim();
    if (!name) return;
    onAddTopic(generateId(), name);
    setInput("");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {topics.map((topic) => (
        <span
          key={topic.id}
          className="group inline-flex items-center gap-1 rounded-full bg-[#cba6f7]/10 px-3 py-1 text-xs font-medium text-[#cba6f7]"
        >
          {topic.name}
          <button
            type="button"
            onClick={() => onRemoveTopic(topic.id)}
            className="ml-0.5 text-[#cba6f7]/40 opacity-0 transition-opacity hover:text-[#cba6f7] group-hover:opacity-100"
            aria-label={`Remove topic ${topic.name}`}
          >
            &times;
          </button>
        </span>
      ))}
      <form
        className="inline-flex"
        onSubmit={(e) => {
          e.preventDefault();
          handleAdd();
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add topic..."
          className="w-24 rounded-full border border-dashed border-white/10 bg-transparent px-3 py-1 text-xs text-gray-400 outline-none placeholder:text-gray-600 focus:border-[#cba6f7]/40"
        />
      </form>
    </div>
  );
}
