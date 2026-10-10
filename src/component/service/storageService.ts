import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { badRequest } from '../common/http';
import { ResponseCode } from '../common/types';
import { getFileExtension } from '../common/util';
import { isOssConfigured, uploadToAliyunOSS } from './aliyunOSS';

/** 允许上传的扩展名白名单，按用途分组。未列入的一律拒绝。 */
export const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif'],
  document: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md'],
  archive: ['.zip', '.tar', '.gz', '.tgz', '.rar', '.7z'],
  video: ['.mp4', '.webm', '.mov'],
  audio: ['.mp3', '.wav', '.ogg'],
};

/** 单文件大小上限（字节） */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export interface StoredFile {
  storageKey: string;
  url: string;
}

function extOf(filename: string): string {
  return getFileExtension(filename).toLowerCase();
}

function assertAllowed(fileName: string, purposes: string[]): void {
  const ext = extOf(fileName);
  const allowed = purposes.flatMap(p => ALLOWED_EXTENSIONS[p] ?? []);
  if (!allowed.includes(ext)) {
    throw badRequest(ResponseCode.unsupported_file_type, `不支持的文件类型 ${ext || '(无扩展名)'}`);
  }
}

function assertSize(size: number): void {
  if (size > MAX_UPLOAD_BYTES) {
    throw badRequest(ResponseCode.file_too_large, `文件大小超过 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 限制`);
  }
}

/**
 * 生成带日期的对象 key，例如 `image/2026/10/08/<uuid>.png`。
 * 用随机文件名而非原始名，避免路径穿越与重名覆盖。
 */
export function buildStorageKey(purpose: string, originalName: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dir = `${purpose}/${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;
  return `${dir}/${crypto.randomUUID()}${extOf(originalName)}`;
}

/**
 * 保存文件。配置了 OSS 则上传 OSS，否则落本地磁盘并由 /static 目录暴露。
 */
export async function storeFile(
  buffer: Buffer,
  originalName: string,
  purpose: string,
  allowedPurposes: string[]
): Promise<StoredFile> {
  assertAllowed(originalName, allowedPurposes);
  assertSize(buffer.length);

  const storageKey = buildStorageKey(purpose, originalName);

  if (config.cache.mode === 'oss' && isOssConfigured()) {
    const url = await uploadToAliyunOSS(storageKey, buffer, 'buffer');
    return { storageKey, url };
  }

  const directory = directoryOf(purpose);
  const absolutePath = path.join(rootDirOf(directory), storageKey);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, buffer);

  // URL 用「目录名」而非 purpose 拼接：`/static/<目录名>` 才是 http.ts 的挂载点。
  // storageKey 首段保持 purpose 不变（OSS 对象键沿用既有形状，不回改）；
  // 本地落盘因此形如 `<docPath>/document/<日期>/<uuid>`，URL 需完整带上该段。
  return { storageKey, url: `/static/${directory}/${storageKey}` };
}

/**
 * purpose → 静态目录名。
 *
 * 这个名字同时决定了 URL 前缀（`/static/<目录名>`）与本地落盘子目录，须与
 * `http.ts` 的挂载一一对应。为什么 `document`/`resource` 落到 `docs`：挂载点
 * 用的是配置项名（`docPath` → `docs`），而 purpose 是业务语义名，两者本就
 * 不同名；此前 URL 直接拿 purpose 拼接，于是 `/static/document/...` 打不到
 * `/static/docs` 上，下载一律 404。
 */
const PURPOSE_DIRECTORY: Record<string, string> = {
  image: 'image',
  avatar: 'image',
  cover: 'image',
  video: 'video',
  audio: 'audio',
  document: 'docs',
  resource: 'docs',
};

function directoryOf(purpose: string): string {
  return PURPOSE_DIRECTORY[purpose] ?? 'docs';
}

/** 静态目录名 → 本地根目录。须与 http.ts 中 `/static/<段>` 的挂载保持一致。 */
function rootDirOf(directory: string): string {
  const map: Record<string, string> = {
    image: config.cache.imageClipPath,
    video: config.cache.videoClipPath,
    audio: config.cache.audioClipPath,
    docs: config.cache.docPath,
  };
  return map[directory] ?? config.cache.docPath;
}
