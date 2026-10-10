import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Put, QueryParams, Req } from 'routing-controllers';
import { Request } from 'express';
import { getRepository } from 'common-db-node/dist/db';
import { Subscription, SubscriptionStatus } from '../entity/subscription';
import { AdminSubscriptionQuery } from '../dto/community';
import { AuthorizedUser, OPS_ADMINS, badRequest, notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { escapeLike, isUuid, paginate } from '../component/common/util';
import { AUDIT_MODULES } from '../component/common/constants';
import { ipOf, recordAudit } from '../component/service/auditService';

const STATUSES: SubscriptionStatus[] = ['pending', 'active', 'unsubscribed', 'suppressed'];

/**
 * 后台订阅管理。
 *
 * 与前台 [[SubscriptionController]] 的关键差别：前台凭令牌办事、响应里绝不回显记录；
 * 后台是运营视角，能看到全部邮箱与其状态，因此**每个入口都必须 `@Authorized(OPS_ADMINS)`**
 * —— 订阅表就是一份邮箱名单，泄漏即等于给外部一份可用的投递清单。
 */
@JsonController('/v1/admin/subscriptions')
export class AdminSubscriptionController {
  /** 订阅列表：按状态 / 邮箱关键词过滤 */
  @Get('/')
  @Authorized(OPS_ADMINS)
  async list(@QueryParams() query: AdminSubscriptionQuery) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);

    const builder = getRepository(Subscription).createQueryBuilder('subscription');
    if (query.status) {
      builder.andWhere('subscription.status = :status', { status: query.status });
    }
    if (query.keyword) {
      builder.andWhere('subscription.email ILIKE :keyword', { keyword: `%${escapeLike(query.keyword)}%` });
    }

    const [rows, total] = await builder
      .orderBy('subscription.createTime', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();

    return {
      total,
      // tokenHash 是内部凭据摘要，任何响应都不出（含后台）
      items: rows.map(row => ({
        id: row.id,
        email: row.email,
        status: row.status,
        preferences: row.preferences,
        confirmedAt: row.confirmedAt,
        createTime: row.createTime,
        updateTime: row.updateTime,
      })),
    };
  }

  /** 各状态计数，后台页头用 */
  @Get('/stats')
  @Authorized(OPS_ADMINS)
  async stats() {
    const rows = await getRepository(Subscription)
      .createQueryBuilder('subscription')
      .select('subscription.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('subscription.status')
      .getRawMany<{ status: SubscriptionStatus; count: string }>();

    // 建全量键，让前端不必对缺失状态做兜底
    const byStatus = STATUSES.reduce<Record<SubscriptionStatus, number>>(
      (acc, status) => ({ ...acc, [status]: 0 }),
      { pending: 0, active: 0, unsubscribed: 0, suppressed: 0 }
    );
    for (const row of rows) {
      byStatus[row.status] = Number(row.count);
    }

    return {
      total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
      byStatus,
    };
  }

  /**
   * 改订阅状态。
   *
   * 用独立接口而非通用 PUT，原因与新闻状态一致：状态是一个字段，运营改状态时
   * 不应该有机会顺带改写邮箱 —— 邮箱一改，这条订阅的确认记录就对不上了。
   */
  @Put('/:id/status')
  @Authorized(OPS_ADMINS)
  async setStatus(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body() body: { status?: SubscriptionStatus },
    @Req() req: Request
  ): Promise<{ updated: true; status: SubscriptionStatus }> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.invalid_request, '订阅记录不存在');
    }
    const status = body?.status;
    if (!status || !STATUSES.includes(status)) {
      throw badRequest(ResponseCode.invalid_request, '未知的订阅状态');
    }

    const repository = getRepository(Subscription);
    const subscription = await repository.findOne({ where: { id } });
    if (!subscription) {
      throw notFound(ResponseCode.invalid_request, '订阅记录不存在');
    }

    subscription.status = status;
    // 由未确认直接置为 active（如线下渠道代确认）时补确认时间，否则名单里
    // 会出现一批「已确认但没有确认时间」的记录，无法核对来源
    if (status === 'active' && !subscription.confirmedAt) {
      subscription.confirmedAt = new Date();
    }
    await repository.save(subscription);

    await recordAudit({
      adminName: current.name,
      action: '修改订阅状态',
      module: AUDIT_MODULES.system,
      targetType: 'subscription',
      targetId: id,
      details: { email: subscription.email, status },
      ip: ipOf(req),
    });

    return { updated: true, status };
  }

  /**
   * 删除订阅记录。
   *
   * 慎用：删掉一行就等于丢掉「这个地址不该再收到邮件」的唯一凭据，
   * 之后同地址重新订阅会从零开始。要停止投递应优先改为 `unsubscribed` 或
   * `suppressed`（后者用于硬退信），删除只用于清理明显无效/测试地址。
   */
  @Delete('/:id')
  @Authorized(OPS_ADMINS)
  async remove(@CurrentUser() current: AuthorizedUser, @Param('id') id: string, @Req() req: Request): Promise<{ deleted: true }> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.invalid_request, '订阅记录不存在');
    }
    const repository = getRepository(Subscription);
    const subscription = await repository.findOne({ where: { id } });
    if (!subscription) {
      throw notFound(ResponseCode.invalid_request, '订阅记录不存在');
    }
    // 订阅表没有软删列：这张表的价值就是「当前有效名单」，留一行墓碑反而要处处过滤
    await repository.remove(subscription);

    await recordAudit({
      adminName: current.name,
      action: '删除订阅记录',
      module: AUDIT_MODULES.system,
      targetType: 'subscription',
      targetId: id,
      details: { email: subscription.email, status: subscription.status },
      ip: ipOf(req),
    });

    return { deleted: true };
  }
}
