import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const at = (...parts: string[]) => resolve(ROOT, ...parts);
