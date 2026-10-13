import { getRepository } from 'common-db-node/dist/db';
import { Subscription } from '../../entity/subscription';
import { config } from '../config';
import { generateUrlToken, hashToken } from '../common/util';

export interface SubscriptionLinks {
  confirmUrl: string;
  unsubscribeUrl: string;
}

/**
 * 生成订阅确认 / 退订链接。
 *
 * 链接里的原始令牌**只在生成时存在一次**（进邮件），库中仅存 sha256 摘要，
 * 因此这里没有「重发同一条确认链接」的能力 —— 需要重发就重新生成令牌，
 * 旧链接随之失效。这是有意的：确认链接外泄即等于一次可用的订阅确认。
 */
export function buildSubscriptionLinks(token: string): SubscriptionLinks {
  const base = config.site.frontendUrl.replace(/\/+$/, '');
  const encoded = encodeURIComponent(token);
  return {
    confirmUrl: `${base}/subscriptions/confirm?token=${encoded}`,
    unsubscribeUrl: `${base}/subscriptions/unsubscribe?token=${encoded}`,
  };
}

/** 新建订阅令牌（明文），调用方负责把 hashToken(token) 落库并把明文送进邮件 */
export function newSubscriptionToken(): string {
  return generateUrlToken(32);
}

/** 按明文令牌查订阅；查不到返回 null 而不是抛错，由控制器决定提示文案 */
export async function findByToken(token: string): Promise<Subscription | null> {
  if (!token) {
    return null;
  }
  return getRepository(Subscription).findOne({ where: { tokenHash: hashToken(token) } });
}

/**
 * 订阅确认邮件正文。
 * 邮件内容用中文写死：首期仅中文，不做多语言。
 */
export function confirmEmailHtml(links: SubscriptionLinks): string {
  return [
    '<p>感谢订阅通明湖 TileLang for RISC-V 社区动态。</p>',
    `<p>请点击下面的链接完成确认：</p>`,
    `<p><a href="${links.confirmUrl}">确认订阅</a></p>`,
    `<p>如果这不是您本人的操作，可忽略本邮件；或点击 <a href="${links.unsubscribeUrl}">退订</a>。</p>`,
  ].join('');
}
