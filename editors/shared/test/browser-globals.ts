/**
 * Minimal browser globals for unit tests that touch storage or the URL.
 *
 * The repo has no DOM test environment installed (neither jsdom nor
 * happy-dom), and pulling one in for four globals is not worth a dependency.
 * These stubs implement exactly the surface the vault's browser-side modules
 * use: Web Storage, a mutable `location`, and `history.replaceState`.
 *
 * Import for side effects at the top of a test file:
 *   import "../../shared/test/browser-globals.js";
 */

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

let current = new URL("http://localhost:3000/app");

const location = {
  get href() {
    return current.href;
  },
  get origin() {
    return current.origin;
  },
  get pathname() {
    return current.pathname;
  },
  get search() {
    return current.search;
  },
  get hash() {
    return current.hash;
  },
  assign(url: string) {
    current = new URL(url, current);
  },
  replace(url: string) {
    current = new URL(url, current);
  },
};

const history = {
  replaceState(_state: unknown, _title: string, url?: string | null) {
    if (url != null) current = new URL(url, current);
  },
  pushState(_state: unknown, _title: string, url?: string | null) {
    if (url != null) current = new URL(url, current);
  },
};

function define(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

// `Storage` is exposed so tests can `vi.spyOn(Storage.prototype, "setItem")`.
define("Storage", MemoryStorage);
define("localStorage", new MemoryStorage());
define("sessionStorage", new MemoryStorage());
define("location", location);
define("history", history);

/** Reset the URL between tests. */
export function resetLocation(url = "http://localhost:3000/app"): void {
  current = new URL(url);
}
