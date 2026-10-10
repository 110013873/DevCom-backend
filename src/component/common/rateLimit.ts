import { tooManyRequests } from './http';
import { ResponseCode } from './types';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * 进程内滑动窗口限流。用于验证码发送、评论、下载等易被滥用的接口。
 * 单实例部署够用；多实例部署时应替换为 Redis 实现（接口保持不变）。
 */
const buckets = new Map<string, Bucket>();

/** 定期清理过期桶，避免内存无界增长 */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

/**
 * 计数并判定是否超限。
 * @param key 限流维度，例如 `otp:register:13800138000`
 * @param max 窗口内允许的最大次数
 * @param windowMs 窗口长度（毫秒）
 */
export function enforceRateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  existing.count += 1;
  if (existing.count > max) {
    const seconds = Math.ceil((existing.resetAt - now) / 1000);
    throw tooManyRequests(ResponseCode.rate_limited, `操作过于频繁，请 ${seconds} 秒后再试`);
  }
}

/** 仅测试用：清空所有计数 */
export function resetRateLimits(): void {
  buckets.clear();
}

/** 常用限流策略 */
export const RATE_LIMITS = {
  /** 同一邮箱/手机号发送验证码：10 分钟 5 次 */
  otpSend: { max: 5, windowMs: 10 * 60 * 1000 },
  /** 同一 IP 发送验证码：10 分钟 20 次 */
  otpSendByIp: { max: 20, windowMs: 10 * 60 * 1000 },
  /** 登录尝试：15 分钟 10 次 */
  login: { max: 10, windowMs: 15 * 60 * 1000 },
} as const;
