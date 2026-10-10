import { config } from '../config';

const aliyunOSS = require('ali-oss');

// 公网访问 host：签名 URL 必须用公网域名（内网 -internal 域名浏览器访问不到）。
const OSS_PUBLIC_HOST = `https://${config.aliyun.OSS.bucket}.${config.aliyun.OSS.region}.aliyuncs.com`;

// 大文件（如视频）上传相关常量
const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 超过 100MB 使用分片上传
const MULTIPART_PART_SIZE = 5 * 1024 * 1024;   // 单分片 5MB（5GB / 5MB = 1000 片，未超 OSS 10000 片上限）
const MULTIPART_PARALLEL = 4;                  // 分片并发数
const CLIENT_TIMEOUT = 600000;                 // 单请求超时兜底 10 分钟（默认仅 60s，大文件必超时）

/**
 * 未配置 OSS 凭证时（本地开发）调用方应退化为本地存储，
 * 这里只负责在配置了凭证时构造客户端。
 */
export function isOssConfigured(): boolean {
  const oss = config.aliyun.OSS;
  return Boolean(oss.accessKeyId && oss.accessKeySecret && oss.bucket && (oss.region || oss.endpoint));
}

const ossClientOptions: Record<string, unknown> = {
  accessKeyId: config.aliyun.OSS.accessKeyId,
  accessKeySecret: config.aliyun.OSS.accessKeySecret,
  bucket: config.aliyun.OSS.bucket,
  timeout: CLIENT_TIMEOUT,
};
if (config.aliyun.OSS.endpoint) {
  ossClientOptions.endpoint = config.aliyun.OSS.endpoint;
} else {
  ossClientOptions.region = config.aliyun.OSS.region;
}
ossClientOptions.secure = config.aliyun.OSS.secure;

let client: unknown;
function ossClient(): { put: Function; delete: Function; signatureUrl: Function; multipartUpload: Function } {
  if (!client) {
    if (!isOssConfigured()) {
      throw new Error('OSS 未配置：请设置 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET');
    }
    client = new aliyunOSS(ossClientOptions);
  }
  return client as { put: Function; delete: Function; signatureUrl: Function; multipartUpload: Function };
}

export async function uploadToAliyunOSS(
  ossFileName: string,
  content: string | Buffer,
  inputType: 'file' | 'buffer'
): Promise<string> {
  const oss = ossClient();

  try {
    // 1️⃣ 本地文件路径：大文件走分片上传（multipartUpload），小文件走简单上传（put）
    if (inputType === 'file') {
      const filePath = content as string;
      const fs = await import('fs');
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const { size } = fs.statSync(filePath);
      if (size > MULTIPART_THRESHOLD) {
        await oss.multipartUpload(ossFileName, filePath, {
          partSize: MULTIPART_PART_SIZE,
          parallel: MULTIPART_PARALLEL,
          timeout: CLIENT_TIMEOUT,
          progress: (percent: number) => {
            console.log(`⏫ OSS multipart upload ${ossFileName}: ${(percent * 100).toFixed(1)}%`);
          },
        });
      } else {
        await oss.put(ossFileName, fs.createReadStream(filePath));
      }
    } else {
      // 2️⃣ Buffer / Base64 数据
      let buffer: Buffer;
      if (typeof content === 'string') {
        const base64Data = content.replace(/^data:.*;base64,/, '');
        buffer = Buffer.from(base64Data, 'base64');
      } else {
        buffer = content;
      }
      await oss.put(ossFileName, buffer);
    }

    // 生成长期可访问的签名 URL。
    // 注意：client 配置了内网 endpoint 时，signatureUrl 会生成 -internal 内网域名，
    // 浏览器访问不到，必须把 host 替换为公网域名。
    const signedUrl: string = oss.signatureUrl(ossFileName, {
      expires: 60 * 60 * 24 * 365 * 10, // 10年
    });
    const parsed = new URL(signedUrl);
    return `${OSS_PUBLIC_HOST}${parsed.pathname}${parsed.search}`;
  } catch (err) {
    console.error('❌ Error uploading to Aliyun OSS:', err);
    throw err;
  }
}

export async function deleteFromAliyunOSS(ossFileName: string): Promise<void> {
  try {
    await ossClient().delete(ossFileName);
  } catch (err) {
    console.error('Error deleting file from aliyun OSS:', err);
  }
}

/**
 * 从 OSS 文件的 URL 中提取 object key（域名后面到问号前面的内容）。
 */
export function extractOssObjectId(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    let path = parsedUrl.pathname;
    if (path.startsWith('/')) {
      path = path.substring(1);
    }
    return path || null;
  } catch (error) {
    console.error('解析 URL 失败:', error);
    return null;
  }
}

export async function deleteFromAliyunOSSByUrl(url: string): Promise<void> {
  const ossFileName = extractOssObjectId(url);
  if (!ossFileName) {
    console.warn('[oss] 无法从 URL 解析出 object key，跳过删除:', url);
    return;
  }
  await deleteFromAliyunOSS(ossFileName);
}
