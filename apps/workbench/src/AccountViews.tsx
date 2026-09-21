import React, { useEffect, useState } from "react";
import { workspaceApi, workspaceContext, type Actor } from "./SharedWorkspace";
import { copyText } from "./uuid";
import "./accounts.css";
export function keepSession(result: any) {
  localStorage.removeItem("zhitu-session");
  sessionStorage.removeItem("zhitu-session");
  (result.remember === false ? sessionStorage : localStorage).setItem(
    "zhitu-session",
    result.token,
  );
  workspaceContext.token = result.token;
  workspaceContext.actor = result.actor;
}
export function clearSession() {
  localStorage.removeItem("zhitu-session");
  sessionStorage.removeItem("zhitu-session");
  workspaceContext.token = "";
  workspaceContext.actor = undefined;
}
export async function signOut() {
  await workspaceApi("session", undefined, "DELETE");
  clearSession();
  location.assign("/");
}
export function AccountEntry({
  actor,
  onSuccess,
}: {
  actor?: Actor;
  onSuccess: (a: Actor) => void;
}) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [login, setLogin] = useState(""),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [code, setCode] = useState("");
  const [remember, setRemember] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const setup = !!actor,
    newPassword = setup || mode !== "login";
  return (
    <main className="shared-login">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError("");
          if (newPassword && password !== confirm) {
            setError("两次输入的密码不一致");
            return;
          }
          setBusy(true);
          try {
            const result = await workspaceApi(
              setup ? "account/setup" : `auth/${mode}`,
              { login, name, password, code: code.trim(), remember },
            );
            keepSession(result);
            onSuccess(result.actor);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="shared-kicker">AI智图 · 团队工作区</span>
        <h1>
          {setup
            ? "为原身份设置账号"
            : mode === "register"
              ? "创建账号"
              : mode === "reset"
                ? "找回与设置密码"
                : "登录工作区"}
        </h1>
        <p>
          {setup
            ? `当前身份：${actor.name}。补设账号后，原文件、个人模板和分享权限继续保留。不要重新注册来认领同名用户。`
            : mode === "reset"
              ? "忘记登录名或密码，请联系本机管理员核实身份，获取 15 分钟内有效的一次性设置凭证。"
              : "使用固定账号登录，换浏览器也能找到自己的文件。"}
        </p>
        {!setup && (
          <nav className="account-tabs" aria-label="账号操作">
            {[
              ["login", "登录"],
              ["register", "注册新账号"],
              ["reset", "忘记账号或密码"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                disabled={busy}
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value as any);
                  setError("");
                  setPassword("");
                  setConfirm("");
                }}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
        {(setup || mode !== "reset") && (
          <label>
            登录名
            <input
              required
              autoComplete="username"
              minLength={3}
              maxLength={40}
              pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{2,39}"
              placeholder="例如 user01（唯一，不区分大小写）"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
          </label>
        )}
        {!setup && mode === "register" && (
          <label>
            显示姓名
            <input
              required
              autoComplete="nickname"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        {!setup && mode === "reset" && (
          <label>
            一次性设置凭证
            <input
              required
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
        )}
        <label>
          {newPassword ? "设置密码" : "密码"}
          <input
            required
            type="password"
            autoComplete={newPassword ? "new-password" : "current-password"}
            minLength={newPassword ? 6 : undefined}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {newPassword && (
          <>
            <small>至少 6 个字符，不限制字符组合（最多 128 个字符）。</small>
            <label>
              确认密码
              <input
                required
                type="password"
                autoComplete="new-password"
                minLength={6}
                maxLength={128}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          </>
        )}
        <label className="account-check">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          记住登录 30 天（公共电脑请取消）
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy
            ? "正在处理…"
            : setup
              ? "保留原身份并设置账号"
              : mode === "register"
                ? "注册并进入"
                : mode === "reset"
                  ? "设置密码并进入"
                  : "登录"}
        </button>
        {setup && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void signOut().catch((e) => {
                setError(e.message);
                setBusy(false);
              });
            }}
          >
            退出此身份
          </button>
        )}
      </form>
    </main>
  );
}
export function AccountSettings({ actor }: { actor: Actor }) {
  const [oldPassword, setOldPassword] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="account-page">
      <a href="/">← 文件库</a>
      <h1>账号设置</h1>
      <p>
        登录名：{actor.login} · 显示姓名：{actor.name}
      </p>
      <form
        className="account-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          if (password !== confirm) {
            setError("两次密码不一致");
            return;
          }
          setBusy(true);
          try {
            const r = await workspaceApi("account/password", {
              oldPassword,
              password,
              remember: !!localStorage.getItem("zhitu-session"),
            });
            keepSession(r);
            location.assign("/");
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <h2>修改密码</h2>
        <p>修改后，其他浏览器的旧登录与协同会话会失效。请先返回文件库完成保存。</p>
        <label>
          原密码
          <input
            required
            type="password"
            autoComplete="current-password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
          />
        </label>
        <label>
          新密码
          <input
            required
            type="password"
            minLength={6}
            maxLength={128}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          确认新密码
          <input
            required
            type="password"
            minLength={6}
            maxLength={128}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "正在修改…" : "修改密码"}
        </button>
      </form>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void signOut().catch((e) => {
            setError(e.message);
            setBusy(false);
          });
        }}
      >
        退出登录
      </button>
    </main>
  );
}
export function AdminUsers() {
  const [users, setUsers] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [query, setQuery] = useState("");
  const [login, setLogin] = useState(""),
    [name, setName] = useState(""),
    [resetLogin, setResetLogin] = useState(""),
    [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [credential, setCredential] = useState<any>();
  const reload = async () => setUsers(await workspaceApi("admin/users"));
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, []);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (selected)
      document
        .querySelector('[aria-label="管理选中用户"]')
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [selected]);
  const user = users.find((u) => u.id === selected);
  const visible = users.filter((u) =>
    [u.login, u.name, u.id].some((v) =>
      String(v || "")
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
  );
  return (
    <main className="account-page admin-users">
      <a href="/">← 文件库</a>
      <h1>用户管理</h1>
      <p>
        仅本机管理员可操作。优先停用以保留数据；删除前需要处理该用户的全部图稿与个人模板。
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form
        className="account-card account-create"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const c = await workspaceApi("admin/users", { login, name });
            setCredential(c);
            setLogin("");
            setName("");
            setSelected(c.id);
          });
        }}
      >
        <h2>创建用户</h2>
        <label>
          登录名
          <input
            required
            minLength={3}
            maxLength={40}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </label>
        <label>
          显示姓名
          <input
            required
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          创建并生成设置凭证
        </button>
      </form>
      {credential && (
        <section
          className="account-card account-credential"
          aria-label="密码设置凭证"
        >
          <h2>请将凭证交给本人</h2>
          <p>
            登录名：<strong>{credential.login}</strong> · 有效至{" "}
            {new Date(credential.expires).toLocaleString()}
          </p>
          <p>
            对方在登录页选择“忘记账号或密码”，输入凭证并自行设置密码。凭证只显示本次，不会进入链接。
          </p>
          <label>
            一次性设置凭证
            <input
              readOnly
              value={credential.resetCode}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <button
            onClick={() =>
              void copyText(credential.resetCode)
                .then(() => setNotice("凭证已复制"))
                .catch(() => setNotice("自动复制失败，请手动选择凭证复制"))
            }
          >
            复制凭证
          </button>
          <button onClick={() => setCredential(undefined)}>关闭凭证</button>
        </section>
      )}
      {user && (
        <section className="account-card" aria-label="管理选中用户">
          <h2>
            管理 {user.name} · {user.login || "待补设账号"}
          </h2>
          <small>{user.id}</small>
          <div className="account-actions">
            <button
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    user.status === "active"
                      ? "停用后该用户所有登录和编辑权立即失效，文件保留。继续？"
                      : "重新启用该用户？",
                  )
                )
                  return;
                void run(async () => {
                  await workspaceApi(
                    `admin/users/${user.id}`,
                    {
                      revision: user.revision,
                      status: user.status === "active" ? "disabled" : "active",
                    },
                    "PATCH",
                  );
                  setNotice("用户状态已更新");
                  setCredential(undefined);
                });
              }}
            >
              {user.status === "active" ? "停用用户" : "启用用户"}
            </button>
            <button
              disabled={
                busy ||
                user.status !== "disabled" ||
                !!user.documents ||
                !!user.templates
              }
              onClick={() => {
                if (
                  !window.confirm(
                    "删除此用户？保留历史身份记录，原登录名不再分配。",
                  )
                )
                  return;
                void run(async () => {
                  await workspaceApi(
                    `admin/users/${user.id}`,
                    { revision: user.revision },
                    "DELETE",
                  );
                  setSelected("");
                  setCredential(undefined);
                  setNotice("用户已删除");
                });
              }}
            >
              删除用户
            </button>
            <button onClick={() => setSelected("")}>收起</button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (
                !window.confirm(
                  "重置后原密码、所有登录与编辑权立即失效，需凭新凭证设置密码。继续？",
                )
              )
                return;
              void run(async () => {
                setCredential(
                  await workspaceApi(`admin/users/${user.id}/reset`, {
                    revision: user.revision,
                    login: resetLogin,
                  }),
                );
              });
            }}
          >
            <h3>重置或补设密码</h3>
            {!user.login && (
              <label>
                为原身份设置登录名
                <input
                  required
                  minLength={3}
                  maxLength={40}
                  value={resetLogin}
                  onChange={(e) => setResetLogin(e.target.value)}
                />
              </label>
            )}
            <p>核实本人身份后再重置。管理员不能查看用户原密码。</p>
            <button disabled={busy || user.status !== "active"}>
              生成一次性设置凭证
            </button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (
                !window.confirm(
                  "转移该用户全部图稿（含回收站）？文件将改为仅接收人和管理员可见，原创建人记录和历史保留。个人模板仍保留在原账号。",
                )
              )
                return;
              void run(async () => {
                const r = await workspaceApi(
                  `admin/users/${user.id}/transfer`,
                  { revision: user.revision, targetId },
                );
                setNotice(`已转移 ${r.count} 份图稿，接收人可重新设置分享权限`);
                setTargetId("");
              });
            }}
          >
            <h3>转移全部图稿</h3>
            <p>
              先停用原用户。正在被其他成员编辑的图稿需要先让相关页面返回文件库；个人模板不随图稿转移，有模板的用户可保持停用。
            </p>
            <label>
              接收人
              <select
                aria-label="接收人"
                required
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                <option value="">请选择已设置账号的启用用户</option>
                {users
                  .filter(
                    (u) =>
                      u.id !== user.id &&
                      u.status === "active" &&
                      !u.needsSetup,
                  )
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}（{u.login}）
                    </option>
                  ))}
              </select>
            </label>
            <button
              disabled={
                busy ||
                user.status !== "disabled" ||
                !user.documents ||
                !targetId
              }
            >
              转移图稿
            </button>
          </form>
        </section>
      )}
      <div className="account-list-heading">
        <h2>用户列表 · {users.length} 人</h2>
        <input
          aria-label="搜索用户"
          placeholder="搜索姓名、登录名或身份编号"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button disabled={busy} onClick={() => void run(reload)}>
          刷新列表
        </button>
      </div>
      <div className="account-table-scroll">
        <table>
          <thead>
            <tr>
              <th>用户</th>
              <th>账号状态</th>
              <th>创建 / 最近登录</th>
              <th>图稿 / 模板 / 登录会话</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.name}</strong>
                  <small>{u.login || "尚未设置登录名"}</small>
                  <small>{u.id}</small>
                </td>
                <td>
                  {u.status === "disabled"
                    ? "已停用"
                    : u.needsSetup
                      ? "待设置密码"
                      : "正常"}
                </td>
                <td>
                  <small>{new Date(u.createdAt).toLocaleString()}</small>
                  <small>
                    {u.lastLogin
                      ? new Date(u.lastLogin).toLocaleString()
                      : "暂无登录记录"}
                  </small>
                </td>
                <td>
                  {u.documents} / {u.templates} / {u.sessions}
                </td>
                <td>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setSelected(u.id);
                      setResetLogin("");
                      setTargetId("");
                      setError("");
                    }}
                  >
                    管理
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <p>没有匹配的用户</p>}
      </div>
    </main>
  );
}
