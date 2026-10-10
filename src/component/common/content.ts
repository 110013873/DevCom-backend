/**
 * 内容互动共用的目标类型。
 *
 * 评论、点赞、收藏都挂在一个 (targetType, targetId) 上，类型集合必须一致 ——
 * 否则「给这条内容点过赞」和「给这条内容评过论」会各自维护一套枚举，慢慢漂移。
 * 集中在此处，实体与服务都从这里引用。
 */

/** 可被评论 / 点赞 / 收藏的内容类型 */
export type ContentTargetType = 'news' | 'resource' | 'article' | 'topic' | 'reply';

export const CONTENT_TARGET_TYPES: readonly ContentTargetType[] = ['news', 'resource', 'article', 'topic', 'reply'];

/** 可被关注的对象类型。关注的是「主体」而非某条内容，故与上者分开 */
export type FollowTargetType = 'user' | 'topic' | 'tag';

export const FOLLOW_TARGET_TYPES: readonly FollowTargetType[] = ['user', 'topic', 'tag'];
