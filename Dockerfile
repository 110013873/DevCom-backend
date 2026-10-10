# ─────────────────────────────────────────────────────────────
# 构建阶段
#
# 这里**不**需要 portal-backend 那一长串 canvas 系统依赖
# （cairo/pango/pixman/giflib…）：本工程没有 canvas / sharp，
# 全部依赖都是纯 JS 或预编译包，因此省掉那层原生编译环境。
# ─────────────────────────────────────────────────────────────
FROM node:18.19.0-alpine3.17 AS build

# `common-db-node` 是私有 git 依赖（github:110013873/...），
# alpine 自带的 git 版本较旧，会因 TLS/协议问题克隆失败。
RUN apk add --no-cache git openssh-client

WORKDIR /node-app

COPY package.json package-lock.json ./
RUN npm ci --unsafe-perm=true

COPY tsconfig.json ./
COPY src/ src/
# 构建脚本会 `cp -r src/resource dist`，密钥此时并不存在
# （.dockerignore 已排除），靠 .gitkeep 保证目录存在。
RUN npm run build

# ─────────────────────────────────────────────────────────────
# 运行阶段
# ─────────────────────────────────────────────────────────────
FROM node:18.19.0-alpine3.17

# wget 用于带健康检查的编排探活；不装 curl 以省体积
RUN apk add --no-cache wget

WORKDIR /node-app

COPY --from=build /node-app /node-app

# 本地存储模式下上传的附件落到这里，生产应挂卷或切 OSS（CACHE_MODE=oss）
RUN mkdir -p /var/devcom/clips

EXPOSE 10100

ENV NODE_ENV=production

# JWT 密钥在**运行时**注入，不在此处声明：
#   JWT_PRIVATE_KEY / JWT_PUBLIC_KEY （换行可用字面量 \n）
CMD ["node", "dist/index.js"]
