export type OnlinePage = { owner: string; name: string; client: string };

// Keep clean-page heartbeats below the server's 30-second presence lease.
// Dirty/deferred work always takes priority over visibility or member count.
export function collaborationInterval({
  pending,
  hidden,
  pages,
}: {
  pending: boolean;
  hidden: boolean;
  pages: number;
}) {
  if (pending) return 1000;
  if (hidden) return 10000;
  return pages > 1 ? 1000 : 5000;
}

export function collaborationPresentation(
  document: { owner: string; visibility: string },
  pages: OnlinePage[],
  actorId?: string,
  viewing = false,
) {
  const people = new Map<string, { name: string; count: number }>();
  for (const page of pages) {
    const person = people.get(page.owner);
    if (person) person.count++;
    else people.set(page.owner, { name: page.name, count: 1 });
  }
  // Stable order keeps names from jumping when editor pages join or leave.
  const ordered = [...people].sort(
    ([a, x], [b, y]) =>
      x.name.localeCompare(y.name, "zh-CN") || a.localeCompare(b),
  );
  const names = ordered.map(
    ([id, person]) => `${person.name}${id === actorId ? "（你）" : ""}`,
  );
  const showMembers = pages.length > 1 || (viewing && pages.length > 0);
  const sameAccount = people.size === 1 && pages.length > 1;
  return {
    scope:
      document.visibility === "private"
        ? document.owner === actorId
          ? "仅自己可见"
          : "私有文件"
        : "已分享",
    scopeTitle:
      document.visibility === "private"
        ? "仅文件所有者和本机管理员可访问；同一账号的多个页面可同步"
        : `${document.visibility === "selected" ? "指定成员可访问" : "所有工作区成员可访问"}；编辑权限见分享窗口，复制链接不会增加授权`,
    mode: viewing ? "仅查看" : showMembers ? "" : "编辑中",
    membersText: !showMembers
      ? ""
      : sameAccount
        ? `${names[0]}在 ${pages.length} 个页面编辑`
        : `${names.slice(0, 3).join("、")}${names.length > 3 ? `等 ${names.length} 人` : ""}正在编辑`,
    membersTitle: ordered
      .map(
        ([id, person]) =>
          `${person.name}${id === actorId ? "（你）" : ""} · ${person.count} 个编辑页面`,
      )
      .join("；"),
  };
}
