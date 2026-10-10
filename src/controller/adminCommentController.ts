import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Put, QueryParams, Req } from 'routing-controllers';
import { Request } from 'express';
import { getRepository } from 'common-db-node/dist/db';
import { Comment } from '../entity/comment';
import { User } from '../entity/user';
import { AdminCommentQuery, ModerateCommentRequest } from '../dto/content';
import { AuthorizedUser, OPS_ADMINS, notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { escapeLike, isUuid, paginate } from '../component/common/util';
import { AUDIT_MODULES } from '../component/common/constants';
import { ipOf, recordAudit } from '../component/service/auditService';

/**
 * 后台评论与资源反馈审核。
 *
 * 新闻评论与资源反馈共用 [[Comment]] 表，这里不按 targetType 拆成两个接口 ——
 * 审核队列的价值正在于「所有待审内容集中一处」，拆开反而让运营来回切页面。
 */
@JsonController('/v1/admin/comments')
export class AdminCommentController {
  /** 审核队列：默认按时间倒序，可按目标类型 / 状态 / 正文关键词过滤 */
  @Get('/')
  @Authorized(OPS_ADMINS)
  async list(@QueryParams() query: AdminCommentQuery) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);

    const builder = getRepository(Comment).createQueryBuilder('comment')
      // 软删的评论不出现在审核队列里（TypeORM 不会为手动 join 自动加软删条件）
      .leftJoinAndSelect('comment.user', 'user')
      .where('comment.deleteTime IS NULL');

    if (query.targetType) {
      builder.andWhere('comment.targetType = :targetType', { targetType: query.targetType });
    }
    if (query.status) {
      builder.andWhere('comment.status = :status', { status: query.status });
    }
    if (query.keyword) {
      builder.andWhere('comment.content ILIKE :keyword', { keyword: `%${escapeLike(query.keyword)}%` });
    }

    const [rows, total] = await builder
      .orderBy('comment.createTime', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();

    return {
      total,
      items: rows.map(row => ({
        id: row.id,
        targetType: row.targetType,
        targetId: row.targetId,
        parentId: row.parentId,
        content: row.content,
        status: row.status,
        likeCount: row.likeCount,
        createTime: row.createTime,
        // 作者可能已注销（userId 被外键置空），此时只出占位，不出别的用户信息
        userId: row.userId,
        authorName: row.user?.displayName ?? null,
        authorAvatar: row.user?.avatar ?? null,
      })),
    };
  }

  /** 待审数量（后台角标） */
  @Get('/pending-count')
  @Authorized(OPS_ADMINS)
  async pendingCount() {
    const pending = await getRepository(Comment).count({ where: { status: 'pending' } });
    return { pending };
  }

  /**
   * 审核：通过 / 打回待审 / 隐藏。
   *
   * 用独立的审核接口而非通用的 PUT 更新，原因与新闻状态一致：审核只改一个字段，
   * 不应该让运营有机会在审核请求里顺带改写评论正文。
   */
  @Put('/:id/moderate')
  @Authorized(OPS_ADMINS)
  async moderate(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body({ validate: true }) body: ModerateCommentRequest,
    @Req() req: Request
  ): Promise<{ updated: true; status: string }> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.comment_not_found, '评论不存在');
    }
    const repository = getRepository(Comment);
    const comment = await repository.findOne({ where: { id } });
    if (!comment) {
      throw notFound(ResponseCode.comment_not_found, '评论不存在');
    }

    comment.status = body.status;
    await repository.save(comment);

    await recordAudit({
      adminName: current.name,
      action: body.status === 'published' ? '通过评论' : body.status === 'hidden' ? '隐藏评论' : '打回评论待审',
      module: AUDIT_MODULES.news,
      targetType: 'comment',
      targetId: id,
      details: { status: body.status, reason: body.reason ?? null, targetType: comment.targetType, targetId: comment.targetId },
      ip: ipOf(req),
    });

    return { updated: true, status: body.status };
  }

  /** 删除评论。软删，保留痕迹供申诉复查。 */
  @Delete('/:id')
  @Authorized(OPS_ADMINS)
  async remove(@CurrentUser() current: AuthorizedUser, @Param('id') id: string, @Req() req: Request): Promise<{ deleted: true }> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.comment_not_found, '评论不存在');
    }
    const repository = getRepository(Comment);
    const comment = await repository.findOne({ where: { id } });
    if (!comment) {
      throw notFound(ResponseCode.comment_not_found, '评论不存在');
    }
    await repository.softRemove(comment);

    await recordAudit({
      adminName: current.name,
      action: '删除评论',
      module: AUDIT_MODULES.news,
      targetType: 'comment',
      targetId: id,
      details: { targetType: comment.targetType, targetId: comment.targetId },
      ip: ipOf(req),
    });
    return { deleted: true };
  }

  /** 某条评论的作者资料，供审核时判断是否惯犯 */
  @Get('/authors/:userId')
  @Authorized(OPS_ADMINS)
  async authorProfile(@Param('userId') userId: string) {
    if (!isUuid(userId)) {
      throw notFound(ResponseCode.user_not_exist, '用户不存在');
    }
    const user = await getRepository(User).findOne({
      where: { id: userId },
      select: ['id', 'displayName', 'avatar', 'status', 'createTime'],
    });
    if (!user) {
      throw notFound(ResponseCode.user_not_exist, '用户不存在');
    }
    const [total, hidden] = await Promise.all([
      getRepository(Comment).count({ where: { userId } }),
      getRepository(Comment).count({ where: { userId, status: 'hidden' } }),
    ]);
    return { ...user, commentTotal: total, commentHidden: hidden };
  }
}
