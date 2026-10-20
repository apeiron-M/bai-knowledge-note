import { actions } from "document-models/scope-of-work";
import { useState } from "react";
import { Avatar, InlineText } from "../components/ui.js";
import { useEditor } from "../lib/context.js";
import { LOCKED_HINT, allMilestones, isEditable } from "../lib/model.js";

export function TeamView() {
  const { state, dispatch, confirm } = useEditor();
  const [name, setName] = useState("");
  const [phid, setPhid] = useState("");
  const editable = isEditable(state);

  const add = () => {
    const n = name.trim();
    if (!n) return;
    const id = phid.trim() || `phd:${n.toLowerCase().replace(/\s+/g, "-")}`;
    dispatch(actions.addAgent({ id, name: n }));
    setName("");
    setPhid("");
  };
  const remove = async (id: string, n: string) => {
    const ok = await confirm({
      title: "Remove contributor",
      body: `Remove ${n}? They will be cleared as owner and coordinator everywhere.`,
    });
    if (!ok) return;
    dispatch(actions.removeAgent({ id }));
  };

  return (
    <div className="doc">
      <div className="eyebrow">Team</div>
      <h1 className="title">Contributors</h1>
      <p className="desc">
        People are referenced by PHID. Removing someone clears them as owner and
        coordinator everywhere.
      </p>
      <div className="team">
        {state.contributors.map((a) => {
          const owns = state.deliverables.filter(
            (d) => d.owner === a.id,
          ).length;
          const leads = state.projects.filter(
            (p) => p.projectOwner === a.id,
          ).length;
          const coord = allMilestones(state).filter((x) =>
            x.milestone.coordinators.includes(a.id),
          ).length;
          return (
            <div key={a.id} className="member">
              <Avatar agent={a} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="n">
                  <InlineText
                    ariaLabel="Name"
                    value={a.name}
                    onCommit={(nm) =>
                      dispatch(actions.editAgent({ id: a.id, name: nm }))
                    }
                  />
                </div>
                <div className="r mono">{a.id}</div>
              </div>
              <div className="s">
                {leads > 0 && (
                  <>
                    {leads} project{leads > 1 ? "s" : ""}
                    <br />
                  </>
                )}
                {owns} deliverable{owns === 1 ? "" : "s"}
                {coord > 0 && (
                  <>
                    <br />
                    coordinates {coord}
                  </>
                )}
                <br />
                {editable ? (
                  <button
                    className="faint"
                    style={{ fontSize: 12 }}
                    onClick={() => {
                      void remove(a.id, a.name);
                    }}
                  >
                    remove
                  </button>
                ) : (
                  <span
                    className="faint"
                    style={{ fontSize: 12 }}
                    title={LOCKED_HINT}
                  >
                    locked
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div
          className="member"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr auto",
            gap: 8,
            alignItems: "end",
          }}
        >
          <div>
            <span className="lbl">Name</span>
            <input
              className="in"
              value={name}
              placeholder="Full name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
            />
          </div>
          <div>
            <span className="lbl">PHID</span>
            <input
              className="in mono"
              value={phid}
              placeholder="phd:… (optional)"
              onChange={(e) => setPhid(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
            />
          </div>
          <button className="btn" onClick={add} disabled={!name.trim()}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
