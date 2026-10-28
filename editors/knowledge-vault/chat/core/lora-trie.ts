// Moved to nl-runtime in M1. This shim keeps the old path for the training,
// script and test importers; M3 retargets them and deletes it.
export {
  ANSWER_TABLE_TOKENIZER,
  answersFor,
  answerTableMismatch,
  type TrieAnswer,
  type TrieMode,
  type TrieResult,
  trieScore,
  type TrieShape,
  trieShape,
} from "nl-runtime";
