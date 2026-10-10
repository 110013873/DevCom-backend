import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post, Put, QueryParams, Req } from 'routing-controllers';
import { Request } from 'express';
import { EntityManager } from 'typeorm';
import { getRepository, transaction } from 'common-db-node/dist/db';
import { News } from '../entity/news';
import { NewsQuery, UpsertNewsRequest } from '../dto/content';
import { AuthorizedUser, OPS_ADMINS, badRequest, notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { escapeLike, isUuid, paginate, slugify } from '../component/common/util';
import { AUDIT_MODULES, SORTABLE_FIELDS } from '../component/common/constants';
import { ipOf, recordAudit } from '../component/service/auditService';
import { setNewsTags, tagsOfNews } from '../component/service/tagService';

/**
 * 后台新闻管理。
 *
 * 与前台 [[NewsController]] 的差别只有一处，但很关键：这里读得到草稿，
 * 因此**每个入口都必须 `@Authorized(OPS_ADMINS)`**，包括列表与详情。
 * 前台控制器把 status 写死为 published，后台则完全按查询串来。
 */
@JsonController('/v1/admin/news')
export class AdminNewsController {
  /** 新闻列表：可按状态 / 分类 / 关键词过滤 */
  @Get('/')
  @Authorized(OPS_ADMINS)
  async list(@QueryParams() query: NewsQuery) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const sortField = SORTABLE_FIELDS.news.includes(query.sort ?? '') ? (query.sort as string) : 'createTime';
    const order: 'ASC' | 'DESC' = query.order === 'ASC' ? 'ASC' : 'DESC';

    const builder = getRepository(News).createQueryBuilder('news');
    if (query.status) {
      builder.andWhere('news.status = :status', { status: query.status });
    }
    if (query.category) {
      builder.andWhere('news.category = :category', { category: query.category });
    }
    if (query.keyword) {
      const keyword = `%${escapeLike(query.keyword)}%`;
      builder.andWhere('(news.title ILIKE :keyword OR news.summary ILIKE :keyword)', { keyword });
    }

    const [rows, total] = await builder
      .orderBy(`news.${sortField}`, order)
      .skip(skip)
      .take(take)
      .getManyAndCount();

    const tags = await tagsOfNews(rows.map(row => row.id));

    return {
      total,
      items: rows.map(row => ({
        id: row.id,
        title: row.title,
        subtitle: row.subtitle,
        category: row.category,
        author: row.author,
        status: row.status,
        isFeatured: row.isFeatured,
        isActive: row.isActive,
        sortOrder: row.sortOrder,
        viewCount: row.viewCount,
        publishedAt: row.publishedAt,
        createTime: row.createTime,
        updateTime: row.updateTime,
        slug: row.slug,
        tags: tags.get(row.id) ?? [],
      })),
    };
  }

  /** 单条详情（含草稿正文），供编辑页回填 */
  @Get('/:id')
  @Authorized(OPS_ADMINS)
  async detail(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.news_not_found, '内容不存在');
    }
    const news = await getRepository(News).findOne({ where: { id } });
    if (!news) {
      throw notFound(ResponseCode.news_not_found, '内容不存在');
    }
    const tags = await tagsOfNews([id]);

    return { ...news, tagIds: (tags.get(id) ?? []).map(tag => tag.id) };
  }

  /** 新建。状态为 published 且未指定发布时间时补当前时间。 */
  @Post('/')
  @Authorized(OPS_ADMINS)
  async create(
    @CurrentUser() current: AuthorizedUser,
    @Body({ validate: true }) body: UpsertNewsRequest,
    @Req() req: Request
  ) {
    const status = body.status ?? 'draft';

    const news = await transaction(async (manager: EntityManager) => {
      const repository = manager.getRepository(News);
      const entity = repository.create({
        title: body.title,
        subtitle: body.subtitle ?? null,
        summary: body.summary ?? '',
        coverImage: body.coverImage ?? null,
        content: body.content ?? null,
        contentHtml: body.contentHtml,
        category: body.category ?? 'news',
        author: body.author ?? null,
        // 发布时间只在「此刻起就发布」时兜底；草稿留空，发布时再补
        publishedAt: body.publishedAt ? new Date(body.publishedAt) : status === 'published' ? new Date() : null,
        status,
        slug: body.slug || slugify(body.title) || null,
        isFeatured: body.isFeatured ?? false,
        isActive: body.isActive ?? true,
        sortOrder: body.sortOrder ?? 0,
        seoTitle: body.seoTitle ?? null,
        seoDescription: body.seoDescription ?? null,
        seoKeywords: body.seoKeywords ?? null,
        createdById: current.id,
        updatedById: current.id,
      });
      const saved = await repository.save(entity);
      await setNewsTags(manager, saved.id, body.tagIds ?? []);
      return saved;
    });

    await recordAudit({
      adminName: current.name,
      action: '新建新闻',
      module: AUDIT_MODULES.news,
      targetType: 'news',
      targetId: news.id,
      details: { title: news.title, status: news.status },
      ip: ipOf(req),
    });

    return news;
  }

  /** 更新。标签为全量替换。 */
  @Put('/:id')
  @Authorized(OPS_ADMINS)
  async update(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body({ validate: true }) body: UpsertNewsRequest,
    @Req() req: Request
  ) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.news_not_found, '内容不存在');
    }

    const news = await transaction(async (manager: EntityManager) => {
      const repository = manager.getRepository(News);
      const entity = await repository.findOne({ where: { id } });
      if (!entity) {
        throw notFound(ResponseCode.news_not_found, '内容不存在');
      }

      entity.title = body.title;
      entity.subtitle = body.subtitle ?? null;
      entity.summary = body.summary ?? '';
      entity.coverImage = body.coverImage ?? null;
      entity.content = body.content ?? null;
      entity.contentHtml = body.contentHtml;
      entity.category = body.category ?? entity.category;
      entity.author = body.author ?? null;
      entity.status = body.status ?? entity.status;
      entity.slug = body.slug || entity.slug;
      entity.isFeatured = body.isFeatured ?? entity.isFeatured;
      entity.isActive = body.isActive ?? entity.isActive;
      entity.sortOrder = body.sortOrder ?? entity.sortOrder;
      entity.seoTitle = body.seoTitle ?? null;
      entity.seoDescription = body.seoDescription ?? null;
      entity.seoKeywords = body.seoKeywords ?? null;
      entity.updatedById = current.id;

      if (body.publishedAt) {
        entity.publishedAt = new Date(body.publishedAt);
      } else if (entity.status === 'published' && !entity.publishedAt) {
        // 由草稿改为发布但从未设过发布时间，此处补上，否则前台列表查不到它
        entity.publishedAt = new Date();
      }

      const saved = await repository.save(entity);
      if (body.tagIds) {
        await setNewsTags(manager, saved.id, body.tagIds);
      }
      return saved;
    });

    await recordAudit({
      adminName: current.name,
      action: '更新新闻',
      module: AUDIT_MODULES.news,
      targetType: 'news',
      targetId: id,
      details: { title: news.title, status: news.status },
      ip: ipOf(req),
    });

    return news;
  }

  /** 发布 / 下线 / 归档。用独立接口而不是复用更新，避免运营改状态时误传正文。 */
  @Put('/:id/status')
  @Authorized(OPS_ADMINS)
  async setStatus(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body() body: { status?: string },
    @Req() req: Request
  ): Promise<{ updated: true; status: string }> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.news_not_found, '内容不存在');
    }
    const status = body?.status;
    if (!status || !['draft', 'published', 'archived'].includes(status)) {
      throw badRequest(ResponseCode.invalid_request, '未知的内容状态');
    }

    const repository = getRepository(News);
    const news = await repository.findOne({ where: { id } });
    if (!news) {
      throw notFound(ResponseCode.news_not_found, '内容不存在');
    }

    news.status = status as typeof news.status;
    if (status === 'published' && !news.publishedAt) {
      news.publishedAt = new Date();
    }
    await repository.save(news);

    await recordAudit({
      adminName: current.name,
      action: status === 'published' ? '发布新闻' : status === 'archived' ? '归档新闻' : '转为草稿',
      module: AUDIT_MODULES.news,
      targetType: 'news',
      targetId: id,
      details: { title: news.title, status },
      ip: ipOf(req),
    });

    return { updated: true, status };
  }

  /** 置顶 / 取消置顶 */
  @Put('/:id/feature')
  @Authorized(OPS_ADMINS)
  async setFeatured(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body() body: { isFeatured?: boolean },
    @Req() req: Request
  ): Promise<{ updated: true; isFeatured: boolean }> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.news_not_found, '内容不存在');
    }
    const isFeatured = body?.isFeatured !== false;

    const repository = getRepository(News);
    const news = await repository.findOne({ where: { id } });
    if (!news) {
      throw notFound(ResponseCode.news_not_found, '内容不存在');
    }
    news.isFeatured = isFeatured;
    await repository.save(news);

    await recordAudit({
      adminName: current.name,
      action: isFeatured ? '置顶新闻' : '取消置顶',
      module: AUDIT_MODULES.news,
      targetType: 'news',
      targetId: id,
      details: { title: news.title, isFeatured },
      ip: ipOf(req),
    });

    return { updated: true, isFeatured };
  }

  /**
   * 删除。软删：评论、点赞等互动记录都指向这条新闻，物理删除会让它们变成悬空数据；
   * 且误删的稿件需要可恢复。
   */
  @Delete('/:id')
  @Authorized(OPS_ADMINS)
  async remove(@CurrentUser() current: AuthorizedUser, @Param('id') id: string, @Req() req: Request): Promise<{ deleted: true }> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.news_not_found, '内容不存在');
    }
    const repository = getRepository(News);
    const news = await repository.findOne({ where: { id } });
    if (!news) {
      throw notFound(ResponseCode.news_not_found, '内容不存在');
    }

    await repository.softRemove(news);

    await recordAudit({
      adminName: current.name,
      action: '删除新闻',
      module: AUDIT_MODULES.news,
      targetType: 'news',
      targetId: id,
      details: { title: news.title },
      ip: ipOf(req),
    });

    return { deleted: true };
  }
}
