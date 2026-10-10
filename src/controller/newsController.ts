import { Get, JsonController, Param, Post, QueryParams, Req } from 'routing-controllers';
import { Request } from 'express';
import { LessThanOrEqual } from 'typeorm';
import { getRepository } from 'common-db-node/dist/db';
import { News } from '../entity/news';
import { NewsQuery } from '../dto/content';
import { notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { clientIp, escapeLike, isUuid, paginate } from '../component/common/util';
import { SORTABLE_FIELDS } from '../component/common/constants';
import { idsWithTag, resolveTagIds, tagsOfNews } from '../component/service/tagService';
import { commentCounts, likeCounts, myInteractionStates } from '../component/service/contentService';
import { optionalUserId } from '../component/service/authContext';
import { enforceRateLimit } from '../component/common/rateLimit';

/**
 * 前台新闻接口。
 *
 * 两条硬约束写死在本控制器内：
 * 1. 所有读取入口强制 `status = published` —— 查询串里的 status 字段仅服务后台，
 *    前台一律忽略（见 NewsQuery 注释），避免草稿经查询串泄漏；
 * 2. 登录态是**可选**的（用 optionalUserId 软解析），公开列表/详情不要求登录，
 *    但已登录用户会多拿到自己的点赞/收藏状态。
 */
@JsonController('/v1/news')
export class NewsController {
  /** 新闻列表：分类 / 标签 / 置顶 / 关键词 / 排序 / 分页 */
  @Get('/')
  async list(@QueryParams() query: NewsQuery, @Req() req: Request) {
    const userId = optionalUserId(req);
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const sortField = SORTABLE_FIELDS.news.includes(query.sort ?? '') ? (query.sort as string) : 'publishedAt';
    const order: 'ASC' | 'DESC' = query.order === 'ASC' ? 'ASC' : 'DESC';

    const builder = getRepository(News).createQueryBuilder('news')
      .where('news.status = :status', { status: 'published' })
      .andWhere('news.isActive = true')
      .andWhere('news.publishedAt IS NOT NULL')
      .andWhere('news.publishedAt <= :now', { now: new Date() });

    if (query.category) {
      builder.andWhere('news.category = :category', { category: query.category });
    }
    if (query.featured === 'true') {
      builder.andWhere('news.isFeatured = true');
    }
    if (query.keyword) {
      const keyword = `%${escapeLike(query.keyword)}%`;
      builder.andWhere('(news.title ILIKE :keyword OR news.summary ILIKE :keyword)', { keyword });
    }
    if (query.tag) {
      // 匹配不到标签时直接返回空结果，而不是退化成「不筛选」
      const tagIds = await resolveTagIds(query.tag, 'news');
      const newsIds = await idsWithTag(tagIds, 'news');
      if (!newsIds.length) {
        return { total: 0, items: [] };
      }
      builder.andWhere('news.id IN (:...newsIds)', { newsIds });
    }

    const [rows, total] = await builder
      .orderBy(`news.${sortField}`, order)
      .skip(skip)
      .take(take)
      .getManyAndCount();

    const ids = rows.map(row => row.id);
    const [tags, comments, likes, states] = await Promise.all([
      tagsOfNews(ids),
      commentCounts('news', ids),
      likeCounts('news', ids),
      myInteractionStates(userId, 'news', ids),
    ]);

    return {
      total,
      items: rows.map(row => ({
        id: row.id,
        title: row.title,
        subtitle: row.subtitle,
        summary: row.summary,
        coverImage: row.coverImage,
        category: row.category,
        author: row.author,
        publishedAt: row.publishedAt,
        viewCount: row.viewCount,
        isFeatured: row.isFeatured,
        likeCount: likes.get(row.id) ?? 0,
        commentCount: comments.get(row.id) ?? 0,
        liked: states.get(row.id)?.liked ?? false,
        favorited: states.get(row.id)?.favorited ?? false,
        tags: tags.get(row.id) ?? [],
      })),
    };
  }

  /** 新闻详情。草稿 / 已下线内容对前台一律 404，不区分「不存在」与「不可见」 */
  @Get('/:id')
  async detail(@Param('id') id: string, @Req() req: Request) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.news_not_found, '内容不存在');
    }
    const userId = optionalUserId(req);

    const news = await getRepository(News).findOne({
      where: { id, status: 'published', isActive: true, publishedAt: LessThanOrEqual(new Date()) },
    });
    if (!news) {
      throw notFound(ResponseCode.news_not_found, '内容不存在');
    }

    const [tags, likes, comments, states] = await Promise.all([
      tagsOfNews([news.id]),
      likeCounts('news', [news.id]),
      commentCounts('news', [news.id]),
      myInteractionStates(userId, 'news', [news.id]),
    ]);

    return {
      id: news.id,
      title: news.title,
      subtitle: news.subtitle,
      summary: news.summary,
      coverImage: news.coverImage,
      contentHtml: news.contentHtml,
      category: news.category,
      author: news.author,
      publishedAt: news.publishedAt,
      viewCount: news.viewCount,
      seoTitle: news.seoTitle,
      seoDescription: news.seoDescription,
      seoKeywords: news.seoKeywords,
      updateTime: news.updateTime,
      tags: tags.get(news.id) ?? [],
      likeCount: likes.get(news.id) ?? 0,
      commentCount: comments.get(news.id) ?? 0,
      liked: states.get(news.id)?.liked ?? false,
      favorited: states.get(news.id)?.favorited ?? false,
    };
  }

  /**
   * 阅读计数。单独接口而非在详情里自增，避免「详情被爬虫抓一次就 +1」。
   * 同一 IP 对同一篇 10 分钟内只计一次。
   */
  @Post('/:id/view')
  async view(@Param('id') id: string, @Req() req: Request): Promise<{ viewed: true }> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.news_not_found, '内容不存在');
    }
    const news = await getRepository(News).findOne({
      where: { id, status: 'published', isActive: true },
      select: ['id'],
    });
    if (!news) {
      throw notFound(ResponseCode.news_not_found, '内容不存在');
    }

    enforceRateLimit(`news:view:${id}:${clientIp(req)}`, 1, 10 * 60 * 1000);
    await getRepository(News).increment({ id }, 'viewCount', 1);
    return { viewed: true };
  }

  /** 相关推荐：同分类下的其他已发布内容，排除自身 */
  @Get('/:id/related')
  async related(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.news_not_found, '内容不存在');
    }
    const news = await getRepository(News).findOne({ where: { id }, select: ['id', 'category'] });
    if (!news) {
      throw notFound(ResponseCode.news_not_found, '内容不存在');
    }

    const rows = await getRepository(News).find({
      where: {
        category: news.category,
        status: 'published',
        isActive: true,
        publishedAt: LessThanOrEqual(new Date()),
      },
      order: { publishedAt: 'DESC' },
      take: 7,
      select: ['id', 'title', 'summary', 'coverImage', 'publishedAt', 'viewCount'],
    });
    // 自身可能落在窗口内，剔除后再截断
    return rows.filter(row => row.id !== id).slice(0, 6);
  }
}
