import { getRepository } from 'common-db-node/dist/db';
import { AuditLog } from '../../entity/auditlog';
import { User } from '../../entity/user';
import { dbOptions } from '../config';

/**
 * 运营大屏的统计聚合。
 *
 * 这里刻意**不落每日汇总表**：社区体量在万级以下，直查原始表的成本远低于维护
 * 一张需要定时任务保证「不重不漏」的汇总表 —— 汇总一旦与事实漂移，大屏会比
 * 没有大屏更误导人。等到单表过百万行再考虑预聚合，届时只需换掉本文件的实现，
 * 接口形状不用动。
 *
 * 全部数字来自真实查询：**没有数据就是 0**，不返回任何占位值。
 *
 * ── 为什么用原生 SQL ──────────────────────────────────────────────
 * 这些多表 LEFT JOIN + generate_series 的写法在 QueryBuilder 里要做大量字符串
 * 拼接，可读性反而更差；而且 TypeORM 的 `repository.count()` 会**隐式**过滤软删
 * 行、原生 SQL 不会 —— 两种写法混用会让「总数」与「分布」对不上。因此这里统一
 * 走原生 SQL，并**显式**写出 `"deleteTime" IS NULL`，让口径在 SQL 里一眼可见。
 */
export interface Distribution {
  /** 数据库里存的原始取值（状态码 / 分类码）。展示名由前端映射。 */
  key: string;
  count: number;
}

/** 折线图的一天。 */
export interface TrendPoint {
  /** `YYYY-MM-DD`，数据库时区。 */
  date: string;
  users: number;
  news: number;
  resources: number;
  downloads: number;
  comments: number;
  subscriptions: number;
}

export interface OverviewMetrics {
  range: { days: number; since: Date };
  totals: {
    user: { total: number; active: number; banned: number; verified: number; new: number; activeInRange: number };
    news: { total: number; published: number; draft: number; archived: number; views: number };
    resource: { total: number; published: number; draft: number; hidden: number; downloads: number; avgRating: number };
    course: { total: number; published: number; lessons: number };
    comment: { total: number; pending: number; published: number; hidden: number };
    subscription: { total: number; active: number; pending: number; unsubscribed: number; suppressed: number };
    download: { total: number; inRange: number; users: number; files: number };
    interaction: { likes: number; favorites: number };
    tag: { news: number; resource: number };
  };
  trends: TrendPoint[];
  distributions: {
    userStatus: Distribution[];
    newsCategory: Distribution[];
    newsStatus: Distribution[];
    resourceCategory: Distribution[];
    resourceStatus: Distribution[];
    commentStatus: Distribution[];
    subscriptionStatus: Distribution[];
    courseLevel: Distribution[];
    downloadCategory: Distribution[];
  };
  rankings: {
    topNews: Array<{ id: string; title: string; category: string; viewCount: number; publishedAt: string | null }>;
    topResources: Array<{
      id: string;
      name: string;
      category: string;
      downloadCount: number;
      ratingAvg: number;
      ratingCount: number;
    }>;
    topTags: Array<{ name: string; count: number }>;
  };
  recentAuditLogs: AuditLog[];
}

/** 排名类图表的条数上限。再多一屏就挤了，长尾也没有阅读价值。 */
const TOP_LIMIT = 8;

/** 带软删列表的表。原生 SQL 不会像 TypeORM 那样自动过滤，必须显式带上。 */
const SOFT_DELETE_TABLES = new Set(['users', 'news', 'resources', 'comments', 'courses']);

/**
 * `schema.table` 限定名。
 *
 * 必须限定，**不能**依赖会话的 `search_path`：TypeORM 的 `schema` 选项只影响它
 * 自己生成的带引号 SQL，并不会去设置连接的 `search_path`（实测仍是默认的
 * `"$user", public`），而本工程的表全部建在 `DB_SCHEMA` 指定的 schema 下。
 * 不限定的话，原生 SQL 会稳定地报「关系 "xxx" 不存在」。
 *
 * schema 名取自 `dbOptions` —— 与 TypeORM 用的是同一个值，配置改了不会两处脱节。
 * 取值来自配置而非请求，且标识符统一加双引号，不构成注入面。
 */
const SCHEMA = dbOptions.schema;

function tbl(name: string): string {
  return `"${SCHEMA}"."${name}"`;
}

/** 软删过滤片段（表无 deleteTime 时为空串）。 */
function alive(table: string): string {
  return SOFT_DELETE_TABLES.has(table) ? 'WHERE "deleteTime" IS NULL' : '';
}

/**
 * 借任一实体的连接执行原生 SQL。
 *
 * `common-db-node` 只导出 `getRepository` / `initializeDb` / `transaction`，
 * 没有直接暴露 DataSource，因此从 repository 的 manager 上取连接。
 * 调用点都在请求期，`initializeDb` 早已完成；不要在模块顶层调用本函数。
 */
function dbQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return getRepository(User).manager.connection.query(sql, params) as Promise<T[]>;
}

const toNumber = (value: unknown): number => Number(value ?? 0);

/**
 * 单列的分布统计：`SELECT col, COUNT(*) GROUP BY col`。
 *
 * 表名/列名在此用**字面量**拼接 —— 全部是实体上的固定标识符，没有任何来自请求
 * 的输入，不构成注入面。换取的是多张表共用一套模板，不必写多段几乎相同的 SQL。
 */
async function groupCounts(table: string, column: string): Promise<Distribution[]> {
  const rows = await dbQuery<{ key: string | null; count: string }>(
    `SELECT "${column}"::text AS key, COUNT(*)::int AS count FROM ${tbl(table)} ${alive(table)} GROUP BY 1 ORDER BY 2 DESC`
  );
  return rows.map(row => ({ key: row.key ?? 'unknown', count: toNumber(row.count) }));
}

/** 把分布数组转成 `{取值: 条数}`，便于派生 totals 里的分状态数字。 */
function toMap(distribution: Distribution[]): Record<string, number> {
  return Object.fromEntries(distribution.map(item => [item.key, item.count]));
}

/**
 * 折线图的时间序列。
 *
 * 用 `generate_series` 补齐连续日期再 LEFT JOIN 各表的按日计数：只返回「有数据的
 * 那几天」的话，前端折线会把相隔数日的点直接连起来，看上去像持续增长，实际是
 * 采样断点。补零才是不会骗人的图。
 */
async function buildTrends(since: Date): Promise<TrendPoint[]> {
  const daily = (table: string): string =>
    `(SELECT "createTime"::date AS day, COUNT(*)::int AS c FROM ${tbl(table)} ${alive(table)} GROUP BY 1)`;

  return dbQuery<TrendPoint>(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
            COALESCE(u.c, 0)::int AS users,
            COALESCE(n.c, 0)::int AS news,
            COALESCE(r.c, 0)::int AS resources,
            COALESCE(dl.c, 0)::int AS downloads,
            COALESCE(cm.c, 0)::int AS comments,
            COALESCE(s.c, 0)::int AS subscriptions
       FROM generate_series($1::date, CURRENT_DATE, interval '1 day') AS d(day)
       LEFT JOIN ${daily('users')} u ON u.day = d.day
       LEFT JOIN ${daily('news')} n ON n.day = d.day
       LEFT JOIN ${daily('resources')} r ON r.day = d.day
       LEFT JOIN ${daily('download_records')} dl ON dl.day = d.day
       LEFT JOIN ${daily('comments')} cm ON cm.day = d.day
       LEFT JOIN ${daily('subscriptions')} s ON s.day = d.day
      ORDER BY d.day ASC`,
    [since]
  );
}

/**
 * 汇总标量。写成一条 SQL 里的一组标量子查询：这些计数彼此独立、都无法用分组
 * 派生，串行发二十多条查询的往返开销比一条稍长的 SQL 高得多。
 *
 * 片段拆成数组再拼，是为了让 `tbl()` 对每张表都生效 —— 手写一长串 SQL 时漏掉
 * 一处表名限定就会在运行期炸掉，拆开后格式统一、也便于增删指标。
 */
interface ScalarRow {
  user_total: number;
  user_active: number;
  user_banned: number;
  user_verified: number;
  user_new: number;
  user_active_in_range: number;
  news_views: string;
  resource_total: number;
  resource_hidden: number;
  resource_downloads: string;
  resource_avg_rating: number;
  course_total: number;
  course_published: number;
  lesson_total: number;
  comment_total: number;
  subscription_total: number;
  download_total: number;
  download_in_range: number;
  download_users: number;
  download_files: number;
  like_total: number;
  favorite_total: number;
  news_tag_total: number;
  resource_tag_total: number;
}

const scalarFragments = (): string[] => [
  `(SELECT COUNT(*) FROM ${tbl('users')} WHERE "deleteTime" IS NULL) AS user_total`,
  `(SELECT COUNT(*) FROM ${tbl('users')} WHERE "deleteTime" IS NULL AND status = 'active') AS user_active`,
  `(SELECT COUNT(*) FROM ${tbl('users')} WHERE "deleteTime" IS NULL AND status = 'banned') AS user_banned`,
  `(SELECT COUNT(*) FROM ${tbl('users')} WHERE "deleteTime" IS NULL
     AND ("emailVerifiedAt" IS NOT NULL OR "phoneVerifiedAt" IS NOT NULL)) AS user_verified`,
  `(SELECT COUNT(*) FROM ${tbl('users')} WHERE "deleteTime" IS NULL AND "createTime" >= $1) AS user_new`,
  `(SELECT COUNT(*) FROM ${tbl('users')} WHERE "deleteTime" IS NULL AND "lastLoginAt" >= $1) AS user_active_in_range`,
  `(SELECT COALESCE(SUM("viewCount"), 0) FROM ${tbl('news')} WHERE "deleteTime" IS NULL) AS news_views`,
  `(SELECT COUNT(*) FROM ${tbl('resources')} WHERE "deleteTime" IS NULL) AS resource_total`,
  `(SELECT COUNT(*) FROM ${tbl('resources')} WHERE "deleteTime" IS NULL AND "isPublic" = false) AS resource_hidden`,
  `(SELECT COALESCE(SUM("downloadCount"), 0) FROM ${tbl('resources')} WHERE "deleteTime" IS NULL) AS resource_downloads`,
  `(SELECT COALESCE(ROUND(AVG("ratingAvg")::numeric, 2), 0)::float8 FROM ${tbl('resources')}
     WHERE "deleteTime" IS NULL AND "ratingCount" > 0) AS resource_avg_rating`,
  `(SELECT COUNT(*) FROM ${tbl('courses')} WHERE "deleteTime" IS NULL) AS course_total`,
  `(SELECT COUNT(*) FROM ${tbl('courses')} WHERE "deleteTime" IS NULL AND status = 'published') AS course_published`,
  `(SELECT COUNT(*) FROM ${tbl('lessons')} l JOIN ${tbl('courses')} c ON c.id = l."courseId"
     WHERE c."deleteTime" IS NULL) AS lesson_total`,
  `(SELECT COUNT(*) FROM ${tbl('comments')} WHERE "deleteTime" IS NULL) AS comment_total`,
  `(SELECT COUNT(*) FROM ${tbl('subscriptions')}) AS subscription_total`,
  `(SELECT COUNT(*) FROM ${tbl('download_records')}) AS download_total`,
  `(SELECT COUNT(*) FROM ${tbl('download_records')} WHERE "createTime" >= $1) AS download_in_range`,
  `(SELECT COUNT(DISTINCT "userId") FROM ${tbl('download_records')}
     WHERE "userId" IS NOT NULL AND "createTime" >= $1) AS download_users`,
  `(SELECT COUNT(DISTINCT "fileId") FROM ${tbl('download_records')}
     WHERE "fileId" IS NOT NULL AND "createTime" >= $1) AS download_files`,
  `(SELECT COUNT(*) FROM ${tbl('reactions')}) AS like_total`,
  `(SELECT COUNT(*) FROM ${tbl('favorites')}) AS favorite_total`,
  `(SELECT COUNT(*) FROM ${tbl('news_tags')}) AS news_tag_total`,
  `(SELECT COUNT(*) FROM ${tbl('resource_tags')}) AS resource_tag_total`,
];

async function buildScalars(since: Date): Promise<ScalarRow> {
  const [row] = await dbQuery<ScalarRow>(
    `SELECT
       ${scalarFragments().join(',\n       ')}`,
    [since]
  );
  return row;
}

export async function buildOverviewMetrics(days: number, since: Date): Promise<OverviewMetrics> {
  const [
    userStatus,
    newsStatus,
    resourceStatus,
    commentStatus,
    subscriptionStatus,
    courseLevel,
    newsCategory,
    resourceCategory,
    downloadCategory,
    trends,
    scalars,
    topNews,
    topResources,
    topTags,
    recentAuditLogs,
  ] = await Promise.all([
    groupCounts('users', 'status'),
    groupCounts('news', 'status'),
    groupCounts('resources', 'status'),
    groupCounts('comments', 'status'),
    groupCounts('subscriptions', 'status'),
    groupCounts('courses', 'level'),
    groupCounts('news', 'category'),
    groupCounts('resources', 'category'),
    // 下载量按资源分类分布：需要 join，走不了 groupCounts
    dbQuery<Distribution>(
      `SELECT r."category"::text AS key, COUNT(*)::int AS count
         FROM ${tbl('download_records')} d
         JOIN ${tbl('resources')} r ON r.id = d."resourceId"
        GROUP BY 1 ORDER BY 2 DESC`
    ),
    buildTrends(since),
    buildScalars(since),
    dbQuery<OverviewMetrics['rankings']['topNews'][number]>(
      `SELECT id, title, category, "viewCount"::int AS "viewCount", "publishedAt"
         FROM ${tbl('news')}
        WHERE "deleteTime" IS NULL AND status = 'published'
        ORDER BY "viewCount" DESC
        LIMIT ${TOP_LIMIT}`
    ),
    dbQuery<OverviewMetrics['rankings']['topResources'][number]>(
      `SELECT id, name, category, "downloadCount"::int AS "downloadCount",
              "ratingAvg"::float8 AS "ratingAvg", "ratingCount"::int AS "ratingCount"
         FROM ${tbl('resources')}
        WHERE "deleteTime" IS NULL AND status = 'published'
        ORDER BY "downloadCount" DESC
        LIMIT ${TOP_LIMIT}`
    ),
    dbQuery<OverviewMetrics['rankings']['topTags'][number]>(
      `SELECT t.name, COUNT(*)::int AS count
         FROM ${tbl('news_tags')} nt
         JOIN ${tbl('tags')} t ON t.id = nt."tagId"
        GROUP BY t.name ORDER BY 2 DESC LIMIT ${TOP_LIMIT}`
    ),
    // 审计日志沿用实体查询：前端 AuditLogItem 就按实体字段形状定义，走原生 SQL
    // 反而要手工对齐每一列
    getRepository(AuditLog).find({ order: { createTime: 'DESC' }, take: 10 }),
  ]);

  const newsStatusMap = toMap(newsStatus);
  const resourceStatusMap = toMap(resourceStatus);
  const commentStatusMap = toMap(commentStatus);
  const subscriptionStatusMap = toMap(subscriptionStatus);
  const userStatusMap = toMap(userStatus);

  return {
    range: { days, since },
    totals: {
      user: {
        total: toNumber(scalars.user_total),
        active: userStatusMap.active ?? 0,
        banned: userStatusMap.banned ?? 0,
        verified: toNumber(scalars.user_verified),
        new: toNumber(scalars.user_new),
        activeInRange: toNumber(scalars.user_active_in_range),
      },
      news: {
        total: newsStatus.reduce((sum, item) => sum + item.count, 0),
        published: newsStatusMap.published ?? 0,
        draft: newsStatusMap.draft ?? 0,
        archived: newsStatusMap.archived ?? 0,
        views: toNumber(scalars.news_views),
      },
      resource: {
        total: toNumber(scalars.resource_total),
        published: resourceStatusMap.published ?? 0,
        draft: resourceStatusMap.draft ?? 0,
        hidden: toNumber(scalars.resource_hidden),
        downloads: toNumber(scalars.resource_downloads),
        avgRating: toNumber(scalars.resource_avg_rating),
      },
      course: {
        total: toNumber(scalars.course_total),
        published: toNumber(scalars.course_published),
        lessons: toNumber(scalars.lesson_total),
      },
      comment: {
        total: toNumber(scalars.comment_total),
        pending: commentStatusMap.pending ?? 0,
        published: commentStatusMap.published ?? 0,
        hidden: commentStatusMap.hidden ?? 0,
      },
      subscription: {
        total: toNumber(scalars.subscription_total),
        active: subscriptionStatusMap.active ?? 0,
        pending: subscriptionStatusMap.pending ?? 0,
        unsubscribed: subscriptionStatusMap.unsubscribed ?? 0,
        suppressed: subscriptionStatusMap.suppressed ?? 0,
      },
      download: {
        total: toNumber(scalars.download_total),
        inRange: toNumber(scalars.download_in_range),
        users: toNumber(scalars.download_users),
        files: toNumber(scalars.download_files),
      },
      interaction: {
        likes: toNumber(scalars.like_total),
        favorites: toNumber(scalars.favorite_total),
      },
      tag: {
        news: toNumber(scalars.news_tag_total),
        resource: toNumber(scalars.resource_tag_total),
      },
    },
    trends,
    distributions: {
      userStatus,
      newsCategory,
      newsStatus,
      resourceCategory,
      resourceStatus,
      commentStatus,
      subscriptionStatus,
      courseLevel,
      downloadCategory,
    },
    rankings: { topNews, topResources, topTags },
    recentAuditLogs,
  };
}
