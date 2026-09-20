# v1.6 文件生命周期验证

日期：2026-09-20。测试使用隔离临时数据库和独立浏览器上下文，不在实际文件库创建测试数据。

## 已验证行为

- 空白稿、模板稿和空白页初次选择模板，仅初始化当前标签页；等待自动保存周期、缩放、选中、平移、直接返回均不创建服务器文件。
- 首次内容或名称修改会创建私有文件并出现在全部文件；增加图形后立即返回也会提交修改。主动保存允许保留未经修改的空白或模板。
- 首次保存名称或内容校验失败（400/422）时解除冻结，允许修正后重新保存；无效名称不会创建空文件。
- 首次保存暂时冻结编辑，未确认提交保留在 sessionStorage；模拟服务器已写入但响应丢失，刷新重试后仍只有一份文件。请求按用户隔离，同一请求标识的不同内容被拒绝；失败时可下载当前副本。
- 旧服务器草稿迁移为普通私有文件，保留文档 ID、名称、正文、归属、创建人、更新时间、内容版本、历史记录和回收站状态；不改变原有普通文件的分享范围。
- 所有者可管理和分享；另一成员未经授权看不到文件，直接地址同样拒绝。已授权成员可查看并申请编辑；编辑中的文件禁止列表删除。
- 多浏览器验证单人编辑锁、双向保存同步、持续文字输入、断线接管、历史恢复、撤销分享、回收站恢复和只读导出；浏览器无未捕获异常。

## 实际执行

| 命令 | 结果 |
| --- | --- |
| `npm test` | 76 项通过 |
| `npx tsx --test tests/document-lifecycle.test.ts` | 迁移与重复请求保护 2 项通过；补充不同内容冲突断言后再次通过 |
| `ZHITU_TEST_WORKBENCH="$PWD/artifacts/autosave-workbench" npm run test:library` | 7 组浏览器场景通过（含首次保存校验失败后修正） |
| `ZHITU_TEST_WORKBENCH="$PWD/artifacts/autosave-workbench" npm run test:shared` | 13 组多人协作场景通过 |
| `ZHITU_TEST_WORKBENCH="$PWD/artifacts/autosave-workbench" npm run test:sharing` | 3 组分享权限场景通过 |
| `npm run build` | TypeScript 与 Vite 构建通过 |

原有“新建即草稿、确认发布才入库”的测试断言已同步到新规则；原权限、锁、事务和版本冲突断言保留。

## 当前服务升级

升级前将 SQLite 数据库与原前端备份至 `artifacts/pre-v1.6.0/`。停止旧服务后再次备份数据库，重启服务并读取数据库核对：10 份文档的 ID、名称、正文、归属、创建人、更新时间、回收站状态和全部历史版本一致；1 份旧草稿转为普通私有文件；原普通文件分享权限保持。当前页面和文件列表 API 均返回成功，新前端已加载。

首次保存前的 `/new/:id` 是当前标签页的临时地址，不能用于分享；保存后获得稳定的 `/documents/:id` 地址。正常已有文件的编辑锁与保存流程保持。关闭或清理尚未保存内容的标签页仍可能失去临时内容，需先完成保存或下载副本。

## 推送前整体检查

本次覆盖工作区全部修改、新增文件，以及此前已提交但未推送的架构/个人模板功能。补齐 SECURITY、产品规格、技术规格与发布指南中的旧流程说明，明确本机入口仍免登录授予管理员。审查修复首次保存校验失败后不能修正的问题，删除已不用的草稿标记样式，并把模板回归调整为“选择模板不落库、主动保存后校验持久化及锁冲突”。

执行 `npm run check` 时，构建、76 项单元测试及基础浏览器测试通过，模板阶段因旧按钮与旧保存流程断言中断。修正用例后从 `test:templates` 继续，以下剩余检查全部通过；未把首次失败记录描述为一次完整命令成功。

- `npm run test:templates`、`npm run test:interactions`、`npm run test:capabilities`、`npm run test:images`、`npm run test:enhancements`。
- `npm run test:ai-chat`、`npm run test:product-audit`、`npm run test:product-polish`。
- `npm run test:shared`、`npm run test:share`、`npm run test:library`、`npm run test:sharing`、`npm run test:accounts`。
- 最终 `npm run build`、`npm run docs:check`、`git diff --cached --check` 通过。
- `node scripts/package-share.mjs` 与 `node scripts/verify-local-package.mjs` 通过，独立解压目录可离线安装并启动；没有把本机缓存验证当作全新联网安装。

AI 回归使用模拟 CLI，不代表真实模型服务已验证。远程 CI 结果须在推送后单独检查。实际数据库、日志、安装包、构建产物和测试输出均被忽略；性能测试引起的 fixture 随机 ID 变化已还原，未纳入提交。
