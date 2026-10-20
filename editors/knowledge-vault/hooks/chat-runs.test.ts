import { describe, expect, it } from "vitest";
import { chatRun, endChatRun, runFor, startChatRun, stopChatRun, subscribeChatRun, updateChatRun } from "./chat-runs.js";

const thread = (id: string) => ({ id, title: id, updatedAt: "2026-10-10T00:00:00Z", messages: [{ role: "user" as const, content: "why?" }] });

describe("chat runs", () => {
  it("keeps an answer arriving while nobody watches, and shows it to whoever looks next", () => {
    const ctrl = startChatRun("vault-a", thread("t1"));
    let seen = 0;
    const leave = subscribeChatRun("vault-a", () => (seen += 1));
    updateChatRun("vault-a", ctrl, { streamingText: "Because" });
    leave(); // the chat screen unmounts: the answer goes on
    updateChatRun("vault-a", ctrl, { streamingText: "Because the source says so." });
    expect(seen).toBe(1);
    const back = runFor(chatRun("vault-a"), "t1");
    expect(back?.isStreaming).toBe(true);
    expect(back?.streamingText).toBe("Because the source says so.");
    expect(runFor(chatRun("vault-a"), "another-thread")).toBeUndefined();
    updateChatRun("vault-a", ctrl, { isStreaming: false });
    endChatRun("vault-a", ctrl);
    expect(chatRun("vault-a")?.isStreaming).toBe(false);
  });

  it("drops a replaced answer's late steps, and stops the running one on request", () => {
    const first = startChatRun("vault-b", thread("t1"));
    const second = startChatRun("vault-b", thread("t2"));
    expect(first.signal.aborted).toBe(true);
    updateChatRun("vault-b", first, { streamingText: "stale" });
    expect(chatRun("vault-b")?.thread.id).toBe("t2");
    expect(chatRun("vault-b")?.streamingText).toBe("");
    stopChatRun("vault-b");
    expect(second.signal.aborted).toBe(true);
  });
});
