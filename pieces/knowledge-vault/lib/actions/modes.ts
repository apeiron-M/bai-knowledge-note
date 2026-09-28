import { Property } from "@powerhousedao/pieces-framework";

/** Dry run by default for every action that can write. */
export const modeProp = (writeLabel: string) =>
  Property.StaticDropdown({
    displayName: "Mode",
    description: "Dry run shows what would change and writes nothing.",
    required: true,
    defaultValue: "dry_run",
    options: { disabled: false, options: [{ label: "Dry run: propose only", value: "dry_run" }, { label: writeLabel, value: "write" }] },
  });
