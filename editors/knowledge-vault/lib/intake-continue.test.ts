import { describe, expect, it } from "vitest";
import type { IntakeFile, Section } from "./intake-model.js";
import { continuation } from "./intake-publish.js";
import { continuePublish } from "./intake-service.js";
import { memoryJournal, type JournalItem } from "./publish-journal.js";
import type { VaultApi } from "./vault-api.js";

const section = (title: string): Section => ({ title, content: `About ${title}.` }) as unknown as Section;
const file = (titles: string[], over: Partial<IntakeFile> = {}): IntakeFile =>
  ({
    id: "f",
    name: "Machine-Learning-Systems-Vol1.pdf",
    size: 1,
    mimeType: "application/pdf",
    state: "converted",
    sourceType: "BOOK_CHAPTER",
    folderName: "Machine-Learning-Systems-Vol1 (2)",
    renamedFrom: "Machine-Learning-Systems-Vol1",
    converted: { sections: titles.map(section) },
    selected: titles.map(() => true),
    ...over,
  }) as unknown as IntakeFile;

describe("adding a file whose sections are partly in the vault already", () => {
  it("continues in its own folder with the sections already there left out — not in a renamed copy", () => {
    const titles = ["Preface", "1 Introduction", "1.1 Systems", "2 Hardware", "2.1 GPUs"];
    const inFolder = new Map([["Machine-Learning-Systems-Vol1", ["Preface", "1 Introduction ", "1.1  Systems"]]]);
    const going = continuation(file(titles), inFolder);
    expect(going?.folderName).toBe("Machine-Learning-Systems-Vol1");
    expect(going?.renamedFrom).toBeUndefined();
    expect(going?.alreadyIn).toEqual([true, true, true, false, false]);
    expect(going?.selected).toEqual([false, false, false, true, true]);
    // A folder that only shares the name — mostly another document's sections — keeps the rename.
    const other = new Map([["Machine-Learning-Systems-Vol1", ["Preface", "Chapter A", "Chapter B", "Chapter C"]]]);
    expect(continuation(file(titles), other)).toBeNull();
  });

  it("carries on an add cut off part-way: only what is missing is created, the one made as the page went away included", async () => {
    const journal = memoryJournal();
    const items: JournalItem[] = ["s1", "s2", "s3", "s4", "s5"].map((title) => ({
      title,
      content: `${title} text`,
      sourceType: "BOOK_CHAPTER",
      actions: [{ type: "ATTACH_ORIGINAL_FILE", scope: "global", input: { originalFile: "attachment://v1:abc" } }],
    }));
    const id = await journal.start({ driveId: "d", fileName: "Book.pdf", folderId: "folder", folderName: "Book" }, items);
    await journal.advance(id, "src-1");
    await journal.advance(id, "src-2");
    // The page went away right after creating s3, before writing it down.
    const posts: { path: string; body: { title?: string; documentId?: string } }[] = [];
    let n = 3;
    const api = {
      post: (path: string, body: { title?: string; documentId?: string }) => {
        posts.push({ path, body });
        return Promise.resolve(path === "/sources" ? { id: `src-${++n}` } : {});
      },
    } as unknown as VaultApi;
    const [entry] = await journal.entries("d");
    const result = await continuePublish(entry, {
      api,
      journal,
      folderTitles: () => Promise.resolve(["s1", "s2", "s3"]),
    });
    expect(posts.filter((p) => p.path === "/sources").map((p) => p.body.title)).toEqual(["s4", "s5"]);
    // Each new source is given its original at once.
    expect(posts.map((p) => p.path)).toEqual(["/sources", "/actions", "/sources", "/actions"]);
    expect(result?.sourceIds).toEqual(["src-1", "src-2", "src-4", "src-5"]);
    expect(await journal.entries("d")).toEqual([]);
  });
});
