import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post, QueryParams, Req } from 'routing-controllers';
import { Request } from 'express';
import { In, IsNull } from 'typeorm';
import { getRepository } from 'common-db-node/dist/db';
import { Comment } from '../entity/comment';
import { CreateCommentRequest, CommentQuery } from '../dto/content';
import { AuthorizedUser, badRequest, forbidden, notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { isUuid, paginate } from '../component/common/util';
import { ContentTargetType } from '../component/common/content';
import { enforceRateLimit } from '../component/common/rateLimit';
import { assertVisibleTarget, usersBrief } from '../component/service/contentService';
import { isModerator } from '../component/common/http';

/** 同一用户发表评论的最小间隔窗口 */
const COMMENT_RATE = { max: 10, windowMs: 60 * 1000 };

/**
 * 评论接口（新闻评论与资源反馈共用）。
 *
 * 只支持一层楼中楼：主楼 + 回复。再深的嵌套对读、对审核都是负担，
 * 因此在写入时直接拒绝「回复一条回复」。
 */
@JsonController('/v1/comments')
export class CommentController {
  /** 某目标下的评论列表：主楼分页，回复随主楼一并返回 */
  @Get('/')
  async list(@QueryParams() query: CommentQuery) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);

    const [roots, total] = await getRepository(Comment).findAndCount({
      where: {
        targetType: query.targetType as ContentTargetType,
        targetId: query.targetId,
        parentId: IsNull(),
        status: 'published',
      },
      order: { createTime: 'DESC' },
      skip,
      take,
    });

    // 一次取出所有回复，避免每条主楼各查一次（N+1）
    const rootIds = roots.map(row => row.id);
    const replies = rootIds.length
      ? await getRepository(Comment).find({
          where: { parentId: In(rootIds), status: 'published' },
          order: { createTime: 'ASC' },
        })
      : [];

    const authorIds = [...roots, ...replies].map(row => row.userId).filter((id): id is string => Boolean(id));
    const authors = await usersBrief(authorIds);

    const repliesByParent = new Map<string, Comment[]>();
    for (const reply of replies) {
      const list = repliesByParent.get(reply.parentId as string) ?? [];
      list.push(reply);
      repliesByParent.set(reply.parentId as string, list);
    }

    const shape = (comment: Comment) => ({
      id: comment.id,
      content: comment.content,
      status: comment.status,
      likeCount: comment.likeCount,
      createTime: comment.createTime,
      // 用户被删除时 userId 为 null，此处降级为「已注销用户」而不是整条评论消失
      author: comment.userId ? (authors.get(comment.userId) ?? null) : null,
    });

    return {
      total,
      items: roots.map(root => ({
        ...shape(root),
        replies: (repliesByParent.get(root.id) ?? []).map(shape),
      })),
    };
  }

  /** 发表评论 / 资源反馈 */
  @Post('/')
  @Authorized()
  async create(
    @CurrentUser() current: AuthorizedUser,
    @Body({ validate: true }) body: CreateCommentRequest,
    @Req() req: Request
  ) {
    enforceRateLimit(`comment:create:${current.id}`, COMMENT_RATE.max, COMMENT_RATE.windowMs);

    // 目标必须存在且对外可见，否则等于给草稿/隐藏资源挂评论
    await assertVisibleTarget(body.targetType, body.targetId);

    let parentId: string | null = null;
    if (body.parentId) {
      const parent = await getRepository(Comment).findOne({ where: { id: body.parentId } });
      if (!parent) {
        throw notFound(ResponseCode.comment_not_found, '要回复的评论不存在');
      }
      // 父评论必须属于同一目标，且本身是主楼（只允许一层）
      if (parent.targetType !== body.targetType || parent.targetId !== body.targetId) {
        throw badRequest(ResponseCode.comment_forbidden, '回复的评论不属于该内容');
      }
      if (parent.parentId) {
        throw badRequest(ResponseCode.comment_forbidden, '仅支持回复主楼评论');
      }
      parentId = parent.id;
    }

    const repository = getRepository(Comment);
    const comment = repository.create({
      userId: current.id,
      targetType: body.targetType as ContentTargetType,
      targetId: body.targetId,
      parentId,
      content: body.content,
      status: 'published',
      likeCount: 0,
    });
    await repository.save(comment);

    const authors = await usersBrief([current.id]);
    return {
      id: comment.id,
      content: comment.content,
      status: comment.status,
      likeCount: comment.likeCount,
      createTime: comment.createTime,
      author: authors.get(current.id) ?? null,
      replies: [],
    };
  }

  /** 删除评论：本人或版主以上。软删，保留审计痕迹。 */
  @Delete('/:id')
  @Authorized()
  async remove(@CurrentUser() current: AuthorizedUser, @Param('id') id: string): Promise<{ deleted: true }> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.comment_not_found, '评论不存在');
    }
    const repository = getRepository(Comment);
    const comment = await repository.findOne({ where: { id } });
    if (!comment) {
      throw notFound(ResponseCode.comment_not_found, '评论不存在');
    }

    // 越权删除是这里唯一的风险点：非本人且非管理角色一律拒绝
    if (comment.userId !== current.id && !isModerator(current)) {
      throw forbidden(ResponseCode.forbidden_operation, '只能删除自己的评论');
    }

    await repository.softRemove(comment);
    return { deleted: true };
  }
}
