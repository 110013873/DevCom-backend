import { EntityManager, In } from 'typeorm';
import { getRepository, transaction } from 'common-db-node/dist/db';
import { Resource } from '../../entity/resource';
import { ResourceVersion } from '../../entity/resourceversion';
import { ResourceFile } from '../../entity/resourcefile';
import { ResourceRating } from '../../entity/resourcerating';
import { DownloadRecord } from '../../entity/downloadrecord';
import { visibleResourceWhere } from './contentService';

/**
 * Postgres 的 `numeric` 经 pg 驱动回来的是**字符串**（避免精度丢失），
 * 直接塞进 JSON 响应会让前端拿到 `"4.50"` 而不是 `4.5`。这里统一收敛为数字。
 */
export function numericToNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 把某个版本置为默认，并在**同一事务内**先清空同资源的旧默认。
 *
 * 索引 `idx_resource_versions_default` 不是唯一约束，因此「至多一条 isDefault=true」
 * 由这段事务保证；先清后置的顺序不可颠倒。
 */
export async function setDefaultVersion(resourceId: string, versionId: string): Promise<void> {
  // transaction() 的泛型约束是 ObjectLiteral，回调不能返回 void，故显式返回一个标记对象
  await transaction(async (manager: EntityManager) => {
    await manager.update(ResourceVersion, { resourceId }, { isDefault: false });
    await manager.update(ResourceVersion, { id: versionId, resourceId }, { isDefault: true });
    return { updated: true as const };
  });
}

/**
 * 写入 / 更新一条评分，并在同一事务内重算资源上的评分聚合。
 *
 * 评分唯一键为 (resourceId, userId)，改分走 upsert 语义 —— 因此这里先按
 * 复合键找既有记录。聚合值由**全量重算**得出而非增量平均，避免浮点漂移
 * 与并发下的计数错位。
 */
export async function upsertRating(resourceId: string, userId: string, score: number): Promise<{ ratingAvg: number; ratingCount: number }> {
  return transaction(async (manager: EntityManager) => {
    const existing = await manager.findOne(ResourceRating, { where: { resourceId, userId } });
    if (existing) {
      await manager.update(ResourceRating, { id: existing.id }, { score });
    } else {
      await manager.save(manager.create(ResourceRating, { resourceId, userId, score }));
    }

    const aggregate = await manager
      .createQueryBuilder(ResourceRating, 'rating')
      .select('AVG(rating.score)', 'avg')
      .addSelect('COUNT(rating.id)', 'count')
      .where('rating.resourceId = :resourceId', { resourceId })
      .getRawOne<{ avg: string | null; count: string }>();

    const ratingCount = Number(aggregate?.count ?? 0);
    const ratingAvg = ratingCount > 0 ? Math.round(Number(aggregate?.avg ?? 0) * 100) / 100 : 0;

    await manager.update(Resource, { id: resourceId }, { ratingAvg, ratingCount });
    return { ratingAvg, ratingCount };
  });
}

export interface DownloadTarget {
  version: ResourceVersion | null;
  file: ResourceFile | null;
}

/**
 * 解析一次下载请求的目标文件。
 *
 * 未指定 fileId 时退化为「该版本的默认文件 / 默认版本的首个文件」——
 * 详情页的「下载」按钮不带 fileId，因此这条降级路径是主路径而非兜底。
 */
export async function resolveDownloadTarget(resourceId: string, versionId?: string, fileId?: string): Promise<DownloadTarget> {
  const versionRepository = getRepository(ResourceVersion);
  const fileRepository = getRepository(ResourceFile);

  if (fileId) {
    const file = await fileRepository.findOne({ where: { id: fileId } });
    if (!file) {
      return { version: null, file: null };
    }
    const version = await versionRepository.findOne({ where: { id: file.versionId } });
    // 文件必须属于本资源，否则就是跨资源引用
    if (!version || version.resourceId !== resourceId) {
      return { version: null, file: null };
    }
    return { version, file };
  }

  const version = versionId
    ? await versionRepository.findOne({ where: { id: versionId, resourceId } })
    : await versionRepository.findOne({ where: { resourceId, isDefault: true } });

  if (!version) {
    return { version: null, file: null };
  }

  const file = await fileRepository.findOne({ where: { versionId: version.id }, order: { updateTime: 'ASC' } });
  return { version, file };
}

/**
 * 记录一次下载并累加资源上的冗余计数。
 *
 * 记录本身**不做去重**（同一用户重复下载各记一条），因此不能用唯一键的
 * 冲突来兜底；计数用 SQL 原子自增，避免读-改-写丢更新。
 */
export async function recordDownload(input: {
  userId: string | null;
  resourceId: string;
  versionId: string | null;
  fileId: string | null;
  ip: string | null;
}): Promise<void> {
  await transaction(async (manager: EntityManager) => {
    await manager.save(manager.create(DownloadRecord, {
      userId: input.userId,
      resourceId: input.resourceId,
      versionId: input.versionId,
      fileId: input.fileId,
      ip: input.ip,
    }));
    await manager.increment(Resource, { id: input.resourceId }, 'downloadCount', 1);
    return { recorded: true as const };
  });
}

export interface MyDownloadItem {
  /** 下载记录 id，仅用于列表 key —— 同一资源多次下载会有多条 */
  id: string;
  /** 资源 id，前端据此拼 `/resources/:id` */
  targetId: string;
  createTime: Date;
  title: string | null;
  summary: string | null;
  coverImage: string | null;
  category: string | null;
  versionName: string | null;
  fileName: string | null;
  osArch: string | null;
  size: number | null;
}

/**
 * 「我的下载」：按时间倒序，联出资源名与当时的文件名以便列表直接渲染。
 *
 * 两条约束，缺一不可：
 *
 * 1. **资源已下线 / 转隐藏 / 软删的整条过滤掉**，而不是像收藏那样保留并返回
 *    null 标题。下载记录的语义是「我拿到过什么文件」—— 文件一旦不可再获取，
 *    这条记录就是个死链，留着只会让人反复点进 404。收藏的语义是「我标记过
 *    它」，所以那边保留、这边丢弃，是刻意的不对称。
 * 2. **不出 `fileId` / `storageKey` / `url`**。文件 id 可以直接换到一次新的
 *    下载（`/download?fileId=`），而本接口只负责展示历史；放开它等于多出一条
 *    绕过下载鉴权与限流的通路。所以这里只回文件名与大小。
 *
 * 解析放在这里而非依赖 `relations`，是为了复用 [[visibleResourceWhere]] ——
 * 关联加载不会带上业务可见性条件，只会带上软删条件。
 */
export async function myDownloads(userId: string, skip: number, take: number) {
  const [records, total] = await getRepository(DownloadRecord).findAndCount({
    where: { userId },
    order: { createTime: 'DESC' },
    skip,
    take,
  });

  if (!records.length) {
    return { total, items: [] as MyDownloadItem[] };
  }

  const resourceIds = [...new Set(records.map(record => record.resourceId))];
  const versionIds = [...new Set(records.map(record => record.versionId).filter((id): id is string => Boolean(id)))];
  const fileIds = [...new Set(records.map(record => record.fileId).filter((id): id is string => Boolean(id)))];

  const [resources, versions, files] = await Promise.all([
    getRepository(Resource).find({ where: { id: In(resourceIds), ...visibleResourceWhere() } }),
    versionIds.length
      ? getRepository(ResourceVersion).find({ where: { id: In(versionIds) } })
      : Promise.resolve([]),
    fileIds.length
      ? getRepository(ResourceFile)
          // 只选展示所需列，`storageKey` 与 `url` 不进内存也不进响应
          .find({ where: { id: In(fileIds) }, select: ['id', 'fileName', 'osArch', 'size'] })
      : Promise.resolve([]),
  ]);

  const resourceMap = new Map(resources.map(resource => [resource.id, resource]));
  const versionMap = new Map(versions.map(version => [version.id, version]));
  const fileMap = new Map(files.map(file => [file.id, file]));

  // 目标资源已不可见 → 整条丢弃，`total` 也随之按解析后的条数计
  const items: MyDownloadItem[] = records
    .filter(record => resourceMap.has(record.resourceId))
    .map(record => {
      const resource = resourceMap.get(record.resourceId)!;
      const file = record.fileId ? fileMap.get(record.fileId) : undefined;
      const version = record.versionId ? versionMap.get(record.versionId) : undefined;
      return {
        id: record.id,
        targetId: resource.id,
        createTime: record.createTime,
        title: resource.name,
        summary: resource.summary,
        coverImage: resource.coverImage,
        category: resource.category,
        versionName: version?.version ?? null,
        fileName: file?.fileName ?? null,
        osArch: file?.osArch ?? null,
        size: file?.size ?? null,
      };
    });

  return { total: items.length, items };
}
