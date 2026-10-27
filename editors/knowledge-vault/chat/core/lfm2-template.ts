/**
 * The X5 prompt as llama.cpp renders it without jinja; wllama has no
 * apply-template API. LFM2's template contains `<|im_start|>`, so the legacy
 * detector picks chatml (llama-chat.cpp at 46ca246, no trimming). BOS is
 * added by the server when it tokenizes the string.
 */
import type { WllamaChatMessage } from "./wllama-types.js";

export function renderLfm2Legacy(messages: readonly WllamaChatMessage[]): string {
  let s = "";
  for (const m of messages) s += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
  return `${s}<|im_start|>assistant\n`;
}
