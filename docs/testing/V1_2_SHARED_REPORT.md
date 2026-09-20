# v1.2 局域网共享工作区验证报告

日期：2026-09-18。环境：macOS arm64、Node.js 22.22.0、仓库 Playwright Chromium，生产构建。

## 验证方式

服务使用临时 SQLite 数据目录，测试结束后删除；未将模拟图稿、账号或密码写入正式文件库。浏览器通过本机实际局域网 IPv4 地址访问，以两个独立 browser context 模拟不同用户，并以同 context 的第二个标签页模拟同账号多开。HTTP 页面实测为非安全上下文。

AI 使用受控的模拟 CLI runner，验证任务归属、队列、取消和返回候选的行为；本轮没有消耗真实模型额度。此报告不代表多台实体电脑、其他操作系统、公网部署或高并发容量已经实测。

## 功能覆盖

| 类别 | 已验证行为 |
| --- | --- |
| 身份 | 首次加入码注册、个人密码登录、重新登录保持账号 ID、错误密码拒绝、匿名 API 拒绝 |
| 文件 | 新建空白图、导入原生图稿、独立 ID/URL、重命名、重新打开、SQLite 重开后数据仍在 |
| 编辑租约 | 同时抢锁仅一人成功、同账号不同标签页互斥、不同文档可独立取得锁、心跳续约、超时接管、旧 token 拒绝 |
| 并发保存 | 无有效锁拒绝保存、同一旧 revision 的竞争请求仅一次成功、重复相同内容不重复生成版本 |
| 浏览器协作 | 真实节点文字编辑、自动保存、另一浏览器自动更新、刷新恢复、主动交接和反向同步 |
| 异常恢复 | 离线自动只读、租约过期后另一人接管、离线修改保留、旧版本不能覆盖新内容、下载恢复副本 |
| 历史与删除 | 最近 50 版限制、历史恢复产生新版本、删除权限、回收站、删除通知和恢复后继续访问 |
| 只读与输入 | 只读桥接拒绝修改、画布文字仍完整显示、只读 PDF 导出、输入文字时不被自动保存打断、结束编辑提交文字 |
| 页面退出 | 正常关闭标签页通过 keepalive 释放锁，另一访问者可立即接手 |
| AI | 成员不能修改配置、查询/取消他人任务失败、按账号过滤、串行排队、取消等待任务不调用模型、等待超一小时仍可见且不占执行时限 |
| 兼容 | 原有画布编辑、撤销、样式主题、PNG/SVG/PDF、AI 候选、浏览器本地版本及直接写回相关回归 |

## 命令与结果

| 实际命令 | 结果 |
| --- | --- |
| `npm run check` | 通过：构建、52 个单元测试，以及全部绘图/AI/多人浏览器回归 |
| `node --import tsx --test tests/ai-service.test.ts tests/shared-workspace.test.ts` | 14/14 通过，包括等待 70 分钟的模拟排队任务仍能成功执行 |
| `npm run build` | 最终时钟兼容调整后通过类型检查与生产构建 |
| `node --import tsx --test tests/shared-workspace.test.ts` | 最终调整后 2/2 通过 |
| `npm run test:shared` | 最终调整后 12 项分组断言通过，包括客户端时钟快 5 分钟；无未捕获浏览器异常 |
| `npm run docs:check` | 通过：99 个本地 Markdown 链接目标存在 |
| `node scripts/package-share.mjs` | 通过：生成 v1.2 分享包和 SHA-256 校验文件 |
| `node scripts/verify-local-package.mjs` | 通过：私有数据排除、独立目录离线安装、启动器、画布与授权 AI 配置 API |

全套回归后对租约的客户端时钟换算做了局部调整，再次完成构建、服务端共享测试和完整多人浏览器测试。Node 22 输出内置 SQLite 的实验性 API 提示；构建保留现有 `/fonts/fonts.css` 运行时资源提示，均未导致验证失败。

测试入口：

```sh
npm run check
node --import tsx --test tests/ai-service.test.ts tests/shared-workspace.test.ts
npm run test:shared
npm run docs:check
node scripts/package-share.mjs
node scripts/verify-local-package.mjs
```

产物：`artifacts/shared-verified-check.log`、`artifacts/shared-final-api.log`、`artifacts/shared-clock-browser.log`、`artifacts/shared-e2e-report.json`、`artifacts/shared-library.png`、`artifacts/shared-readonly.png`、`artifacts/shared-offline-recovery.drawio` 和 `artifacts/shared-readonly-export.pdf`。安装包验证记录为 `artifacts/shared-package-verify.log` 和 `artifacts/local-package-verification.json`。

## 本轮修正

- draw.io 的 `setGraphEnabled(false)` 同时隐藏画布文字；改为保持画布可见并单独禁用编辑行为。
- 浏览器本地版本模块新增公共 UUID 工具后，旧测试只转译单文件无法注入依赖；测试改为打包依赖后执行。
- 候选冲突回归与当前已存在的“图稿已变化”确认界面对齐，验证选择保留当前图稿时不覆盖内容。
- 客户端使用请求开始时间与租约时长换算本地截止时间，避免不同电脑时钟偏差导致误失锁。
- AI 队列执行预算从实际开始执行计时；取消等待任务立即移出队列，长时间等待的活跃任务不会从列表消失。

启动器与安装脚本的 Node 下限统一为本轮实测的 22.22；旧版历史报告中的 22.12 要求不再适用于 v1.2。

## 使用边界

这是共享文件库与单人编辑租约，不做逐笔实时合并。同步采用约 2 秒轮询；断线自动暂停，未同步内容需要恢复或下载。账号角色是工作区级别，所有成员都能查看全部共享图稿；AI 任务仅提交者可见。AI 队列和候选不跨服务重启保留。完整部署、迁移与备份说明见 [局域网共享指南](../LAN_WORKSPACE.md)。
