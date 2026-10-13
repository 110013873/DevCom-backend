import { Body, Get, JsonController, Post, Put, QueryParams, Req } from 'routing-controllers';
import { Request } from 'express';
import { getRepository } from 'common-db-node/dist/db';
import { Subscription } from '../entity/subscription';
import { SubscribeRequest, SubscriptionTokenRequest, UpdateSubscriptionRequest } from '../dto/community';
import { badRequest, notFound, tooManyRequests } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { clientIp, hashToken, validateEmail } from '../component/common/util';
import { enforceRateLimit } from '../component/common/rateLimit';
import { sendEmail } from '../component/service/emailService';
import { buildSubscriptionLinks, confirmEmailHtml, findByToken, newSubscriptionToken } from '../component/service/subscriptionService';

/** 订阅确认 / 退订不需要登录，因此单靠限流挡住枚举式试探 */
const SUBSCRIBE_RATE = { max: 10, windowMs: 60 * 60 * 1000 };
const TOKEN_RATE = { max: 30, windowMs: 10 * 60 * 1000 };

/**
 * 邮件订阅。面向**未登录访客**，因此全部为公开接口，令牌即凭据。
 *
 * 安全约束（与 [[Subscription]] 实体注释配套）：
 * 1. 响应里**绝不回显令牌**，也不回显订阅记录本身 —— 只确认「已发送/已确认」；
 * 2. 订阅接口对同一邮箱幂等：已存在的订阅不重复建行，也不因邮箱已存在而透露其状态；
 * 3. 令牌比对走哈希，明文只在邮件链接里出现一次。
 */
@JsonController('/v1/subscriptions')
export class SubscriptionController {
  /** 订阅。已订阅过则重发确认邮件，不新建记录。 */
  @Post('/')
  async subscribe(@Body({ validate: true }) body: SubscribeRequest, @Req() req: Request) {
    enforceRateLimit(`subscribe:ip:${clientIp(req)}`, SUBSCRIBE_RATE.max, SUBSCRIBE_RATE.windowMs);
    if (!validateEmail(body.email)) {
      throw badRequest(ResponseCode.invalid_request, '邮箱格式不正确');
    }
    const email = body.email.trim().toLowerCase();

    const repository = getRepository(Subscription);
    let subscription = await repository.findOne({ where: { email } });

    let token: string;
    if (subscription) {
      // 已退订 / 被抑制的邮箱再次申请订阅时，重置为 pending 并换发新令牌
      token = newSubscriptionToken();
      subscription.status = subscription.status === 'suppressed' ? 'suppressed' : 'pending';
      subscription.tokenHash = hashToken(token);
      if (body.preferences) {
        subscription.preferences = body.preferences;
      }
      await repository.save(subscription);
    } else {
      token = newSubscriptionToken();
      subscription = repository.create({
        email,
        status: 'pending',
        tokenHash: hashToken(token),
        preferences: body.preferences ?? {},
        confirmedAt: null,
      });
      await repository.save(subscription);
    }

    // 邮件发送失败不回滚记录：用户可以稍后重试，重试会换发新令牌
    const links = buildSubscriptionLinks(token);
    await sendEmail([email], '确认订阅：通明湖 TileLang for RISC-V 社区', confirmEmailHtml(links));

    return { sent: true, email };
  }

  /** 确认订阅。重复确认幂等返回成功。 */
  @Post('/confirm')
  async confirm(@Body({ validate: true }) body: SubscriptionTokenRequest, @Req() req: Request) {
    enforceRateLimit(`subscribe:confirm:${clientIp(req)}`, TOKEN_RATE.max, TOKEN_RATE.windowMs);

    const subscription = await findByToken(body.token);
    if (!subscription) {
      throw notFound(ResponseCode.subscription_token_invalid, '链接无效或已失效');
    }

    if (subscription.status === 'suppressed') {
      throw badRequest(ResponseCode.subscription_exists, '该邮箱已被暂停接收邮件');
    }

    // 已确认过就直接返回成功，避免用户重复点链接看到报错
    if (subscription.status !== 'active') {
      subscription.status = 'active';
      subscription.confirmedAt = new Date();
      await getRepository(Subscription).save(subscription);
    }

    return { confirmed: true, email: subscription.email };
  }

  /** 退订。点击邮件里的退订链接即生效，不做二次确认。 */
  @Post('/unsubscribe')
  async unsubscribe(@Body({ validate: true }) body: SubscriptionTokenRequest, @Req() req: Request) {
    enforceRateLimit(`subscribe:unsubscribe:${clientIp(req)}`, TOKEN_RATE.max, TOKEN_RATE.windowMs);

    const subscription = await findByToken(body.token);
    if (!subscription) {
      throw notFound(ResponseCode.subscription_token_invalid, '链接无效或已失效');
    }

    if (subscription.status !== 'unsubscribed') {
      subscription.status = 'unsubscribed';
      await getRepository(Subscription).save(subscription);
    }

    return { unsubscribed: true, email: subscription.email };
  }

  /** 查看当前订阅偏好（凭令牌，无需登录） */
  @Get('/preferences')
  async preferences(@QueryParams() query: SubscriptionTokenRequest) {
    const subscription = await findByToken(query.token);
    if (!subscription) {
      throw notFound(ResponseCode.subscription_token_invalid, '链接无效或已失效');
    }
    // 不回显 email 之外的任何字段，tokenHash 属内部数据
    return {
      email: subscription.email,
      status: subscription.status,
      preferences: subscription.preferences,
    };
  }

  /** 更新订阅偏好（凭令牌） */
  @Put('/preferences')
  async updatePreferences(@Body({ validate: true }) body: UpdateSubscriptionRequest, @Req() req: Request) {
    enforceRateLimit(`subscribe:prefs:${clientIp(req)}`, TOKEN_RATE.max, TOKEN_RATE.windowMs);

    const subscription = await findByToken(body.token);
    if (!subscription) {
      throw notFound(ResponseCode.subscription_token_invalid, '链接无效或已失效');
    }

    if (body.preferences) {
      subscription.preferences = body.preferences;
      await getRepository(Subscription).save(subscription);
    }

    return { updated: true as const, preferences: subscription.preferences };
  }
}
