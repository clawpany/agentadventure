# WorkAdventure Scripting API 与服务端控制调研文档

本文档汇总了关于 WorkAdventure (WA) Scripting API 的实现机制，以及如何通过扩展实现服务端驱动的 Woka (Agent) 移动控制。

## 1. Scripting API 核心定义

WorkAdventure 的脚本能力主要通过 `WA` 全局变量暴露给地图嵌入的 iframe 或外部脚本。

- **核心代码路径**: `play/src/iframe_api.ts`
- **实现机制**:
  - `WA` 全局变量在 `play/src/iframe_api.ts` 中被实例化为 `IframeApi` 类的一个实例。
  - 它通过 `window.postMessage` 与父窗口（WorkAdventure 游戏主界面）通信，或者在 Local Mode 直接调用。

## 2. 移动同步机制剖析

在 WorkAdventure 中，一个角色的移动遵循以下流转过程：

### 客户端发起移动
1. **脚本调用**: 脚本运行 `WA.player.moveTo(x, y)`。
2. **消息分发**: `play` 前端捕获该指令，并通过 WebSocket 向 `pusher` 发送移动消息。
3. **后端透传**: `pusher` 将消息转发给 `back` 服务。

### 后端与广播
1. **Back 处理**: `back/src/Services/SocketManager.ts` 接收到移动同步包，保存位置状态。
2. **广播**: `back` 将移动信息通过广播发送给房间内的所有其他客户端。

### 二次接收与渲染
1. **其他客户端**: 接收到广播消息。
2. **执行**: `RoomConnection.ts` 接收到 `MoveToPositionMessage`。
3. **渲染**: 调用 `GameScene.moveTo()` 驱动 Phaser 引擎中的角色精灵移动。

## 3. 服务端驱动 Woka (Agent) 移动的方案

如果需要实现一个“中心化”的 Agent 控制系统（由一个统一的服务端进程控制多个 Woka），可以采用以下技术路径：

### 方案 A：扩展 gRPC 与 Back 服务（已验证路径）

直接让 WorkAdventure 的后端具备发送“移动指令”的能力，而不是被动等待客户端上报。

1. **协议层 (`messages.proto`)**: 
   - 使用现有的 `MoveToPositionMessage` 结构作为载体。
   - 在 `ServerToClientMessage` 中利用该消息。
2. **Back 层 (`SocketManager.ts`)**: 
   - 实现 `moveAgent(roomId, agentUuid, x, y)` 方法。
   - 通过 `room.getUsersByUuid(agentUuid)` 找到对应的 Agent Socket。
   - 调用 `user.write()` 主动向 Agent 所在的客户端发送 `MoveToPositionMessage`。
3. **接口层 (Pusher)**:
   - 在 `play/src/pusher/controllers` 中新增 HTTP 接口（如 `/api/admin/move-agent`）。
   - 该接口通过 gRPC 调用 Back 的 `moveAgent` RPC。

### 方案 B：无头浏览器集控方案

通过一个无头浏览器运行所有 Agent 的地图脚本。

1. **统一连接**: 无头浏览器加载带有控制脚本的地图。
2. **WebSocket 代理**: 脚本内维护一个与 AI 集控中心的 WS 连接。
3. **指令转换**:
   - AI 发送 `{ agent: "uuid1", action: "moveTo", x: 100, y: 200 }`。
   - 控制脚本识别后，根据参数选择对应的控制上下文（可能需要魔改 `WA` API 使其支持指定 UUID）。

## 4. 关键文件索引

| 功能建议 | 文件路径 | 备注 |
| :--- | :--- | :--- |
| Scripting API 定义 | `play/src/iframe_api.ts` | `WA` 对象的主要入口 |
| 消息同步逻辑 | `play/src/RoomConnection.ts` | 处理来自服务端的 `MoveToPositionMessage` |
| 服务端 Socket 管理 | `back/src/Services/SocketManager.ts` | 负责写入消息到特定 Socket |
| Proto 协议定义 | `messages/protos/messages.proto` | 定义了核心的 `MoveToPositionMessage` |
| Pusher 控制器 | `play/src/pusher/controllers/` | 适合添加管理 API 的地方 |

## 5. 常见问题
- **如何获取 Agent 的 UUID？**: 当 Agent 客户端连接时，其 UUID 由后端生成并返回。可以通过 `WA.player.id` 获取或在 Pusher 层进行映射。
- **权限控制**: 由于涉及到主动控制，务必在 Pusher 层的 HTTP 接口加上 `Authorization: Bearer <ADMIN_API_TOKEN>` 校验。
