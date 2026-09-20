export const uuid = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  return Array.from(b, (x) => x.toString(16).padStart(2, "0"))
    .join("")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
};

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Embedded browsers may expose this API while denying clipboard access.
    }
  }
  const focused = document.activeElement as HTMLElement | null;
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  // A modal dialog makes the rest of the document inert.
  (document.querySelector("dialog[open]") || document.body).append(input);
  input.focus();
  input.select();
  try {
    if (!document.execCommand("copy"))
      throw Error("浏览器不支持复制，请手动复制地址栏链接");
  } finally {
    input.remove();
    focused?.focus({ preventScroll: true });
  }
}
