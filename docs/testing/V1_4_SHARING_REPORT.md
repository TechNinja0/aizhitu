# v1.4 分享权限验证报告

日期：2026-09-20。环境：macOS、Node.js 22.22、Chromium，测试数据库均为独立临时目录，未调用真实 AI 模型。

## 范围

- 新建和保存到文件库默认私有，打开分享窗口、复制链接不授权。
- 创建者或本机管理员可选择仅自己、指定成员、所有成员；指定成员按稳定浏览器身份 ID 匹配，同名不继承权限。
- 列表、直接读取、状态、版本、锁、保存和文档 AI 接口服务端鉴权；未授权返回 404。
- 权限更新独立于内容版本；并发旧权限请求被拒绝，错误成员列表整体回滚。
- 收回授权立即清除对方租约，保留仍获授权的创建者租约；在线页面轮询后移除画布和列表条目。
- 旧库迁移默认私有，保留图稿内容、创建人、版本和原文件库状态；重启不重置已保存权限。
- 文件库分享/垃圾桶图标、草稿返回前保存、命名窗口续约、失败重试、批量回收与管理员管理回归。
- HTTP 剪贴板实际复制粘贴、接口拒绝时备用路径、全部失败时手动复制、Esc 焦点恢复。

## 执行记录

前端先构建到 `artifacts/acl-workbench`，用临时服务器的 `workbenchDirectory` 测试，避免测试期间更新运行中的正式页面。浏览器命令前设置 `ZHITU_TEST_WORKBENCH="$PWD/artifacts/acl-workbench"`。

| 命令 | 结果 |
| --- | --- |
| `npx tsx --test tests/shared-workspace.test.ts tests/creator.test.ts tests/drafts.test.ts` | 7 / 7 通过 |
| `npx tsx --test tests/sharing-permissions.test.ts` | 3 / 3 通过 |
| `npm test` | 65 / 65 通过 |
| `npx tsc --noEmit && npx vite build --outDir ../../artifacts/acl-workbench` | 通过 |
| `npm run test:sharing` | 多浏览器身份、同名隔离、显式分享、收回编辑中权限、全员和新成员通过 |
| `npm run test:library` | 草稿、保存仍私有、主动分享、管理、恢复通过 |
| `npm run test:shared` | 多人锁、自动同步、断网冲突保护、历史与回收站恢复、只读导出等 13 项通过 |
| `npm run build` | TypeScript 与生产构建通过 |
| `npm run docs:check` | 106 个本地 Markdown 链接通过 |
| `npm run test:share` | 复制、失败回退、键盘关闭与本机分享 LAN 地址通过 |

验证中修正了权限轮询不应更新本地未同步内容的版本基线，以及回收站恢复后浏览器测试需要等待画布重新挂载。桌面与窄屏分享窗口有截图留存：`artifacts/sharing-selected-members.png`、`artifacts/sharing-mobile.png`。

## 边界

本机管理员始终有访问管理权限。“仅自己”是普通成员间隔离。用户名不是实名认证；跨浏览器和清理站点数据会获得新身份，需要重新授权。撤销无法远程擦除已经下载、截图或缓存的内容。授权成员均可申请单人编辑锁，本版未加入查看/编辑角色细分，也未改为实时多人合并。

## 当前工作区升级

正式服务数据库已备份到 `artifacts/pre-v1.4.0/workspace.sqlite`，停止旧服务后的最终一致备份为 `workspace-final.sqlite`，目录和文件分别限 0700/0600。升级前后对原文档内容、名称、归属、创建人、版本、删除和草稿状态以及所有历史版本计算摘要，结果一致。9 份文件均迁移为 private。正式 HTTP 只读检查确认管理员可读取全部原文件、匿名请求被拒绝、LAN 页面不包含管理员凭据。
