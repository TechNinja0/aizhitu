export type Draft = {
  key: string;
  documentId: string;
  session: string;
  name: string;
  xml: string;
  previous?: string;
  revision: number;
  time: number;
};
export type DraftSummary = Omit<Draft, "xml" | "previous"> & { bytes: number };
export const DRAFT_LIMITS = {
  count: 20,
  perDocument: 3,
  bytes: 40 * 1024 * 1024,
  age: 30 * 86400_000,
};
const summary = ({ xml, previous, ...info }: Draft): DraftSummary => ({
  ...info,
  bytes: new Blob([xml, previous || ""]).size,
});

// Metadata is separate so opening the recovery list does not load image payloads.
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("diagram-workbench", 2);
    r.onupgradeneeded = () => {
      const drafts = r.result.objectStoreNames.contains("drafts")
        ? r.transaction!.objectStore("drafts")
        : r.result.createObjectStore("drafts", { keyPath: "key" });
      const metadata = r.result.createObjectStore("draft-info", {
        keyPath: "key",
      });
      // Upgrade existing recovery data one record at a time, without a getAll of XML.
      const cursor = drafts.openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        metadata.put(summary(cursor.result.value));
        cursor.result.continue();
      };
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => r.result.close();
      resolve(r.result);
    };
    r.onerror = () => reject(r.error);
  });
}
export function retainedDrafts(
  items: DraftSummary[],
  protectedKey?: string,
  now = Date.now(),
) {
  const sorted = [...items].sort(
    (a, b) =>
      Number(b.key === protectedKey) - Number(a.key === protectedKey) ||
      b.time - a.time ||
      a.key.localeCompare(b.key),
  );
  const kept: DraftSummary[] = [],
    counts = new Map<string, number>();
  let bytes = 0;
  for (const item of sorted) {
    const count = counts.get(item.documentId) || 0;
    // Always preserve the most recent write, even if it alone exceeds the budget.
    if (
      kept.length &&
      (kept.length >= DRAFT_LIMITS.count ||
        count >= DRAFT_LIMITS.perDocument ||
        bytes + item.bytes > DRAFT_LIMITS.bytes ||
        now - item.time > DRAFT_LIMITS.age)
    )
      continue;
    kept.push(item);
    bytes += item.bytes;
    counts.set(item.documentId, count + 1);
  }
  return kept;
}
function prune(
  tx: IDBTransaction,
  items: DraftSummary[],
  protectedKey?: string,
) {
  const kept = retainedDrafts(items, protectedKey),
    keys = new Set(kept.map((d) => d.key));
  for (const item of items)
    if (!keys.has(item.key)) {
      tx.objectStore("drafts").delete(item.key);
      tx.objectStore("draft-info").delete(item.key);
    }
  return kept;
}
export async function allDrafts(): Promise<DraftSummary[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["drafts", "draft-info"], "readwrite");
      const r = tx.objectStore("draft-info").getAll();
      let result: DraftSummary[] = [];
      r.onsuccess = () => {
        result = prune(tx, r.result);
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function getDraft(key: string): Promise<Draft> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction("drafts").objectStore("drafts").get(key);
      r.onsuccess = () =>
        r.result
          ? resolve(r.result)
          : reject(Error("草稿已被清理，请重新打开恢复列表"));
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function storeDraft(draft: Draft) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["drafts", "draft-info"], "readwrite"),
        s = tx.objectStore("drafts"),
        metadata = tx.objectStore("draft-info"),
        r = s.get(draft.key);
      r.onsuccess = () => {
        const next = { ...draft, previous: r.result?.xml };
        s.put(next);
        metadata.put(summary(next));
        const list = metadata.getAll();
        list.onsuccess = () => {
          prune(tx, list.result, draft.key);
        };
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function deleteDraft(key: string) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["drafts", "draft-info"], "readwrite");
      tx.objectStore("drafts").delete(key);
      tx.objectStore("draft-info").delete(key);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
