import { spawn } from "node:child_process";
export type RunOptions = {
  cwd: string;
  input?: string;
  signal?: AbortSignal;
  timeout?: number;
  idleTimeout?: number;
  onStdout?: (chunk: string) => void;
};
export type Runner = (
  file: string,
  args: string[],
  options: RunOptions,
) => Promise<string>;
// No shell, bounded output, and termination of the whole process group on cancel/timeout.
export const runProcess: Runner = (file, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "",
      bytes = 0,
      settled = false,
      reason = "",
      diagnostic = "",
      force: NodeJS.Timeout | undefined;
    const kill = () => {
      if (force) return;
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, "SIGTERM");
        else child.kill();
      } catch {}
      force = setTimeout(() => {
        try {
          if (process.platform !== "win32" && child.pid)
            process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {}
      }, 1500);
      force.unref();
    };
    const abort = () => {
      if (!reason) {
        reason = "任务已取消";
        kill();
      }
    };
    let idle: NodeJS.Timeout | undefined;
    const activity = () => {
      clearTimeout(idle);
      if (options.idleTimeout)
        idle = setTimeout(() => {
          reason =
            "CLI 连续 5 分钟没有输出，请检查客户端网络或模型可用性后重试";
          kill();
        }, options.idleTimeout);
    };
    activity();
    const timer = setTimeout(() => {
      reason = "CLI 响应超时，达到任务最长运行时间，请缩小图稿范围后重试";
      kill();
    }, options.timeout ?? 300000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(idle);
      clearTimeout(force);
      options.signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(output);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (b) => {
      activity();
      options.onStdout?.(b);
      bytes += Buffer.byteLength(b);
      if (bytes > 24 * 1024 * 1024) {
        reason = "CLI 输出超过限制";
        kill();
      } else output += b.toString();
    });
    // Raw CLI stderr can contain credentials or private context. Do not return or persist it.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (b) => {
      diagnostic = (diagnostic + b).slice(-8000);
    });
    child.stdin.on("error", () => {});
    child.on("error", () =>
      finish(Error("无法启动 CLI，请检查执行路径与权限")),
    );
    child.on("close", (code) =>
      finish(
        reason
          ? Error(reason)
          : code !== 0
            ? Error(
                /requires a newer version|upgrade to the latest/i.test(
                  output + diagnostic,
                )
                  ? "当前模型要求更新版本的 CLI，请在设置中选择已安装的新版客户端，或在终端升级后重试"
                  : /unauthorized|authentication|not logged in|sign in|401/i.test(
                        output + diagnostic,
                      )
                    ? "CLI 登录已失效或未登录，请在终端完成登录后重试"
                    : `CLI 执行失败（退出码 ${code}），请在终端检查登录、网络与权限`,
              )
            : undefined,
      ),
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdin.end(options.input || "");
  });
