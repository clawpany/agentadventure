# WorkAdventure Local 模式硬编码数据调研报告

在未配置 `ADMIN_API_URL` 的情况下，WorkAdventure 进入 "local" 模式。此时，系统使用本地 JSON 文件和模拟服务 (Mock Services) 来替代 Admin API 的功能。

## 1. 静态数据文件 (JSON)

这些文件位于 `play/src/pusher/data/` 目录下，是本地模式的核心数据源：

- **[woka.json](file:///Users/wjx/技术/AI/workadventure/play/src/pusher/data/woka.json)**: 包含所有可选角色的外观定义（Woka）。
- **[companions.json](file:///Users/wjx/技术/AI/workadventure/play/src/pusher/data/companions.json)**: 包含所有可选宠物/伴侣的定义。

## 2. 模拟服务实现 (Mock Services)

对应的逻辑实现在 `play/src/pusher/services/` 中：

### [LocalAdmin.ts](file:///Users/wjx/技术/AI/workadventure/play/src/pusher/services/LocalAdmin.ts)
这是最主要的模拟类，它实现了 `AdminInterface`：
- **应用集成**: 硬编码了 Youtube、Google Drive、Klaxoon、Excalidraw 等第三方应用的元数据。
- **权限模拟**: 默认允许所有用户（或根据环境变量 `MAP_EDITOR_ALLOWED_USERS`）使用地图编辑器。
- **SEO/元标签**: 使用 `MetaTagsDefaultValue` 提供默认的网页元信息。
- **能力声明**: 声明支持 `api/woka/list` 和 `api/companion/list`。

### [LocalWokaService.ts](file:///Users/wjx/技术/AI/workadventure/play/src/pusher/services/LocalWokaService.ts) & [LocalCompanionSevice.ts](file:///Users/wjx/技术/AI/workadventure/play/src/pusher/services/LocalCompanionSevice.ts)
- 负责使用 `require` 加载上述 JSON 数据文件。
- 提供根据 ID 查找详情的方法（`fetchWokaDetails`, `fetchCompanionDetails`）。

### [LocalVerifyDomainService.ts](file:///Users/wjx/技术/AI/workadventure/play/src/pusher/services/verifyDomain/LocalVerifyDomainService.ts)
- 域名校验逻辑：简单比对请求 hostname 是否等于 `PUSHER_URL` 的 hostname。

## 3. 环境变量依赖

在 Local 模式下，许多动态行为通过环境变量控制（详见 `play/src/pusher/enums/EnvironmentVariable.ts`）：
- `DISABLE_ANONYMOUS`: 是否强制登录。
- `ENABLE_CHAT / ENABLE_SAY`: 聊天功能开关。
- `DEFAULT_WOKA_NAME / DEFAULT_WOKA_TEXTURE`: 默认形象配置。

---

*注：若需自定义本地模式下的角色形象，只需修改 `play/src/pusher/data/woka.json` 并确保图片资源路径正确即可。*
