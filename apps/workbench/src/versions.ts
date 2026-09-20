import { uuid } from "./uuid";
export type Version = {
  id: string;
  documentId: string;
  name: string;
  label: string;
  xml: string;
  time: number;
};
const MAX_COUNT = 20,
  MAX_BYTES = 40 * 1024 * 1024;
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("diagram-versions", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("versions", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function listVersions(documentId: string): Promise<Version[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction("versions").objectStore("versions").getAll();
      r.onsuccess = () =>
        resolve(
          r.result
            .filter((v: Version) => v.documentId === documentId)
            .sort((a: Version, b: Version) => b.time - a.time),
        );
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function addVersion(value: Omit<Version, "id" | "time">) {
  if (new Blob([value.xml]).size > 20 * 1024 * 1024)
    throw Error("版本文件超过 20 MiB");
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("versions", "readwrite"),
        store = tx.objectStore("versions"),
        r = store.getAll();
      r.onsuccess = () => {
        const all: Version[] = r.result.sort(
          (a: Version, b: Version) => b.time - a.time,
        );
        const next = {
          ...value,
          id: uuid(),
          time: Math.max(Date.now(), (all[0]?.time || 0) + 1),
        };
        store.put(next);
        let total = new Blob([next.xml]).size,
          count = 1;
        for (const v of all) {
          total += new Blob([v.xml]).size;
          if (v.documentId === value.documentId) count++;
          if (
            total > MAX_BYTES ||
            (v.documentId === value.documentId && count > MAX_COUNT)
          )
            store.delete(v.id);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function removeVersion(id: string) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("versions", "readwrite");
      tx.objectStore("versions").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
