/**
 * Spike-local op descriptions keyed by catalog key (`<model>:<OP>`), merged
 * into the catalog by `buildVaultCatalog`. They feed BM25 retrieval and the
 * step-1 prompt. Written from each op's name, input schema and reducer only.
 * The durable fix is `SET_OPERATION_DESCRIPTION` via reactor-mcp; `<m>.json`,
 * `schema.graphql` and `gen/` are derived and must not be hand-edited.
 */
export const OP_DESCRIPTIONS: Record<string, string> = {
  /* derivation -------------------------------------------------------- */
  "derivation:INITIALIZE_DERIVATION":
    "Starts a derivation record by setting the engine version and the time the vault configuration was derived. Use once, when a new derivation is first created.",
  "derivation:ADD_SIGNAL":
    "Records something the user said that influenced the derivation, with the dimensions it affected and how it was interpreted. Use to log the evidence behind a configuration choice.",
  "derivation:ADD_RESEED_ENTRY":
    "Appends an entry to the re-derivation history with the reason and the list of changes made. Use when the configuration is derived again from scratch.",
  "derivation:UPDATE_DIMENSION_RATIONALE":
    "Sets the position, confidence and rationale for one configuration dimension, with supporting claims and failure modes, replacing any earlier rationale for that dimension. Use to explain why a dimension sits where it does.",

  /* health-report ----------------------------------------------------- */
  "health-report:GENERATE_REPORT":
    "Starts a fresh vault health report with an overall status, graph metrics (note count, orphans, dangling links, density) and recommendations, clearing any earlier checks. Use when running a new health audit of the knowledge graph.",
  "health-report:ADD_CHECK":
    "Appends one health check result (category, pass/warn/fail status, message, affected items) to the current report. Use to record the outcome of a single check after the report is generated.",

  /* knowledge-note ---------------------------------------------------- */
  "knowledge-note:SET_TITLE":
    "Renames the note by replacing its title. Use when the user wants the note called something else.",
  "knowledge-note:SET_DESCRIPTION":
    "Replaces the note's short description, a single sentence of at most 200 characters stating what the note says. Use to write or change the one-line synopsis, not the body.",
  "knowledge-note:SET_NOTE_TYPE":
    "Sets the note type, a free-text label for what kind of note this is. Use to change the note's type.",
  "knowledge-note:SET_CONTENT":
    "Replaces the whole markdown body of the note with new text. Use to rewrite the full content at once.",
  "knowledge-note:PATCH_CONTENT":
    "Edits part of the markdown body by removing some characters at an offset and inserting new text there. Use for a small in-place change without replacing the whole body.",
  "knowledge-note:SET_METADATA_FIELD":
    "Sets one named single-value metadata field on the note, such as scope, confidence, severity, version, context, rootCause or decisionStatus. Use for structured attributes that are not the title, description, type or body.",
  "knowledge-note:SET_METADATA_LIST_FIELD":
    "Replaces one named list metadata field on the note, such as models, modules, inputs, outputs, alternatives or consequences. Use to set a whole list of values for a structured attribute.",
  "knowledge-note:SET_PROVENANCE":
    "Records where the note came from: its author, how it originated (manual, session mining, import, derived), an optional session id and the creation time. Use to set authorship and origin.",
  "knowledge-note:ADD_LINK":
    "Creates a typed link from this note to another note (relates to, builds on, contradicts, supersedes, derived from). Use to connect two notes.",
  "knowledge-note:REMOVE_LINK":
    "Deletes one existing link from this note to another note. Use to disconnect the notes.",
  "knowledge-note:UPDATE_LINK_TYPE":
    "Changes the relationship type of an existing link between notes, for example from relates to into contradicts. Use when a connection already exists but its kind is wrong.",
  "knowledge-note:ADD_TOPIC":
    "Tags the note with a topic name. Use to categorize the note by subject; a topic name can only appear once per note.",
  "knowledge-note:REMOVE_TOPIC":
    "Removes one topic tag from the note. Use when the note no longer belongs to that subject.",
  "knowledge-note:SUBMIT_FOR_REVIEW":
    "Moves a draft note into review, with an optional comment, so a reviewer can approve or reject it. Use to start the review of a draft.",
  "knowledge-note:APPROVE_NOTE":
    "Accepts a note that is in review and makes it canonical, with an optional comment. Use when a reviewer other than the author signs off on the note.",
  "knowledge-note:REJECT_NOTE":
    "Sends a note that is in review back to draft with required feedback. Use when a reviewer turns the note down and asks for changes.",
  "knowledge-note:ARCHIVE_NOTE":
    "Retires a canonical note into the archive, with a required reason. Use when an accepted note is obsolete and should no longer be current.",
  "knowledge-note:RESTORE_NOTE":
    "Brings an archived note back as a draft, with an optional comment. Use to revive a note that was archived.",
  "knowledge-note:SET_LAST_VIEWED":
    "Stores, privately for this user, the time the note was last viewed. Set automatically by the editor, not a content change.",

  /* moc --------------------------------------------------------------- */
  "moc:CREATE_MOC":
    "Initializes a map of content with its title, summary, synthesis paragraph, tier (hub, domain or topic) and optional parent map. Use once when creating a new map.",
  "moc:UPDATE_ORIENTATION":
    "Replaces the map's orientation, the synthesis paragraph that explains how its ideas fit together. Use to rewrite that overview prose.",
  "moc:UPDATE_DESCRIPTION":
    "Replaces the map's short summary used for progressive disclosure. Use to change the brief one-line description of what the map covers.",
  "moc:ADD_CORE_IDEA":
    "Adds a note to the map's core ideas, with a context phrase explaining why it matters and a sort position. Use to feature a note on the map; each note can be added only once.",
  "moc:UPDATE_CORE_IDEA":
    "Changes the context phrase or sort position of a note already listed in the map's core ideas. Use to reword why a featured note matters.",
  "moc:REMOVE_CORE_IDEA":
    "Removes a note from the map's core ideas. Use to stop featuring that note on the map.",
  "moc:REORDER_CORE_IDEAS":
    "Rearranges the map's core ideas into a new order given as a list of their ids. Use to change the sequence of featured notes.",
  "moc:ADD_TENSION":
    "Records an unresolved tension or contradiction on the map, with a description and the notes involved. Use to flag ideas on the map that conflict.",
  "moc:REMOVE_TENSION":
    "Removes a tension from the map, typically once it is resolved or dissolved. Use to clear a conflict that no longer applies.",
  "moc:ADD_OPEN_QUESTION":
    "Adds an open question, an unexplored direction worth investigating, to the map. Use to capture something the map does not yet answer.",
  "moc:REMOVE_OPEN_QUESTION":
    "Removes an open question from the map by its exact text. Use once the question is answered or dropped.",
  "moc:ADD_CHILD_MOC":
    "Links a narrower map of content as a child of this map. Use to nest a sub-map under this one.",
  "moc:REMOVE_CHILD_MOC":
    "Unlinks a child map of content from this map. Use when a sub-map no longer belongs under it.",
  "moc:SET_METADATA_FIELD":
    "Sets a whitelisted metadata field on the map; currently only version, the Powerhouse stack release the map's knowledge is registered against. Use to record that version.",

  /* observation ------------------------------------------------------- */
  "observation:CREATE_OBSERVATION":
    "Captures a new observation, a friction, surprise, process, methodology or quality signal noticed while working, with title, description and category. Use to log something worth learning from.",
  "observation:PROMOTE_OBSERVATION":
    "Marks the observation as promoted into a permanent note and records which note it became. Use when the observation is turned into lasting knowledge.",
  "observation:IMPLEMENT_OBSERVATION":
    "Marks the observation as implemented, meaning the system was changed to act on it. Use when the friction or idea has been addressed.",
  "observation:ARCHIVE_OBSERVATION":
    "Archives the observation without acting on it. Use to dismiss an observation that is no longer relevant.",

  /* pipeline-queue ---------------------------------------------------- */
  "pipeline-queue:ADD_TASK":
    "Queues a new pending processing task of a given task type for a target, optionally tied to a batch or document. Use to schedule new work in the pipeline.",
  "pipeline-queue:ASSIGN_TASK":
    "Assigns an existing task to a processor or person and marks it in progress. Use when someone picks up the task.",
  "pipeline-queue:ADVANCE_PHASE":
    "Completes the task's current phase with a handoff (work done, files modified) and moves it to the next phase, or to done after the last phase. Use to hand off finished phase work.",
  "pipeline-queue:COMPLETE_TASK":
    "Marks the whole task as done, regardless of remaining phases. Use when the task is finished.",
  "pipeline-queue:FAIL_TASK":
    "Marks the task as failed with a reason and removes it from active work. Use when the task cannot be completed.",
  "pipeline-queue:BLOCK_TASK":
    "Marks the task as blocked, with a reason. Use when work on the task cannot continue until something else happens.",
  "pipeline-queue:UNBLOCK_TASK":
    "Returns a blocked task to pending so work can resume. Use only when the task is currently blocked and the obstacle is gone.",

  /* project ----------------------------------------------------------- */
  "project:CREATE_PROJECT":
    "Initializes the project with its name and optional description, owner and starting status. Use once when setting up a new project.",
  "project:UPDATE_PROJECT_INFO":
    "Changes the project's name or description. Use to rename the project or rewrite what it is about.",
  "project:SET_PROJECT_STATUS":
    "Sets the project's lifecycle status: planning, active, on hold, completed or archived. Use to pause, start, finish or archive the project.",
  "project:SET_OWNER":
    "Sets or clears the person who owns the project. Use to hand the project to a new owner.",
  "project:SET_TARGET_DATE":
    "Sets or clears the project's target completion date. Use to schedule a deadline for the project.",
  "project:LINK_WBS":
    "Links the project to its work breakdown structure document, or clears the link. Use to attach the goal plan to the project.",
  "project:ADD_MEMBER":
    "Adds a person or agent to the project team with a name and optional role. Use to bring someone onto the team.",
  "project:UPDATE_MEMBER":
    "Changes an existing team member's name, role or kind (human or agent). Use to correct or update someone already on the team.",
  "project:REMOVE_MEMBER":
    "Removes a member from the project team. Use when someone leaves the team.",
  "project:ADD_DELIVERABLE":
    "Adds a planned deliverable to the project with a title and optional description, linked goal and URL. Use to record something the project will produce.",
  "project:UPDATE_DELIVERABLE":
    "Changes an existing deliverable's title, description, linked goal or URL. Use to edit the details of a deliverable.",
  "project:SET_DELIVERABLE_STATUS":
    "Sets a deliverable's status: planned, in progress, delivered or cancelled, recording the delivery time when delivered. Use to track a deliverable's progress.",
  "project:REMOVE_DELIVERABLE":
    "Deletes a deliverable from the project. Use when it is no longer part of the plan.",
  "project:ADD_KNOWLEDGE_REF":
    "Links a knowledge document from the vault to the project. Use to attach a relevant note or source.",
  "project:REMOVE_KNOWLEDGE_REF":
    "Unlinks a knowledge document from the project. Use when it is no longer relevant.",
  "project:SET_REFERENCES":
    "Replaces the project's list of external reference URLs. Use to set the web links the project points to.",

  /* research-claim ---------------------------------------------------- */
  "research-claim:CREATE_CLAIM":
    "Initializes a research claim with its title, summary, content, kind, methodology, sources and topics. Use once when recording a new claim.",
  "research-claim:ADD_RESEARCH_CONNECTION":
    "Connects this claim to another research claim with a context phrase explaining the relation. Use to link related claims.",
  "research-claim:REMOVE_RESEARCH_CONNECTION":
    "Removes a connection from this claim to another claim. Use to drop a link between claims.",
  "research-claim:UPDATE_CLAIM_CONTENT":
    "Replaces the body text of the claim. Use to rewrite what the claim says.",

  /* source ------------------------------------------------------------ */
  "source:INGEST_SOURCE":
    "Adds new source material (article, paper, book chapter, transcript, web page and so on) to the inbox with its title, content and optional author and URL. Use to bring a new source into the vault.",
  "source:SET_SOURCE_STATUS":
    "Moves the source through processing: inbox, extracting, extracted or archived. Use to mark where the source is in extraction.",
  "source:ADD_EXTRACTED_CLAIM":
    "Records that a claim was extracted from this source by adding a reference to it. Use after creating a claim from the source.",
  "source:RECORD_EXTRACTION_STATS":
    "Records extraction statistics for the source: claims extracted, items skipped and skip rate. Use when an extraction pass finishes.",

  /* tension ----------------------------------------------------------- */
  "tension:CREATE_TENSION":
    "Records a new tension, a contradiction between notes, with title, description and the notes involved. Use to flag ideas that conflict.",
  "tension:RESOLVE_TENSION":
    "Closes an open tension as resolved, with an explanation of how the contradiction was settled. Use when the conflict was real and has been worked out.",
  "tension:DISSOLVE_TENSION":
    "Closes an open tension as dissolved, explaining why the contradiction was only apparent. Use when the conflict turns out not to be real.",
  "tension:ADD_INVOLVED_REF":
    "Adds another note to the set of notes involved in this tension. Use to widen the tension to include a further note.",

  /* vault-config ------------------------------------------------------ */
  "vault-config:INITIALIZE_CONFIG":
    "Sets the vault's name and domain when the configuration is first created. Use once to set up the vault.",
  "vault-config:UPDATE_DIMENSION":
    "Sets the value, confidence and optional rationale of one configuration dimension (granularity, organization, linking, processing, navigation, maintenance, schema or automation). Use to tune how the vault behaves.",
  "vault-config:UPDATE_VOCABULARY":
    "Renames one vocabulary term the vault uses, such as notes, inbox, reduce, reflect or topic map. Use to customize the words shown to the user.",
  "vault-config:UPDATE_PIPELINE_CONFIG":
    "Changes pipeline settings: processing depth, whether phases chain automatically, and extraction selectivity. Use to tune the processing pipeline.",
  "vault-config:UPDATE_MAINTENANCE_THRESHOLD":
    "Sets the numeric threshold for one maintenance condition, such as orphan count, inbox pressure, oversized maps or stale-note days. Use to change when maintenance warnings fire.",
  "vault-config:ADD_EXTRACTION_CATEGORY":
    "Adds a new extraction category with a name, description and active flag. Use to define a new kind of thing to extract from sources.",
  "vault-config:TOGGLE_EXTRACTION_CATEGORY":
    "Turns an existing extraction category on or off. Use to enable or disable extracting that category.",
  "vault-config:TOGGLE_FEATURE":
    "Enables or disables a named feature block of the vault. Use to switch a feature on or off.",

  /* wbs (work breakdown structure) ------------------------------------ */
  "wbs:CREATE_GOAL":
    "Adds a new goal to the work breakdown, optionally under a parent goal, assigned to someone, or placed before another goal. Use to create a goal or sub-goal.",
  "wbs:UPDATE_GOAL_DESCRIPTION":
    "Rewrites the description of an existing goal. Use to rename or reword a goal.",
  "wbs:DELETE_GOAL":
    "Deletes a goal together with all of its sub-goals and removes any dependencies on them. Use to drop a goal from the plan.",
  "wbs:REORDER":
    "Moves a goal to a new position or under a different parent goal. Use to restructure the goal tree.",
  "wbs:SET_GOAL_STATUS":
    "Sets a goal's status: to do, in progress, blocked (with a reason), in review, completed or won't do, optionally recording its outcome. Use to track progress on a goal.",
  "wbs:ASSIGN_GOAL":
    "Assigns a goal to a person, or clears the assignee. Use to say who is responsible for a goal.",
  "wbs:SET_OUTCOME":
    "Sets or clears the recorded outcome of a goal, what it actually achieved. Use to write down the result of a goal.",
  "wbs:ADD_DEPENDENCIES":
    "Makes a goal depend on one or more other goals that must finish first. Use to record prerequisites between goals.",
  "wbs:REMOVE_DEPENDENCIES":
    "Removes one or more prerequisite goals from a goal's dependencies. Use when a goal no longer waits on them.",
  "wbs:ADD_NOTE":
    "Attaches a written note, with optional author and time, to a goal. Use to comment on or document progress for a goal.",
  "wbs:REMOVE_NOTE":
    "Deletes a note attached to a goal. Use to remove a comment from a goal.",
  "wbs:SET_OWNER":
    "Sets or clears the owner of the whole work breakdown structure. Use to change who owns the plan.",
  "wbs:SET_REFERENCES":
    "Replaces the work breakdown's list of external reference URLs. Use to set the web links the plan points to.",
  "wbs:SET_PROJECT_REF":
    "Links the work breakdown structure to its project document, or clears the link. Use to attach the plan to a project.",
};
