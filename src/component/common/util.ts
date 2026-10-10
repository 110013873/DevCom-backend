import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import { config, privateKey } from '../config';
import { JwtPayload } from './http';
import { User } from '../../entity/user';

/** 签发访问令牌（RS256）。角色直接取用户已授予的角色 code。 */
export function generateToken(user: User, roles: string[]): string {
  const payload: JwtPayload = {
    sub: user.id,
    name: user.displayName,
    exp: Math.trunc(Date.now() / 1000) + config.token.expireIn,
    roles,
    isActive: user.status === 'active',
  };
  return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
}

export async function asyncFilter<T>(array: T[], filter: (item: T) => Promise<boolean>): Promise<T[]> {
  const results = await Promise.all(array.map(filter));
  return array.filter((item, index) => results[index]);
}

export async function verify(password: string, hash: string): Promise<boolean> {
  if (!password) {
    return !hash;
  }
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(':');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(key === derivedKey.toString('hex'));
    });
  });
}

export async function hash(password: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // 随机 16 字节盐
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(salt + ':' + derivedKey.toString('hex'));
    });
  });
}

const PASSWORD_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function randomPassword(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += PASSWORD_CHARS.charAt(Math.trunc(Math.random() * PASSWORD_CHARS.length));
  }
  return result;
}

export function toArray(str: string): string[] {
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

export function isPagination(query: { pageNumber?: string; pageSize?: string }): query is { pageNumber: string; pageSize: string } {
  return !!(query.pageNumber && query.pageSize);
}

/** 分页参数上限，防止 pageSize=999999 拖垮数据库 */
export const MAX_PAGE_SIZE = 100;

export function paginate(pageNumber?: string, pageSize?: string): { take: number; skip: number } {
  const size = Math.min(Math.max(Number(pageSize) || 10, 1), MAX_PAGE_SIZE);
  const page = Math.max(Number(pageNumber) || 1, 1);
  return { take: size, skip: (page - 1) * size };
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function notNull<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error(`value should not be empty`);
  }
  return value;
}

export function validateEmail(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
}

export function isValidPhoneNumber(phoneNumber: string | null | undefined): boolean {
  if (!phoneNumber) {
    return false;
  }
  // 中国大陆手机号
  return /^1[3-9]\d{9}$/.test(phoneNumber);
}

export function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 生成 URL 安全的随机令牌（用于订阅确认 / 邮箱验证链接） */
export function generateUrlToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** 令牌不可逆存储：库中只保存 sha256 摘要 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * 生成带 slug 的友好标识。中文标题退化为空时需要调用方兜底（例如用 uuid 前缀）。
 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/**
 * 校验路径/参数中的 uuid。不校验直接查库会把 Postgres 的原始类型错误抛成 500，
 * 并且会把数据库报错文本泄漏给调用方，因此所有按 id 取单条记录的入口都应先过这一层。
 */
export function isUuid(value: string | undefined | null): boolean {
  if (!value) {
    return false;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * 转义 LIKE / ILIKE 模式中的通配符，避免用户输入的 `%` `_` 变成通配。
 * 调用方仍需自行补上首尾 `%`；此处不动普通字符。
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, ch => `\\${ch}`);
}

export function generateSmsCode(): string {
  const digits = '0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += digits[Math.floor(Math.random() * digits.length)];
  }
  return code;
}

export function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index > -1 ? fileName.substring(index) : '';
}

export function createCacheDir(targetPath: string): void {
  fs.mkdirSync(targetPath, { recursive: true });
}

export function deleteLocalFile(filePath: string): Promise<void> {
  return new Promise((resolve) => {
    const absolutePath = path.resolve(filePath);

    fs.access(absolutePath, fs.constants.F_OK, (err) => {
      if (err) {
        console.log(`[deleteLocalFile]文件不存在: ${absolutePath}`);
        resolve();
        return;
      }

      fs.unlink(absolutePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error(`[deleteLocalFile]删除文件失败: ${unlinkErr.message}`);
        }
        resolve();
      });
    });
  });
}

export async function downloadFile(url: string, destination?: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const filename = crypto.randomUUID() + path.parse(url).ext;
  const localFilePath = destination || path.join(tmpDir, filename);

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });

  const writer = fs.createWriteStream(localFilePath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(localFilePath));
    writer.on('error', reject);
  });
}

export function getCurrentTime(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

export function formatDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function isNull<T>(value: T | null | undefined): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * 从请求中提取客户端 IP（信任代理已开启，优先取 x-forwarded-for 首段）
 */
export function clientIp(req: { headers: Record<string, unknown>; ip?: string; socket?: { remoteAddress?: string } }): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
}
