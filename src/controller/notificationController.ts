import { Authorized, Body, CurrentUser, Get, JsonController, Param, Post, Put, QueryParams } from 'routing-controllers';
import { IsNull } from 'typeorm';
import { getRepository } from 'common-db-node/dist/db';
import { Notification } from '../entity/notification';
import { NotificationPreference } from '../entity/notificationpreference';
import { NotificationQuery, UpdateNotificationPreferenceRequest } from '../dto/community';
import { AuthorizedUser, notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { isUuid, paginate } from '../component/common/util';

/**
 * 站内消息与通知偏好。
 *
 * 全部按 `current.id` 过滤，任何一条查询都不接受外部传入的 userId —— 消息内容
 * 可能包含他人评论的摘要，越权读取等于把别人的互动内容暴露出去。
 */
@JsonController('/v1/notifications')
export class NotificationController {
  /** 消息列表，`unreadOnly=true` 只看未读 */
  @Get('/')
  @Authorized()
  async list(@CurrentUser() current: AuthorizedUser, @QueryParams() query: NotificationQuery) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const unreadOnly = query.unreadOnly === 'true';

    const base = { userId: current.id, ...(unreadOnly ? { readAt: IsNull() } : {}) };
    const [items, total, unread] = await Promise.all([
      getRepository(Notification).find({ where: base, order: { createTime: 'DESC' }, skip, take }),
      getRepository(Notification).count({ where: base }),
      getRepository(Notification).count({ where: { userId: current.id, readAt: IsNull() } }),
    ]);

    return {
      total,
      unread,
      items: items.map(item => ({
        id: item.id,
        type: item.type,
        title: item.title,
        body: item.body,
        linkType: item.linkType,
        linkId: item.linkId,
        readAt: item.readAt,
        createTime: item.createTime,
      })),
    };
  }

  /** 未读数（顶部铃铛轮询用） */
  @Get('/unread-count')
  @Authorized()
  async unreadCount(@CurrentUser() current: AuthorizedUser) {
    const unread = await getRepository(Notification).count({ where: { userId: current.id, readAt: IsNull() } });
    return { unread };
  }

  /** 标记单条已读。重复标记幂等。 */
  @Put('/:id/read')
  @Authorized()
  async markRead(@CurrentUser() current: AuthorizedUser, @Param('id') id: string): Promise<{ updated: true }> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.invalid_request, '消息不存在');
    }
    const repository = getRepository(Notification);
    // where 里带上 userId：否则改一个 id 就能标记别人的消息
    const notification = await repository.findOne({ where: { id, userId: current.id } });
    if (!notification) {
      throw notFound(ResponseCode.invalid_request, '消息不存在');
    }
    if (!notification.readAt) {
      notification.readAt = new Date();
      await repository.save(notification);
    }
    return { updated: true };
  }

  /** 全部标记已读 */
  @Put('/read-all')
  @Authorized()
  async markAllRead(@CurrentUser() current: AuthorizedUser): Promise<{ updated: true; count: number }> {
    const result = await getRepository(Notification)
      .createQueryBuilder()
      .update(Notification)
      .set({ readAt: () => 'now()' })
      .where('userId = :userId', { userId: current.id })
      .andWhere('readAt IS NULL')
      .execute();
    return { updated: true, count: result.affected ?? 0 };
  }

  /** 通知偏好。没有记录时返回默认值，不隐式写库。 */
  @Get('/preferences')
  @Authorized()
  async getPreferences(@CurrentUser() current: AuthorizedUser) {
    const preference = await getRepository(NotificationPreference).findOne({ where: { userId: current.id } });
    return {
      emailEnabled: preference?.emailEnabled ?? false,
      categories: preference?.categories ?? {},
    };
  }

  /** 更新通知偏好，无记录则创建（每位用户一条，唯一约束兜底） */
  @Put('/preferences')
  @Authorized()
  async updatePreferences(
    @CurrentUser() current: AuthorizedUser,
    @Body({ validate: true }) body: UpdateNotificationPreferenceRequest
  ) {
    const repository = getRepository(NotificationPreference);
    let preference = await repository.findOne({ where: { userId: current.id } });

    if (!preference) {
      preference = repository.create({ userId: current.id, emailEnabled: false, categories: {} });
    }
    if (body.emailEnabled !== undefined) {
      preference.emailEnabled = body.emailEnabled;
    }
    if (body.categories !== undefined) {
      preference.categories = body.categories;
    }
    await repository.save(preference);

    return { updated: true as const, emailEnabled: preference.emailEnabled, categories: preference.categories };
  }
}
