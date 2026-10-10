import { In, IsNull, LessThanOrEqual } from 'typeorm';
import { getRepository } from 'common-db-node/dist/db';
import { News } from '../../entity/news';
import { Resource } from '../../entity/resource';
import { Comment } from '../../entity/comment';
import { Reaction } from '../../entity/reaction';
import { Favorite } from '../../entity/favorite';
import { User } from '../../entity/user';
import { badRequest, notFound } from '../common/http';
import { ContentTargetType } from '../common/content';
import { ResponseCode } from '../common/types';

/** 阶段 A/B 只开放这两种可互动目标；article/topic 属后续阶段 */
const SUPPORTED_TARGETS = ['news', 'resource'] as const;

export interface UserBrief {
  id: string;
  displayName: string;
  avatar: string | null;
}

/**
 * 前台可见性条件。
 *
 * 新闻的可见性由三个字段共同决定（status / isActive / publishedAt），资源是两个
 * （status / isPublic）。凡是从公开接口反查内容的地方 —— 详情、列表、首页推荐位、
 * 收藏列表 —— 都必须带上这一组条件，**少带一个字段就会把草稿或已下线内容泄漏给
 * 匿名访客**。集中在这里定义，避免各处各写一份、日后改了枚举值漏掉某一处。
 *
 * `publishedAt: LessThanOrEqual(now)` 同时排除了 `publishedAt IS NULL` 的记录
 * （SQL 三值逻辑下 NULL 不与任何值比较为真），与 [[newsController]] 列表里的
 * `publishedAt IS NOT NULL` 等价。
 */
export function visibleNewsWhere() {
  return {
    status: 'published' as const,
    isActive: true,
    publishedAt: LessThanOrEqual(new Date()),
  };
}

/** 资源的前台可见性条件，见 [[visibleNewsWhere]] 的说明 */
export function visibleResourceWhere() {
  return {
    status: 'published' as const,
    isPublic: true,
  };
}

/**
 * 校验互动目标存在且对外可见。
 *
 * 这一步不能省：评论/点赞/收藏都只带一个 (targetType, targetId)，若不核对，
 * 任何人都能给「尚未发布的草稿」或「隐藏资源」挂上评论 —— 而这些记录一旦
 * 存在，就可能经由评论区反查出不可见内容的标题等信息。
 */
export async function assertVisibleTarget(targetType: string, targetId: string): Promise<void> {
  if (!(SUPPORTED_TARGETS as readonly string[]).includes(targetType)) {
    throw badRequest(ResponseCode.invalid_request, '暂不支持对该类型内容进行互动');
  }

  if (targetType === 'news') {
    const news = await getRepository(News).findOne({
      where: { id: targetId, ...visibleNewsWhere() },
    });
    if (!news) {
      throw notFound(ResponseCode.news_not_found, '内容不存在或不可见');
    }
    return;
  }

  const resource = await getRepository(Resource).findOne({
    where: { id: targetId, ...visibleResourceWhere() },
  });
  if (!resource) {
    throw notFound(ResponseCode.resource_not_found, '资源不存在或不可见');
  }
}

/** 批量取评论数，避免列表渲染时逐条 count */
export async function commentCounts(targetType: string, targetIds: string[]): Promise<Map<string, number>> {
  const grouped = new Map<string, number>(targetIds.map(id => [id, 0]));
  if (!targetIds.length) {
    return grouped;
  }
  const rows = await getRepository(Comment)
    .createQueryBuilder('comment')
    .select('comment.targetId', 'targetId')
    .addSelect('COUNT(comment.id)', 'count')
    .where('comment.targetType = :targetType', { targetType })
    .andWhere('comment.targetId IN (:...targetIds)', { targetIds })
    .andWhere('comment.status = :status', { status: 'published' })
    .andWhere('comment.deleteTime IS NULL')
    .groupBy('comment.targetId')
    .getRawMany<{ targetId: string; count: string }>();

  for (const row of rows) {
    grouped.set(row.targetId, Number(row.count));
  }
  return grouped;
}

/** 批量取点赞数 */
export async function likeCounts(targetType: string, targetIds: string[]): Promise<Map<string, number>> {
  const grouped = new Map<string, number>(targetIds.map(id => [id, 0]));
  if (!targetIds.length) {
    return grouped;
  }
  const rows = await getRepository(Reaction)
    .createQueryBuilder('reaction')
    .select('reaction.targetId', 'targetId')
    .addSelect('COUNT(reaction.id)', 'count')
    .where('reaction.targetType = :targetType', { targetType })
    .andWhere('reaction.targetId IN (:...targetIds)', { targetIds })
    .groupBy('reaction.targetId')
    .getRawMany<{ targetId: string; count: string }>();

  for (const row of rows) {
    grouped.set(row.targetId, Number(row.count));
  }
  return grouped;
}

export interface InteractionState {
  liked: boolean;
  favorited: boolean;
}

/**
 * 取当前用户对一组目标的点赞/收藏状态。
 * 未登录（userId 为空）时全部按「未操作」返回，不查库。
 */
export async function myInteractionStates(
  userId: string | null,
  targetType: ContentTargetType,
  targetIds: string[]
): Promise<Map<string, InteractionState>> {
  const grouped = new Map<string, InteractionState>(
    targetIds.map(id => [id, { liked: false, favorited: false }])
  );
  if (!userId || !targetIds.length) {
    return grouped;
  }

  const [reactions, favorites] = await Promise.all([
    getRepository(Reaction).find({ where: { userId, targetType, targetId: In(targetIds) }, select: ['targetId'] }),
    getRepository(Favorite).find({ where: { userId, targetType, targetId: In(targetIds) }, select: ['targetId'] }),
  ]);

  for (const row of reactions) {
    const state = grouped.get(row.targetId);
    if (state) {
      state.liked = true;
    }
  }
  for (const row of favorites) {
    const state = grouped.get(row.targetId);
    if (state) {
      state.favorited = true;
    }
  }
  return grouped;
}

/**
 * 批量取用户的公开信息（昵称/头像），供评论列表、公开主页渲染。
 *
 * 刻意不返回 User 实体：它带着 password 哈希与邮箱/手机，任何一处漏选字段
 * 都是一次凭据泄漏。这里只挑出三个可公开列。
 */
export async function usersBrief(ids: string[]): Promise<Map<string, UserBrief>> {
  const grouped = new Map<string, UserBrief>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) {
    return grouped;
  }
  const users = await getRepository(User).find({
    where: { id: In(unique) },
    select: ['id', 'displayName', 'avatar'],
  });
  for (const user of users) {
    grouped.set(user.id, { id: user.id, displayName: user.displayName, avatar: user.avatar });
  }
  return grouped;
}

/** 顶层评论（主楼）的查询条件，供分页使用 */
export function topLevelCommentWhere(targetType: string, targetId: string) {
  return { targetType, targetId, parentId: IsNull(), status: 'published' as const };
}
