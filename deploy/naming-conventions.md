# BitWorld 命名规范

## 对外命名（统一使用 bitworld）

| 组件 | 命名 | 说明 |
|------|------|------|
| GitHub 仓库 | `Hans010101/bitworld-paperclip` | 私有仓库 |
| Docker 镜像 | `bitworld-server` | Cloud Run 使用 |
| Cloud Run 服务 | `bitworld` | 对外服务名 |
| Supabase 项目 | `bitworld-production` | 云端数据库 |
| GCS Bucket | `bitworld-output` | 如需对象存储 |
| 本地目录 | `/Users/hans.pan/bitworld` | 开发环境 |
| 工作空间 | `/Users/hans.pan/bitworld-workspace` | Agent 工作目录 |
| TG Bot 名 | BitWorld 董秘 Bot | Telegram 机器人 |
| 域名（预留） | `bitworld.ai` / `bitworld.dev` | 未来使用 |

## 内部命名（保持 paperclip，不修改）

| 组件 | 命名 | 原因 |
|------|------|------|
| npm 包名 | `@paperclipai/*` | 框架内部依赖，改了会崩 |
| import 路径 | `@paperclipai/db`, `@paperclipai/shared` | 同上 |
| 嵌入式 PG | `postgres://paperclip:paperclip@.../paperclip` | 数据文件绑定，改会丢数据 |
| 框架 API 前缀 | `/api/...` | 无 paperclip 暴露 |
| 环境变量前缀 | `PAPERCLIP_*` | 框架约定，改需全局搜索 |

## 原则

1. **用户可见**的地方统一用 `bitworld`
2. **代码内部**的框架引用保持 `paperclip`，避免引入不必要的风险
3. **云端部署**全部使用 `bitworld` 命名，与本地框架名解耦
