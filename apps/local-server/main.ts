import { spawn } from "node:child_process";
import { startServer } from "./server.ts";
const idx = process.argv.indexOf("--port");
const option = (name: string) => {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw Error(`${name} 缺少参数`);
  return value;
};
const server = await startServer({
  dev: process.argv.includes("--dev"),
  shared: true,
  lanHost: option("--lan-host"),
  enginePort: Number(
    option("--editor-port") || (option("--lan-host") ? 4318 : 0),
  ),
  dataDirectory: option("--data-dir"),
  tlsCert: option("--tls-cert"),
  tlsKey: option("--tls-key"),
  port: idx >= 0 ? Number(process.argv[idx + 1]) : 4317,
});
console.log(
  `AI智图已启动：${server.publicOrigin}\n${option("--lan-host") ? "局域网共享已启用；请开放工作台与画布两个端口。" : "仅本机访问；使用 --lan-host <本机局域网IP> 启用团队访问。"}\n按 Ctrl+C 停止。`,
);
if (server.workspace)
  console.log(
    `使用固定账号和密码登录，可记住登录 30 天；旧浏览器首次升级需补设账号。\n本机管理入口：${server.origin}\n数据目录：${server.workspace.directory}`,
  );
if (process.argv.includes("--open")) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer.exe"
        : "xdg-open";
  const opener = spawn(command, [server.publicOrigin], {
    stdio: "ignore",
    shell: false,
  });
  opener.on("error", () => console.log("请在浏览器打开上方地址。"));
}
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, async () => {
    await server.close();
    process.exit(0);
  });
