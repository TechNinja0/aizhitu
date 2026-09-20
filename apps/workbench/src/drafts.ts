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
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("diagram-workbench", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("drafts", { keyPath: "key" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function allDrafts(): Promise<Draft[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction("drafts").objectStore("drafts").getAll();
      r.onsuccess = () =>
        resolve(r.result.sort((a: Draft, b: Draft) => b.time - a.time));
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
      const t = db.transaction("drafts", "readwrite"),
        s = t.objectStore("drafts"),
        r = s.get(draft.key);
      r.onsuccess = () => s.put({ ...draft, previous: r.result?.xml });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}
export async function deleteDraft(key: string) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("drafts", "readwrite");
      t.objectStore("drafts").delete(key);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}
