/**
 * Version of the step-1 / step-2 prompt bytes a fine-tune is trained on.
 * Bump it whenever `STEP1_SYSTEM`, `scoringMessages`, `STEP2_SYSTEM`,
 * `argsMessages`, `step2Order`, the op descriptions or the vocabularies
 * change. Pinned by tests/unit/chat-prompt-format.test.ts.
 */
export const PROMPT_FORMAT_VERSION = "r6.1";
