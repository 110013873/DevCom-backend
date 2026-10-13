# DevCom Backend — TileLang for RISC-V 社区后端

Express + TypeScript + routing-controllers + TypeORM(PostgreSQL)，与 `TLAIC-Portal/portal-backend` 同架构，但**独立账号体系、独立数据库**，不与该官网互通。

- 默认端口 **10100**（官网后端用 10088，两者互不影响）
- API 前缀统一 `/v1`
- 数据库 **`devcom`**，schema **`service`**，与官网 `portal` 库物理隔离

## 环境要求

- Node.js **18.19.0**（`package.json` 的 `engines` 锁定此版本）
- PostgreSQL（本地开发即可；生产见文末 compose）

## 快速开始

```bash
npm ci
cp .env.example .env          # 然后按下节填写
npm run dev                   # build + 以 NODE_ENV=dev 启动，监听 10100
```

首次启动会自动执行迁移，并做一次幂等引导（`bootstrap`）：写入内置角色、初始管理员、法律文书默认内容、系统配置默认值。这些操作重复执行不会产生重复数据。

## 生成 JWT 密钥对（必做）

令牌用 **RS256** 签发/校验。密钥有两种提供方式，**二选一**：

### 方式一：本地文件（开发推荐）

```bash
cd src/resource
openssl genrsa -out private.key 2048
openssl rsa -in private.key -pubout -out public.pem
```

这两个文件已在 `.gitignore` 中，**不要提交**。

### 方式二：环境变量（容器部署推荐）

```
JWT_PRIVATE_KEY=<private.key 的内容>
JWT_PUBLIC_KEY=<public.pem 的内容>
```

容器里不要把私钥烤进镜像 —— 那等于把签发能力随镜像分发到每一台拉过它的机器，镜像一旦推送到公共仓库就彻底泄漏。改由容器运行时注入。

若 CI 变量或 k8s Secret 把换行压成了字面量 `\n`（一整行、不含真实换行），启动时会自动还原，无需手工处理。

> `src/resource/` 目录本身由 `.gitkeep` 保留 —— 构建脚本会 `cp -r src/resource dist`，目录不存在会直接构建失败。

## 环境变量

完整清单见 `.env.example`，此处只列容易踩坑的：

| 变量 | 说明 |
|---|---|
| `DB_URL` | 无默认值兜底到本地 `postgres:postgres@localhost:5432/devcom`，生产**必须**显式设置 |
| `DB_SCHEMA` | 默认 `service` |
| `CACHE_MODE` | `local` 落本地磁盘并由 `/static` 暴露；`oss` 走阿里云 OSS |
| `CACHE_*_PATH` | `CACHE_MODE=local` 时的落盘目录，默认 `/var/devcom/clips/*` |
| `FRONTEND_URL` | 用于生成订阅确认/退订链接，默认 `http://localhost:8081` |
| `OTP_DEV_ECHO` | `true` 时把验证码打到服务端日志。**生产必须关闭** |
| `BOOTSTRAP_ADMIN_*` | 首次部署注入初始管理员，创建后可从 `.env` 移除 |

`config.ts` 用 `dotenv` 但**不覆盖**真实环境变量，因此容器 env 生效时无需烘焙 `.env`。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run build` | 清 dist → `tsc` → 拷贝 `src/resource` |
| `npm start` | 运行构建产物 |
| `npm run dev` | build 后以开发模式启动 |
| `npm run start:dev` | build 后用 nodemon 监听重启 |
| `npm run migration:generate -- src/migration/<名称>` | 依实体变更生成迁移 |
| `npm run migration:run` / `:revert` | 执行 / 回滚迁移 |

实体、控制器、迁移都是**按目录 glob 注册**的（`../entity/*.js` 等），新增文件无需改动注册表。

## 目录结构

```
src/
├── index.ts              # initializeDb → bootstrap → 建缓存目录 → 起 HTTP → 定时任务
├── component/
│   ├── config.ts         # 环境变量 → 配置对象 / dbOptions / httpOptions
│   ├── common/           # http.ts(AppError、角色常量与判定) / util.ts / constant.ts / rateLimit.ts
│   └── service/          # OSS、短信、邮件、存储、验证码等
├── controller/           # @JsonController('/v1/...')
├── entity/               # TypeORM 实体（表名蛇形复数，时间戳列 createTime/updateTime/deleteTime）
├── migration/            # 时间戳命名迁移
└── resource/             # 密钥对（不入库）
```

## 约定

- **分页**：入参 `pageNumber` / `pageSize`（默认 1 / 10，上限 100），返回 `{ total, items }`
- **错误**：抛 `badRequest` / `notFound` / `unauthorized` / `forbidden` / `tooManyRequests`，全局 handler 输出 `{ code, message, data }`；**成功响应不套壳**
- **鉴权**：`@Authorized(角色数组)` + `@CurrentUser()`。角色为累积阶梯 `visitor < member < author < moderator < mentor < ops_admin < sys_admin`
- **路由顺序**：routing-controllers 按**声明顺序**匹配，字面量路径必须写在同控制器的 `/:id` 之前
- **限流**：登录、验证码发送等在进程内滑动窗口限制（`common/rateLimit.ts`）

## 部署

```bash
docker build -t devcom-backend .
docker run -p 10100:10100 \
  -e DB_URL='postgresql://user:pass@host:5432/devcom' \
  -e JWT_PRIVATE_KEY="$(cat private.key)" \
  -e JWT_PUBLIC_KEY="$(cat public.pem)" \
  devcom-backend
```

镜像不含 canvas / sharp 等原生依赖，因此没有 portal-backend 那套 cairo/pango 构建环境。

`CACHE_MODE=local` 时请把 `/var/devcom/clips` 挂成持久卷，或改用 `CACHE_MODE=oss`。

CI 见 `.github/workflows/main.yml`：推送 `main` / `develop` 构建并推送镜像到阿里云 ACR。

## 密钥与配置安全

本工程**不使用**官网 `portal-backend/src/resource/config.json` 那种把 OSS/SMS/邮件密钥硬编码进仓库的做法。所有敏感值只走环境变量，`.env` 不入库。若发现任何密钥曾进入版本历史，应视为已泄漏并轮换。
