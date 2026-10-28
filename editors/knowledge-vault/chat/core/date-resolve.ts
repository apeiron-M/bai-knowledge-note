// Moved to nl-runtime in M1. This shim keeps the old path for the training,
// script and test importers; M3 retargets them and deletes it.
export {
  dateRuleNote,
  resolveDate,
  resolveDates,
} from "nl-runtime";
