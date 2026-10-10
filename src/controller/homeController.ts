import { Get, JsonController, QueryParams } from 'routing-controllers';
import { In } from 'typeorm';
import { getRepository } from 'common-db-node/dist/db';
import { Announcement } from '../entity/announcement';
import { RecommendationSlot } from '../entity/recommendationslot';
import { News } from '../entity/news';
import { Resource } from '../entity/resource';
import { Course } from '../entity/course';
import { numericToNumber } from '../component/service/resourceService';
import { visibleNewsWhere, visibleResourceWhere } from '../component/service/contentService';

/** 单个推荐槽位最多取几条，防止运营误配几十条把首页撑爆 */
const SLOT_LIMIT = 12;

/**
 * 首页聚合。
 *
 * 首页要同时渲染「公告 + 若干推荐位的实际内容」，如果让前端按 slotKey 逐个去请求
 * 新闻/资源/课程接口，首屏会串行发起多次请求、且拿不到统一的排序。
 * 因此这里做一次服务端解析：槽位是配置，返回的是**已解析出的内容实体**。
 *
 * 目标已下线/被删时跳过该条而不过滤整组 —— 运营下线一条新闻不应导致整个推荐位消失。
 * 这也是 [[RecommendationSlot]] 不建外键的代价，由本控制器兜住。
 */
@JsonController('/v1/home')
export class HomeController {
  /** 公告条：当前有效期内、启用中的公告 */
  @Get('/announcements')
  async announcements(@QueryParams() query: { position?: string }) {
    const builder = getRepository(Announcement).createQueryBuilder('announcement')
      .where('announcement.isActive = true')
      .andWhere('(announcement.startAt IS NULL OR announcement.startAt <= now())')
      .andWhere('(announcement.endAt IS NULL OR announcement.endAt >= now())');

    if (query.position) {
      builder.andWhere('announcement.position = :position', { position: query.position });
    }

    const rows = await builder.orderBy('announcement.createTime', 'DESC').take(20).getMany();
    return { total: rows.length, items: rows };
  }

  /**
   * 首页推荐位内容。请求时可指定多个 slotKey（逗号分隔）。
   *
   * 注意 News/Resource/Course 三张表的可见性条件在此**各自独立**地重新施加，
   * 不能因为「运营配置了」就跳过 —— 推荐位配了一条草稿新闻时同样不应出现。
   */
  @Get('/slots')
  async slots(@QueryParams() query: { keys?: string }) {
    const keys = (query.keys ?? '')
      .split(',')
      .map(key => key.trim())
      .filter(Boolean);

    const builder = getRepository(RecommendationSlot).createQueryBuilder('slot')
      .where('slot.isActive = true')
      .andWhere('(slot.startAt IS NULL OR slot.startAt <= now())')
      .andWhere('(slot.endAt IS NULL OR slot.endAt >= now())');

    if (keys.length) {
      builder.andWhere('slot.slotKey IN (:...keys)', { keys });
    }

    const slots = await builder.orderBy('slot.slotKey', 'ASC').addOrderBy('slot.sortOrder', 'ASC').getMany();
    if (!slots.length) {
      return { slots: {} as Record<string, unknown[]> };
    }

    const byType = (type: string) => slots.filter(slot => slot.targetType === type);
    const newsIds = byType('news').map(slot => slot.targetId);
    const resourceIds = byType('resource').map(slot => slot.targetId);
    const courseIds = byType('course').map(slot => slot.targetId);

    const [newsRows, resourceRows, courseRows] = await Promise.all([
      newsIds.length
        ? getRepository(News).find({
            // 三个可见性条件一个都不能少：单靠 `status: 'published'` 会把
            // 「已发布但未到发布时间」的定时稿件也放进首页推荐位
            where: { id: In(newsIds), ...visibleNewsWhere() },
            select: ['id', 'title', 'summary', 'coverImage', 'publishedAt'],
          })
        : Promise.resolve([]),
      resourceIds.length
        ? getRepository(Resource).find({
            where: { id: In(resourceIds), ...visibleResourceWhere() },
            select: ['id', 'name', 'summary', 'coverImage', 'downloadCount', 'ratingAvg', 'category'],
          })
        : Promise.resolve([]),
      courseIds.length
        ? getRepository(Course).find({
            where: { id: In(courseIds), status: 'published' },
            select: ['id', 'title', 'coverImage', 'level', 'instructor', 'duration', 'description'],
          })
        : Promise.resolve([]),
    ]);

    const newsMap = new Map(newsRows.map(row => [row.id, row]));
    const resourceMap = new Map(resourceRows.map(row => [row.id, row]));
    const courseMap = new Map(courseRows.map(row => [row.id, row]));

    const resolve = (slot: RecommendationSlot): Record<string, unknown> | null => {
      if (slot.targetType === 'news') {
        const news = newsMap.get(slot.targetId);
        return news
          ? { id: news.id, type: 'news', title: news.title, summary: news.summary, coverImage: news.coverImage, publishedAt: news.publishedAt, url: `/news/${news.id}` }
          : null;
      }
      if (slot.targetType === 'resource') {
        const resource = resourceMap.get(slot.targetId);
        return resource
          ? {
              id: resource.id,
              type: 'resource',
              title: resource.name,
              summary: resource.summary,
              coverImage: resource.coverImage,
              category: resource.category,
              downloadCount: resource.downloadCount,
              // ratingAvg 是 numeric，pg 驱动回字符串，统一转数字
              ratingAvg: numericToNumber(resource.ratingAvg),
              url: `/resources/${resource.id}`,
            }
          : null;
      }
      const course = courseMap.get(slot.targetId);
      return course
        ? {
            id: course.id,
            type: 'course',
            title: course.title,
            summary: course.description || null,
            coverImage: course.coverImage,
            level: course.level,
            instructor: course.instructor,
            duration: course.duration,
            url: `/courses/${course.id}`,
          }
        : null;
    };

    const grouped: Record<string, unknown[]> = {};
    for (const slot of slots) {
      const item = resolve(slot);
      if (!item) {
        continue;
      }
      const list = grouped[slot.slotKey] ?? [];
      if (list.length < SLOT_LIMIT) {
        list.push(item);
      }
      grouped[slot.slotKey] = list;
    }

    return { slots: grouped };
  }
}
