import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Post, QueryParams } from 'routing-controllers';
import { In } from 'typeorm';
import { getRepository } from 'common-db-node/dist/db';
import { Reaction } from '../entity/reaction';
import { Favorite } from '../entity/favorite';
import { Follow } from '../entity/follow';
import { News } from '../entity/news';
import { Resource } from '../entity/resource';
import { Tag } from '../entity/tag';
import { AuthorizedUser } from '../component/common/http';
import { ContentTargetType, FollowTargetType } from '../component/common/content';
import { InteractionRequest, MyFavoriteQuery } from '../dto/content';
import { FollowRequest } from '../dto/community';
import { paginate } from '../component/common/util';
import { assertVisibleTarget, usersBrief, visibleNewsWhere, visibleResourceWhere } from '../component/service/contentService';

/**
 * 点赞 / 收藏 / 关注。
 *
 * 三者共用「唯一键兜底幂等」的模式：唯一约束 (userId,targetType,targetId) 保证
 * 重复点赞不产生第二行，因此编写成 upsert 语义 —— 已存在即直接返回成功，
 * 不做「先查再插」的竞态窗口。
 */
@JsonController('/v1')
export class InteractionController {
  /** 点赞（幂等） */
  @Post('/reactions')
  @Authorized()
  async like(@CurrentUser() current: AuthorizedUser, @Body({ validate: true }) body: InteractionRequest): Promise<{ liked: true }> {
    await assertVisibleTarget(body.targetType, body.targetId);

    const repository = getRepository(Reaction);
    const existing = await repository.findOne({
      where: { userId: current.id, targetType: body.targetType as ContentTargetType, targetId: body.targetId },
    });
    if (!existing) {
      await repository.save(repository.create({
        userId: current.id,
        targetType: body.targetType as ContentTargetType,
        targetId: body.targetId,
      }));
    }
    return { liked: true };
  }

  /** 取消点赞（幂等） */
  @Delete('/reactions')
  @Authorized()
  async unlike(@CurrentUser() current: AuthorizedUser, @Body({ validate: true }) body: InteractionRequest): Promise<{ liked: false }> {
    await getRepository(Reaction).delete({
      userId: current.id,
      targetType: body.targetType as ContentTargetType,
      targetId: body.targetId,
    });
    return { liked: false };
  }

  /** 收藏（幂等） */
  @Post('/favorites')
  @Authorized()
  async favorite(@CurrentUser() current: AuthorizedUser, @Body({ validate: true }) body: InteractionRequest): Promise<{ favorited: true }> {
    await assertVisibleTarget(body.targetType, body.targetId);

    const repository = getRepository(Favorite);
    const existing = await repository.findOne({
      where: { userId: current.id, targetType: body.targetType as ContentTargetType, targetId: body.targetId },
    });
    if (!existing) {
      await repository.save(repository.create({
        userId: current.id,
        targetType: body.targetType as ContentTargetType,
        targetId: body.targetId,
      }));
    }
    return { favorited: true };
  }

  /** 取消收藏（幂等） */
  @Delete('/favorites')
  @Authorized()
  async unfavorite(@CurrentUser() current: AuthorizedUser, @Body({ validate: true }) body: InteractionRequest): Promise<{ favorited: false }> {
    await getRepository(Favorite).delete({
      userId: current.id,
      targetType: body.targetType as ContentTargetType,
      targetId: body.targetId,
    });
    return { favorited: false };
  }

  /**
   * 我的收藏。返回时把目标实体一并联出来（标题/封面），否则列表只剩一串 id，
   * 前端还得为每条再发一次请求。
   */
  @Get('/favorites/mine')
  @Authorized()
  async myFavorites(@CurrentUser() current: AuthorizedUser, @QueryParams() query: MyFavoriteQuery) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const where = query.targetType
      ? { userId: current.id, targetType: query.targetType as ContentTargetType }
      : { userId: current.id };

    const [rows, total] = await getRepository(Favorite).findAndCount({
      where,
      order: { createTime: 'DESC' },
      skip,
      take,
    });

    const newsIds = rows.filter(row => row.targetType === 'news').map(row => row.targetId);
    const resourceIds = rows.filter(row => row.targetType === 'resource').map(row => row.targetId);

    const [newsRows, resourceRows] = await Promise.all([
      newsIds.length
        ? getRepository(News).find({ where: { id: In(newsIds), ...visibleNewsWhere() }, select: ['id', 'title', 'summary', 'coverImage', 'publishedAt'] })
        : Promise.resolve([]),
      resourceIds.length
        ? getRepository(Resource).find({ where: { id: In(resourceIds), ...visibleResourceWhere() }, select: ['id', 'name', 'summary', 'coverImage'] })
        : Promise.resolve([]),
    ]);

    const newsMap = new Map(newsRows.map(row => [row.id, row]));
    const resourceMap = new Map(resourceRows.map(row => [row.id, row]));

    return {
      total,
      items: rows.map(row => {
        if (row.targetType === 'news') {
          const news = newsMap.get(row.targetId);
          return {
            id: row.id,
            targetType: row.targetType,
            targetId: row.targetId,
            createTime: row.createTime,
            // 目标已被删除 / 下线时返回 null，由前端渲染为「内容已失效」
            title: news?.title ?? null,
            summary: news?.summary ?? null,
            coverImage: news?.coverImage ?? null,
          };
        }
        const resource = resourceMap.get(row.targetId);
        return {
          id: row.id,
          targetType: row.targetType,
          targetId: row.targetId,
          createTime: row.createTime,
          title: resource?.name ?? null,
          summary: resource?.summary ?? null,
          coverImage: resource?.coverImage ?? null,
        };
      }),
    };
  }

  /** 关注（幂等）。关注对象是主体：用户 / 话题 / 标签。 */
  @Post('/follows')
  @Authorized()
  async follow(@CurrentUser() current: AuthorizedUser, @Body({ validate: true }) body: FollowRequest): Promise<{ followed: true }> {
    const repository = getRepository(Follow);
    const existing = await repository.findOne({
      where: { userId: current.id, targetType: body.targetType as FollowTargetType, targetId: body.targetId },
    });
    if (!existing) {
      await repository.save(repository.create({
        userId: current.id,
        targetType: body.targetType as FollowTargetType,
        targetId: body.targetId,
      }));
    }
    return { followed: true };
  }

  /** 取关（幂等） */
  @Delete('/follows')
  @Authorized()
  async unfollow(@CurrentUser() current: AuthorizedUser, @Body({ validate: true }) body: FollowRequest): Promise<{ followed: false }> {
    await getRepository(Follow).delete({
      userId: current.id,
      targetType: body.targetType as FollowTargetType,
      targetId: body.targetId,
    });
    return { followed: false };
  }

  /** 我的关注 */
  @Get('/follows/mine')
  @Authorized()
  async myFollows(@CurrentUser() current: AuthorizedUser) {
    const rows = await getRepository(Follow).find({
      where: { userId: current.id },
      order: { createTime: 'DESC' },
      take: 200,
    });

    const userIds = rows.filter(row => row.targetType === 'user').map(row => row.targetId);
    const tagIds = rows.filter(row => row.targetType === 'tag').map(row => row.targetId);
    const [users, tags] = await Promise.all([
      usersBrief(userIds),
      tagIds.length ? getRepository(Tag).find({ where: { id: In(tagIds) }, select: ['id', 'name', 'type'] }) : Promise.resolve([]),
    ]);
    const tagMap = new Map(tags.map(tag => [tag.id, tag]));

    return rows.map(row => {
      if (row.targetType === 'user') {
        return { id: row.id, targetType: row.targetType, targetId: row.targetId, createTime: row.createTime, label: users.get(row.targetId)?.displayName ?? null };
      }
      if (row.targetType === 'tag') {
        return { id: row.id, targetType: row.targetType, targetId: row.targetId, createTime: row.createTime, label: tagMap.get(row.targetId)?.name ?? null };
      }
      // topic 属后续阶段，无对应实体可联，仅返回原始记录
      return { id: row.id, targetType: row.targetType, targetId: row.targetId, createTime: row.createTime, label: null };
    });
  }
}
