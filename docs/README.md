# AI智图 · 文档入口

当前版本 1.6.0，更新于 2026-09-20。产品与技术文档已按现有实现整理。

| 文档 | 用途 |
| --- | --- |
| [多人协同技术方案](design/COLLABORATION.md) | 对象属性合并、协议、事务、撤销、断线与容量边界 |
| [多人协同验证](testing/COLLABORATION_REPORT.md) | 双账号并发、幂等、在途修改、断线、撤权及回归结果 |
| [账号与用户管理](ACCOUNTS.md) | 固定账号、旧身份升级、密码恢复、停用、图稿转移及 HTTPS |
| [v1.5 账号验证](testing/V1_5_ACCOUNTS_REPORT.md) | 账号迁移、管理员操作、多浏览器和 HTTPS 自测 |
| [v1.4 分享权限验证](testing/V1_4_SHARING_REPORT.md) | 默认私有、指定成员、直接链接鉴权、收回权限与多人回归 |
| [v1.6 自动保存与文件库验证](testing/V1_6_AUTOSAVE_REPORT.md) | 未修改不落库、修改自动保存、失败重试、旧草稿迁移与权限回归 |
| [v1.3 草稿与管理验证](testing/V1_3_LIBRARY_REPORT.md) | 草稿隔离、发布、列表管理、批量事务、管理员和多人回归 |
| [局域网共享指南](LAN_WORKSPACE.md) | 部署、账号登录、文件库、编辑锁、自动同步、备份和恢复 |
| [v1.2.1 身份简化验证](testing/V1_2_1_IDENTITY_REPORT.md) | 用户名入口、身份持久化、迁移、管理权限和多人回归 |
| [v1.2 共享验证](testing/V1_2_SHARED_REPORT.md) | 多账号、多标签页、断线、竞争保存和回归验证 |
| [使用指南](USAGE.md) | 启动、手工绘图、主题颜色、AI 会话、候选预览、保存导出和故障排查 |
| [产品规格](product/PRD.md) | 当前能力、流程、验收与不支持范围 |
| [技术设计](design/TECHNICAL_DESIGN.md) | 架构、身份比较、候选事务、编辑、存储及资源限制 |
| [本地 AI](LOCAL_AI.md) | CLI 配置、模型、状态与分享 |
| [IDE Agent 绘图 Skill 接入](../packages/ai-support/INSTALL.md) | 对外项目架构图 Skill 与工作台配套截图／改稿 Skill 的区别、安装与调用 |
| [CLI 详细设计](design/LOCAL_AI_DESIGN.md) | Provider 参数、HTTP 接口和任务生命周期 |
| [v1.1 验收报告](testing/V1_1_REPORT.md) | 本轮命令结果、功能矩阵、实际模型与适用边界 |
| [更新记录](../CHANGELOG.md) | 版本变化 |
| [发布指南](RELEASING.md) | 打包、独立安装验证、源码和许可证要求 |
| [贡献指南](../CONTRIBUTING.md) | 开发与回归要求 |
| [安全说明](../SECURITY.md) | 本地数据、客户端与候选保护 |

[竞品分析](product/COMPETITIVE_REVIEW.md)、[功能重整](product/ROADMAP_REVIEW.md)、[P0 报告](testing/REPORT.md)、[早期会话报告](testing/LOCAL_AI_REPORT.md)、[上一轮会话交互报告](testing/CHAT_REDESIGN_REPORT.md)保留为历史记录，不覆盖当前规格和最新验收。

- [P0 产品规格](product/P0_QUALITY_REVIEW_HISTORY.md)：智能排版与交付检查、可视化改稿审阅、持久会话及压力测试验收标准。
