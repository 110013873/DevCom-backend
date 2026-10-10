import { Authorized, Body, CurrentUser, Get, JsonController, Param, Post, QueryParams, Req } from 'routing-controllers';
import { Request } from 'express';
import { In, IsNull } from 'typeorm';
import { getRepository } from 'common-db-node/dist/db';
import { Resource } from '../entity/resource';
import { ResourceVersion } from '../entity/resourceversion';
import { ResourceFile } from '../entity/resourcefile';
import { ResourceRating } from '../entity/resourcerating';
import { Comment } from '../entity/comment';
import { ResourceQuery } from '../dto/resource';
import { CreateFeedbackRequest, RateResourceRequest } from '../dto/content';
import { AuthorizedUser, badRequest, notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { clientIp, escapeLike, isUuid, paginate } from '../component/common/util';
import { SORTABLE_FIELDS } from '../component/common/constants';
import { enforceRateLimit } from '../component/common/rateLimit';
import { idsWithTag, resolveTagIds, tagsOfResource } from '../component/service/tagService';
import { commentCounts, likeCounts, myInteractionStates } from '../component/service/contentService';
import { optionalUserId } from '../component/service/authContext';
import { numericToNumber, recordDownload, resolveDownloadTarget, upsertRating } from '../component/service/resourceService';

const DOWNLOAD_RATE = { max: 30, windowMs: 10 * 60 * 1000 };

/**
 * 资源接口。
 *
 * 可见性是本控制器的核心约束：列表 / 详情 / 搜索一律只出 `status=published`
 * 且 `isPublic=true` 的资源；隐藏资源仅管理员在后台可见（见 [[Resource]] 注释）。
 * 下载走鉴权接口，不把 OSS 地址直接暴露在列表里。
 */
@JsonController('/v1/resources')
export class ResourceController {
  /** 资源列表：分类 / 标签 / 推荐 / 免费 / 关键词 / 排序 / 分页 */
  @Get('/')
  async list(@QueryParams() query: ResourceQuery, @Req() req: Request) {
    const userId = optionalUserId(req);
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const sortField = SORTABLE_FIELDS.resource.includes(query.sort ?? '') ? (query.sort as string) : 'createTime';
    const order: 'ASC' | 'DESC' = query.order === 'ASC' ? 'ASC' : 'DESC';

    const builder = getRepository(Resource).createQueryBuilder('resource')
      .where('resource.status = :status', { status: 'published' })
      .andWhere('resource.isPublic = true');

    if (query.category) {
      builder.andWhere('resource.category = :category', { category: query.category });
    }
    if (query.recommended === 'true') {
      builder.andWhere('resource.isRecommended = true');
    }
    if (query.free === 'true') {
      builder.andWhere('resource.isFree = true');
    }
    if (query.keyword) {
      const keyword = `%${escapeLike(query.keyword)}%`;
      builder.andWhere('(resource.name ILIKE :keyword OR resource.summary ILIKE :keyword)', { keyword });
    }
    if (query.tag) {
      const tagIds = await resolveTagIds(query.tag, 'resource');
      const resourceIds = await idsWithTag(tagIds, 'resource');
      if (!resourceIds.length) {
        return { total: 0, items: [] };
      }
      builder.andWhere('resource.id IN (:...resourceIds)', { resourceIds });
    }

    const [rows, total] = await builder
      .orderBy(`resource.${sortField}`, order)
      .skip(skip)
      .take(take)
      .getManyAndCount();

    const ids = rows.map(row => row.id);
    const [tags, likes, comments, states] = await Promise.all([
      tagsOfResource(ids),
      likeCounts('resource', ids),
      commentCounts('resource', ids),
      myInteractionStates(userId, 'resource', ids),
    ]);

    return {
      total,
      items: rows.map(row => ({
        id: row.id,
        name: row.name,
        summary: row.summary,
        coverImage: row.coverImage,
        category: row.category,
        author: row.author,
        isRecommended: row.isRecommended,
        isFree: row.isFree,
        supportedArch: row.supportedArch,
        downloadCount: row.downloadCount,
        ratingAvg: numericToNumber(row.ratingAvg),
        ratingCount: row.ratingCount,
        likeCount: likes.get(row.id) ?? 0,
        commentCount: comments.get(row.id) ?? 0,
        liked: states.get(row.id)?.liked ?? false,
        favorited: states.get(row.id)?.favorited ?? false,
        tags: tags.get(row.id) ?? [],
      })),
    };
  }

  /** 资源详情，含版本列表与各版本的文件 */
  @Get('/:id')
  async detail(@Param('id') id: string, @Req() req: Request) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }
    const userId = optionalUserId(req);

    const resource = await getRepository(Resource).findOne({
      where: { id, status: 'published', isPublic: true },
    });
    if (!resource) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }

    const versions = await getRepository(ResourceVersion).find({
      where: { resourceId: id, status: 'published' },
      order: { createTime: 'DESC' },
    });
    const versionIds = versions.map(version => version.id);
    const files = versionIds.length
      ? await getRepository(ResourceFile).find({ where: { versionId: In(versionIds) }, order: { updateTime: 'ASC' } })
      : [];

    // 列表里不下发 storageKey（OSS 对象键），它只用于服务端拉取文件
    const filesByVersion = new Map<string, Array<Omit<ResourceFile, 'storageKey'>>>();
    for (const file of files) {
      const { storageKey: _storageKey, ...safe } = file;
      const list = filesByVersion.get(file.versionId) ?? [];
      list.push(safe);
      filesByVersion.set(file.versionId, list);
    }

    const [tags, likes, comments, states, myRating] = await Promise.all([
      tagsOfResource([id]),
      likeCounts('resource', [id]),
      commentCounts('resource', [id]),
      myInteractionStates(userId, 'resource', [id]),
      userId
        ? getRepository(ResourceRating).findOne({ where: { resourceId: id, userId }, select: ['id', 'score'] })
        : Promise.resolve(null),
    ]);

    return {
      id: resource.id,
      name: resource.name,
      summary: resource.summary,
      coverImage: resource.coverImage,
      category: resource.category,
      author: resource.author,
      isFree: resource.isFree,
      supportedArch: resource.supportedArch,
      overview: resource.overview,
      keyFeatures: resource.keyFeatures,
      quickStart: resource.quickStart,
      systemRequirements: resource.systemRequirements,
      downloadCount: resource.downloadCount,
      ratingAvg: numericToNumber(resource.ratingAvg),
      ratingCount: resource.ratingCount,
      myScore: myRating?.score ?? null,
      updateTime: resource.updateTime,
      tags: tags.get(id) ?? [],
      likeCount: likes.get(id) ?? 0,
      commentCount: comments.get(id) ?? 0,
      liked: states.get(id)?.liked ?? false,
      favorited: states.get(id)?.favorited ?? false,
      versions: versions.map(version => ({
        id: version.id,
        version: version.version,
        name: version.name,
        description: version.description,
        changelog: version.changelog,
        isDefault: version.isDefault,
        giteeUrl: version.giteeUrl,
        githubUrl: version.githubUrl,
        createTime: version.createTime,
        files: filesByVersion.get(version.id) ?? [],
      })),
    };
  }

  /**
   * 下载。**需要登录** —— 下载记录既用于统计也用于风控，匿名下载无法归因。
   * 返回文件的访问地址，由服务端解析出默认文件/默认版本，前端无需自备兜底逻辑。
   */
  @Get('/:id/download')
  @Authorized()
  async download(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @QueryParams() query: { versionId?: string; fileId?: string },
    @Req() req: Request
  ) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }
    enforceRateLimit(`resource:download:${current.id}`, DOWNLOAD_RATE.max, DOWNLOAD_RATE.windowMs);

    const resource = await getRepository(Resource).findOne({
      where: { id, status: 'published', isPublic: true },
      select: ['id', 'name'],
    });
    if (!resource) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }

    const { version, file } = await resolveDownloadTarget(
      id,
      isUuid(query.versionId) ? query.versionId : undefined,
      isUuid(query.fileId) ? query.fileId : undefined
    );
    if (!file || !version) {
      throw notFound(ResponseCode.resource_file_not_found, '该资源暂无可下载文件');
    }

    await recordDownload({
      userId: current.id,
      resourceId: id,
      versionId: version.id,
      fileId: file.id,
      ip: clientIp(req),
    });

    return {
      resourceId: id,
      resourceName: resource.name,
      versionId: version.id,
      version: version.version,
      fileId: file.id,
      fileName: file.fileName,
      osArch: file.osArch,
      size: Number(file.size),
      checksum: file.checksum,
      url: file.url,
    };
  }

  /** 评分（1–5）。同一用户改分走更新，聚合值由服务层事务内重算。 */
  @Post('/:id/rating')
  @Authorized()
  async rate(@CurrentUser() current: AuthorizedUser, @Param('id') id: string, @Body({ validate: true }) body: RateResourceRequest) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }
    // DTO 已用 @Min/@Max 卡过范围，这里再挡一次是为了防止绕过校验的调用方
    if (body.score < 1 || body.score > 5) {
      throw badRequest(ResponseCode.rating_out_of_range, '评分需在 1-5 之间');
    }

    const resource = await getRepository(Resource).findOne({
      where: { id, status: 'published', isPublic: true },
      select: ['id'],
    });
    if (!resource) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }

    const aggregate = await upsertRating(id, current.id, body.score);
    return { score: body.score, ...aggregate };
  }

  /** 资源反馈：复用评论表，targetType=resource。目标取自 URL，请求体只需正文。 */
  @Post('/:id/feedback')
  @Authorized()
  async feedback(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body({ validate: true }) body: CreateFeedbackRequest
  ) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }
    enforceRateLimit(`comment:create:${current.id}`, 10, 60 * 1000);

    const resource = await getRepository(Resource).findOne({
      where: { id, status: 'published', isPublic: true },
      select: ['id'],
    });
    if (!resource) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }

    const repository = getRepository(Comment);
    const comment = repository.create({
      userId: current.id,
      targetType: 'resource',
      targetId: id,
      parentId: body.parentId ?? null,
      content: body.content,
      status: 'published',
      likeCount: 0,
    });
    await repository.save(comment);
    return { id: comment.id, content: comment.content, createTime: comment.createTime };
  }

  /** 某资源的反馈列表（主楼分页） */
  @Get('/:id/feedback')
  async feedbackList(@Param('id') id: string, @QueryParams() query: { pageNumber?: string; pageSize?: string }) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const [items, total] = await getRepository(Comment).findAndCount({
      where: { targetType: 'resource', targetId: id, parentId: IsNull(), status: 'published' },
      order: { createTime: 'DESC' },
      skip,
      take,
      select: ['id', 'content', 'likeCount', 'createTime', 'userId'],
    });
    return { total, items };
  }
}
