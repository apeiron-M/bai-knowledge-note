import { useState } from "react";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { generateId } from "document-model";
import { actions } from "document-models/project";
import type {
  MemberKind,
  ProjectAction,
  ProjectGlobalState,
  TeamMember,
} from "document-models/project";

type Dispatch = DocumentDispatch<ProjectAction>;

const KIND_ICON: Record<MemberKind, string> = { HUMAN: "🧑", AGENT: "🤖" };
const ALL_KINDS: MemberKind[] = ["HUMAN", "AGENT"];

type TeamSectionProps = {
  state: ProjectGlobalState;
  dispatch: Dispatch;
};

export function TeamSection({ state, dispatch }: TeamSectionProps) {
  const team = state.team;

  return (
    <div
      className="rounded-xl p-5"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <h3
        className="mb-3 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--bai-text-muted)" }}
      >
        Team ({team.length})
      </h3>

      {team.length === 0 ? (
        <p
          className="py-4 text-center text-sm"
          style={{ color: "var(--bai-text-faint)" }}
        >
          No team members yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {team.map((m) => (
            <MemberRow key={m.id} member={m} dispatch={dispatch} />
          ))}
        </div>
      )}

      <AddMemberRow dispatch={dispatch} />
    </div>
  );
}

function MemberRow({
  member,
  dispatch,
}: {
  member: TeamMember;
  dispatch: Dispatch;
}) {
  const kind = member.kind ?? "HUMAN";

  return (
    <div
      className="group flex items-center gap-2 rounded-lg px-3 py-2"
      style={{
        backgroundColor: "var(--bai-bg)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <span className="shrink-0 text-sm" title={kind}>
        {KIND_ICON[kind]}
      </span>

      <input
        type="text"
        defaultValue={member.name}
        onBlur={(e) => {
          const value = e.target.value.trim();
          if (!value) {
            e.currentTarget.value = member.name;
            return;
          }
          if (value !== member.name) {
            dispatch(actions.updateMember({ id: member.id, name: value }));
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        style={{ color: "var(--bai-text-secondary)" }}
      />

      <input
        type="text"
        defaultValue={member.role ?? ""}
        placeholder="Role"
        onBlur={(e) => {
          // updateMember's reducer only assigns role when truthy (it can
          // never be cleared once set), so an empty blur is a guaranteed
          // no-op at the reducer — skip the round trip entirely.
          const value = e.target.value.trim();
          if (!value || value === (member.role ?? "")) return;
          dispatch(actions.updateMember({ id: member.id, role: value }));
        }}
        className="w-32 shrink-0 rounded-md bg-transparent px-2 py-1 text-xs outline-none"
        style={{ color: "var(--bai-text-tertiary)" }}
      />

      <button
        type="button"
        onClick={() => dispatch(actions.removeMember({ id: member.id }))}
        className="shrink-0 rounded p-1 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
        style={{ color: "var(--bai-text-faint)" }}
        title="Remove member"
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function AddMemberRow({ dispatch }: { dispatch: Dispatch }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [kind, setKind] = useState<MemberKind>("HUMAN");

  function reset() {
    setName("");
    setRole("");
    setKind("HUMAN");
  }

  function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;
    dispatch(
      actions.addMember({
        id: generateId(),
        name: trimmed,
        role: role.trim() || undefined,
        kind,
      }),
    );
    reset();
    setAdding(false);
  }

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-2 flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-colors hover:bg-white/5"
        style={{
          color: "var(--bai-text-faint)",
          border: "1px dashed var(--bai-border)",
        }}
      >
        <svg
          className="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add team member
      </button>
    );
  }

  return (
    <div
      className="mt-2 flex items-center gap-2 rounded-lg p-3"
      style={{
        backgroundColor: "var(--bai-bg)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as MemberKind)}
        className="shrink-0 rounded-md px-2 py-1 text-xs"
        style={{
          backgroundColor: "var(--bai-surface)",
          color: "var(--bai-text-secondary)",
          border: "1px solid var(--bai-border)",
        }}
      >
        {ALL_KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_ICON[k]} {k}
          </option>
        ))}
      </select>
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleAdd();
          if (e.key === "Escape") {
            reset();
            setAdding(false);
          }
        }}
        placeholder="Name..."
        className="min-w-0 flex-1 rounded-md px-2 py-1 text-xs outline-none"
        style={{
          backgroundColor: "var(--bai-surface)",
          color: "var(--bai-text-secondary)",
          border: "1px solid var(--bai-border)",
        }}
      />
      <input
        type="text"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleAdd();
        }}
        placeholder="Role (optional)"
        className="w-32 shrink-0 rounded-md px-2 py-1 text-xs outline-none"
        style={{
          backgroundColor: "var(--bai-surface)",
          color: "var(--bai-text-secondary)",
          border: "1px solid var(--bai-border)",
        }}
      />
      <button
        type="button"
        onClick={handleAdd}
        disabled={!name.trim()}
        className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40"
        style={{
          backgroundColor: "var(--bai-accent)",
          color: "var(--bai-accent-text)",
        }}
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => {
          reset();
          setAdding(false);
        }}
        className="shrink-0 rounded-md px-2 py-1 text-xs"
        style={{ color: "var(--bai-text-faint)" }}
      >
        Cancel
      </button>
    </div>
  );
}
