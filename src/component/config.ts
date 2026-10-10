import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { DbOptions } from 'common-db-node/dist/db';
import { APPLICATION_NAME, ENV, LOG_LEVEL, PORT } from './common/constant';
import { HttpServerOptions } from './common/http';

// 所有配置来自环境变量（.env 不入库）。此处加载顺序：
// 1) 进程环境变量（生产由容器/PM2 注入，优先级最高）
// 2) 项目根目录 .env（本地开发）
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(key: string, fallback?: string): string {
  const value = ENV[key] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`缺少必需的环境变量 ${key}，请参考 .env.example 配置`);
  }
  return value;
}

function optional(key: string, fallback = ''): string {
  return ENV[key] ?? fallback;
}

function optionalNumber(key: string, fallback: number): number {
  const raw = ENV[key];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`环境变量 ${key} 必须是数字，当前值为 "${raw}"`);
  }
  return parsed;
}

function optionalBoolean(key: string, fallback: boolean): boolean {
  const raw = ENV[key];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  return raw === 'true' || raw === '1';
}

export const config = {
  db: {
    url: required('DB_URL', 'postgresql://postgres:postgres@localhost:5432/devcom'),
    schema: optional('DB_SCHEMA', 'service'),
  },
  token: {
    /** 访问令牌有效期（秒），默认 1 天 */
    expireIn: optionalNumber('TOKEN_EXPIRE_IN', 86400),
  },
  cache: {
    videoClipPath: optional('CACHE_VIDEO_PATH', '/var/devcom/clips/video'),
    audioClipPath: optional('CACHE_AUDIO_PATH', '/var/devcom/clips/audio'),
    imageClipPath: optional('CACHE_IMAGE_PATH', '/var/devcom/clips/image'),
    docPath: optional('CACHE_DOC_PATH', '/var/devcom/clips/docs'),
    uploadTmpPath: optional('CACHE_UPLOAD_TMP_PATH', '/var/devcom/clips/tmp'),
    /** local | oss */
    mode: optional('CACHE_MODE', 'local'),
  },
  aliyun: {
    OSS: {
      region: optional('OSS_REGION'),
      endpoint: optional('OSS_ENDPOINT'),
      secure: optionalBoolean('OSS_SECURE', true),
      bucket: optional('OSS_BUCKET'),
      accessKeyId: optional('OSS_ACCESS_KEY_ID'),
      accessKeySecret: optional('OSS_ACCESS_KEY_SECRET'),
    },
    SMS: {
      accessKeyId: optional('SMS_ACCESS_KEY_ID'),
      accessKeySecret: optional('SMS_ACCESS_KEY_SECRET'),
      endpoint: optional('SMS_ENDPOINT', 'dysmsapi.aliyuncs.com'),
      signName: optional('SMS_SIGN_NAME'),
      templateCode: optional('SMS_TEMPLATE_CODE'),
    },
  },
  email: {
    smtp: {
      host: optional('SMTP_HOST'),
      port: optionalNumber('SMTP_PORT', 465),
      secure: optionalBoolean('SMTP_SECURE', true),
      user: optional('SMTP_USER'),
      pass: optional('SMTP_PASS'),
    },
    from: optional('EMAIL_FROM', 'RISC-V AI 开发者社区 <noreply@tlaic.ac.cn>'),
  },
  site: {
    /** 前台站点地址，用于生成确认/退订链接 */
    frontendUrl: optional('FRONTEND_URL', 'http://localhost:8081'),
  },
};

export const dbOptions: DbOptions = {
  url: config.db.url,
  schema: config.db.schema,
  logging: LOG_LEVEL === 'warn',
  entities: [path.resolve(__dirname, '../entity/*.js')],
  migrations: [path.resolve(__dirname, '../migration/*.js')],
};

/**
 * 读取 RSA 密钥：优先环境变量，回退到 `resource/` 目录下的文件。
 *
 * 两条通道都保留是有原因的：本地开发用文件最省事（密钥不入库，人手一份），
 * 而容器部署时把私钥**烤进镜像**等于把签名能力随镜像分发到每一台拉过它的机器，
 * 一旦镜像被推送到公共仓库就彻底泄漏。生产因此改由容器运行时注入环境变量。
 *
 * 环境变量里的换行常被压成字面量 `\n`（CI 变量、k8s Secret 都会这样），
 * 这里统一还原，避免出现"密钥看起来对、验签就是不过"的排查黑洞。
 */
function readResource(fileName: string, envKey: string): string {
  const fromEnv = ENV[envKey];
  if (fromEnv) {
    return fromEnv.replace(/\\n/g, '\n');
  }

  const filePath = path.resolve(__dirname, `../resource/${fileName}`);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `缺少密钥：环境变量 ${envKey} 未设置，且文件 ${filePath} 不存在。请按 README 生成 RSA 密钥对`
    );
  }
  return fs.readFileSync(filePath, 'utf8');
}

export const privateKey = readResource('private.key', 'JWT_PRIVATE_KEY');
export const publicKey = readResource('public.pem', 'JWT_PUBLIC_KEY');

export async function httpOptions(): Promise<HttpServerOptions> {
  return {
    port: Number(PORT),
    controllers: [path.resolve(__dirname, `../controller/*.js`)],
    publicKey: publicKey,
    application: APPLICATION_NAME,
  };
}
