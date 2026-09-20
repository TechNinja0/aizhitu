# v1.5 账号与用户管理验证

日期：2026-09-20。环境为 macOS、Node.js 22.22、Chromium；使用临时数据库和模拟账号，未调用真实 AI 模型。

## 覆盖范围

- 唯一且不区分大小写的登录名，同名显示姓名不合并身份；仅姓名的旧 HTTP 入口不能注册或认领账号。
- 原浏览器补设账号保持用户 ID、文件、个人模板归属和分享；凭证丢失时可由本机管理员为原身份签发密码设置凭证。
- 跨浏览器密码登录、30 天记住登录、一天临时会话及重启持久化；会话到期后重新登录仍为原用户。
- 密码为随机盐 scrypt；数据库与审计不存明文密码、会话 token 或重置凭证。
- 管理员创建账号、15 分钟一次性设置凭证、失效和重复使用拒绝；并发重复注册及同时兑换只有一个成功。
- 重置密码、修改密码和停用撤销旧会话及编辑锁；普通成员不能调用管理接口，也不能通过请求中的 admin 字段提权。
- 图稿转移要求来源停用、目标已设置账号并启用、全部图稿无锁；原子处理，保留内容、原创建人和历史，收回原分享。
- 用户删除要求已停用且没有图稿或个人模板，保留登录名占用与身份记录；旧版本管理操作拒绝覆盖。
- 登录与密码操作限流；HTTPS 工作台、HTTPS 画布和本机受限渲染 PDF。

## 已执行检查

前端先构建到 `artifacts/accounts-workbench`，用临时服务器的 `workbenchDirectory` 进行浏览器测试，避免覆盖正在使用的页面。浏览器测试使用 `ZHITU_TEST_WORKBENCH="$PWD/artifacts/accounts-workbench"`。

| 命令 | 结果 |
| --- | --- |
| `npx tsx --test tests/accounts.test.ts` | 6 项通过（含个人模板历史身份恢复） |
| `npm test` | 74 项通过 |
| `npx tsc --noEmit && npx vite build --outDir ../../artifacts/accounts-workbench` | 类型检查与生产前端构建通过 |
| `npx tsx tests/accounts-tls-e2e.ts` | HTTPS 注册登录、画布、PDF 导出与本机用户管理通过 |
| `npx tsx tests/accounts-e2e.ts` | 旧身份补设、关闭后恢复、管理创建/重置、用户改密、停用、转移、删除和普通成员隔离通过 |
| `npx tsx --test tests/accounts.test.ts tests/sharing-permissions.test.ts` | 最终定向 8 项通过 |
| `npm run test:accounts` | 账号管理与 HTTPS 两组浏览器自测通过 |
| `npm run build` | 正式 TypeScript 检查与构建通过 |
| `npm run test:library` | 草稿、私有保存、分享、批量管理与恢复通过 |
| `npm run test:share` | HTTP 复制与失败回退通过 |
| `npm run docs:check` | 115 个本地链接目标通过 |
| `npm run test:sharing` | 分享隔离、指定用户、收回权限与列表更新通过 |
| `npm run test:shared` | 多用户编辑锁、断线接管、冲突保护、历史恢复、导出及浏览器异常检查通过 |

HTTPS 验证仅在测试浏览器上下文临时接受生成的证书；没有写入系统钥匙串或改变任何用户浏览器的信任设置。

## 交付边界

未提供证书时继续保留现有 HTTP 地址，不能声称传输已经加密。已实现 `--tls-cert` 和 `--tls-key`，真实启用步骤见 [账号指南](../ACCOUNTS.md)。个人模板保留在原账号，不随图稿转移；存在个人模板的账号不得删除，可保持停用。撤销后服务端立即拒绝请求，在线页面会在最长约 10 秒的会话轮询后返回登录；无法擦除对方此前下载或缓存的数据。

## 正式工作区升级

已在 `artifacts/pre-v1.5.0` 备份工作区与模板 SQLite，另有停止服务后的 `final-workspace.sqlite`、`final-templates.sqlite` 一致备份；备份目录 0700、数据库文件 0600。迁移前后对全部文档、历史版本、分享成员和个人模板计算摘要，结果一致。9 份图稿与 3 个原有身份保留，原身份需要本人补设固定账号。

正式浏览器只读检查通过：本机 `/admin/users` 显示 3 个旧身份，LAN 地址显示固定账号登录入口。没有在真实数据中创建测试用户、修改密码、停用或转移任何真实文件。
