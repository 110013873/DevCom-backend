import { Get, JsonController, QueryParams } from 'routing-controllers';
import { getRepository } from 'common-db-node/dist/db';
import { News } from '../entity/news';
import { Resource } from '../entity/resource';
import { Course } from '../entity/course';
import { SearchQuery } from '../dto/community';
import { badRequest } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { escapeLike, paginate } from '../component/common/util';

/** 每组默认返回条数：全站搜索是「找得到入口」，不是当作列表页浏览 */
const GROUP_LIMIT = 8;

type Group = 'news' | 'resource' | 'course';

interface SearchHit {
  id: string;
  title: string;
  summary: string | null;
  coverImage: string | null;
  group: Group;
  /** 便于前端直接跳转，省得再拼一次路径 */
  url: string;
}

const GROUP_URL: Record<Group, (id: string) => string> = {
  news: id => `/news/${id}`,
  resource: id => `/resources/${id}`,
  course: id => `/courses/${id}`,
};

/**
 * 全站搜索。
 *
 * 中文没有空格分词，PostgreSQL 自带的全文检索对中文需要额外分词扩展，首期不引入，
 * 因此这里用 ILIKE 子串匹配：命中率对「RISC-V」「Triton」这类专有名词足够，
 * 中文长句的召回弱于真正的分词方案 —— 这是已知取舍，后续可换 pg_trgm 或独立搜索服务。
 *
 * 三组查询都强制各自的可见性条件，隐藏/草稿内容不会因搜索而泄漏。
 */
@JsonController('/v1/search')
export class SearchController {
  @Get('/')
  async search(@QueryParams() query: SearchQuery) {
    const keyword = (query.keyword ?? '').trim();
    if (keyword.length < 2) {
      throw badRequest(ResponseCode.invalid_request, '搜索关键词至少 2 个字符');
    }

    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const pattern = `%${escapeLike(keyword)}%`;

    // 指定 scope 时按列表页分页；未指定时每组各取前 N 条
    const newsLimit = query.scope && query.scope !== 'news' ? 0 : query.scope ? take : GROUP_LIMIT;
    const resourceLimit = query.scope && query.scope !== 'resource' ? 0 : query.scope ? take : GROUP_LIMIT;
    const courseLimit = query.scope && query.scope !== 'course' ? 0 : query.scope ? take : GROUP_LIMIT;

    const [news, resources, courses] = await Promise.all([
      newsLimit > 0 ? this.searchNews(pattern, newsLimit, query.scope ? skip : 0) : Promise.resolve({ total: 0, hits: [] }),
      resourceLimit > 0 ? this.searchResources(pattern, resourceLimit, query.scope ? skip : 0) : Promise.resolve({ total: 0, hits: [] }),
      courseLimit > 0 ? this.searchCourses(pattern, courseLimit, query.scope ? skip : 0) : Promise.resolve({ total: 0, hits: [] }),
    ]);

    return {
      keyword,
      total: news.total + resources.total + courses.total,
      groups: {
        news: { total: news.total, items: news.hits },
        resource: { total: resources.total, items: resources.hits },
        course: { total: courses.total, items: courses.hits },
      },
    };
  }

  private async searchNews(pattern: string, take: number, skip: number) {
    const [rows, total] = await getRepository(News).createQueryBuilder('news')
      .where('news.status = :status', { status: 'published' })
      .andWhere('news.isActive = true')
      .andWhere('news.publishedAt <= now()')
      .andWhere('(news.title ILIKE :pattern OR news.summary ILIKE :pattern)', { pattern })
      .orderBy('news.publishedAt', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();

    const hits: SearchHit[] = rows.map(row => ({
      id: row.id,
      // 标题命中更相关，此处不排序，只按时间；相关性排序留待后续搜索服务
      title: row.title,
      summary: row.summary,
      coverImage: row.coverImage,
      group: 'news' as const,
      url: GROUP_URL.news(row.id),
    }));
    return { total, hits };
  }

  private async searchResources(pattern: string, take: number, skip: number) {
    const [rows, total] = await getRepository(Resource).createQueryBuilder('resource')
      .where('resource.status = :status', { status: 'published' })
      .andWhere('resource.isPublic = true')
      .andWhere('(resource.name ILIKE :pattern OR resource.summary ILIKE :pattern)', { pattern })
      .orderBy('resource.downloadCount', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();

    const hits: SearchHit[] = rows.map(row => ({
      id: row.id,
      title: row.name,
      summary: row.summary,
      coverImage: row.coverImage,
      group: 'resource' as const,
      url: GROUP_URL.resource(row.id),
    }));
    return { total, hits };
  }

  private async searchCourses(pattern: string, take: number, skip: number) {
    const [rows, total] = await getRepository(Course).createQueryBuilder('course')
      .where('course.status = :status', { status: 'published' })
      .andWhere('(course.title ILIKE :pattern OR course.description ILIKE :pattern)', { pattern })
      .orderBy('course.sortOrder', 'ASC')
      .skip(skip)
      .take(take)
      .getManyAndCount();

    const hits: SearchHit[] = rows.map(row => ({
      id: row.id,
      title: row.title,
      summary: row.description || null,
      coverImage: row.coverImage,
      group: 'course' as const,
      url: GROUP_URL.course(row.id),
    }));
    return { total, hits };
  }
}
