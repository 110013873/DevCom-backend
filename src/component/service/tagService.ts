import { EntityManager, In } from 'typeorm';
import { getRepository } from 'common-db-node/dist/db';
import { Tag, TagType } from '../../entity/tag';
import { NewsTag } from '../../entity/newstag';
import { ResourceTag } from '../../entity/resourcetag';

/** 标签使用计数：由关联表行数重算，不做「+1/-1」的增量维护 */
async function recountTag(manager: EntityManager, tagId: string, type: TagType): Promise<void> {
  const count = type === 'news'
    ? await manager.count(NewsTag, { where: { tagId } })
    : await manager.count(ResourceTag, { where: { tagId } });
  await manager.update(Tag, { id: tagId }, { usageCount: count });
}

/**
 * 全量替换新闻标签集合并重算受影响标签的使用计数。
 *
 * 计数在**事务内重算而非增量增减**：增量写法一旦某次请求中途失败或并发交错，
 * 计数就会永久偏离真实值，而 `usageCount` 只是用于排序，重算的代价可以接受。
 */
export async function setNewsTags(manager: EntityManager, newsId: string, tagIds: string[]): Promise<void> {
  const previous = await manager.find(NewsTag, { where: { newsId } });
  const previousTagIds = previous.map(row => row.tagId);

  await manager.delete(NewsTag, { newsId });

  const unique = [...new Set(tagIds)];
  if (unique.length) {
    const tags = await manager.find(Tag, { where: { id: In(unique), type: 'news' } });
    await manager.save(tags.map(tag => manager.create(NewsTag, { newsId, tagId: tag.id })));
  }

  const affected = new Set([...previousTagIds, ...unique]);
  for (const tagId of affected) {
    await recountTag(manager, tagId, 'news');
  }
}

/** 全量替换资源标签集合（语义同 setNewsTags） */
export async function setResourceTags(manager: EntityManager, resourceId: string, tagIds: string[]): Promise<void> {
  const previous = await manager.find(ResourceTag, { where: { resourceId } });
  const previousTagIds = previous.map(row => row.tagId);

  await manager.delete(ResourceTag, { resourceId });

  const unique = [...new Set(tagIds)];
  if (unique.length) {
    const tags = await manager.find(Tag, { where: { id: In(unique), type: 'resource' } });
    await manager.save(tags.map(tag => manager.create(ResourceTag, { resourceId, tagId: tag.id })));
  }

  const affected = new Set([...previousTagIds, ...unique]);
  for (const tagId of affected) {
    await recountTag(manager, tagId, 'resource');
  }
}

/** 取新闻的标签（前台详情与列表共用） */
export async function tagsOfNews(newsIds: string[]): Promise<Map<string, Tag[]>> {
  const grouped = new Map<string, Tag[]>(newsIds.map(id => [id, []]));
  if (!newsIds.length) {
    return grouped;
  }

  const rows = await getRepository(NewsTag).find({
    where: { newsId: In(newsIds) },
    relations: ['tag'],
  });
  for (const row of rows) {
    if (row.tag) {
      grouped.get(row.newsId)?.push(row.tag);
    }
  }
  return grouped;
}

/** 取资源的标签 */
export async function tagsOfResource(resourceIds: string[]): Promise<Map<string, Tag[]>> {
  const grouped = new Map<string, Tag[]>(resourceIds.map(id => [id, []]));
  if (!resourceIds.length) {
    return grouped;
  }

  const rows = await getRepository(ResourceTag).find({
    where: { resourceId: In(resourceIds) },
    relations: ['tag'],
  });
  for (const row of rows) {
    if (row.tag) {
      grouped.get(row.resourceId)?.push(row.tag);
    }
  }
  return grouped;
}

/**
 * 按标签筛选时把「标签 id 或标签名」解析为一组标签 id。
 * 匹配不到任何标签时返回空数组 —— 调用方据此返回空结果，而不是退化成不筛选。
 */
export async function resolveTagIds(keyword: string, type: TagType): Promise<string[]> {
  if (!keyword) {
    return [];
  }
  const repository = getRepository(Tag);
  const byName = await repository.find({ where: { name: keyword, type } });
  if (byName.length) {
    return byName.map(tag => tag.id);
  }
  // 非 uuid 的关键词不必再查 id，避免把字符串丢给 uuid 列触发数据库类型错误
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(keyword)) {
    return [];
  }
  const byId = await repository.findOne({ where: { id: keyword, type } });
  return byId ? [byId.id] : [];
}

/** 供搜索接口复用：把命中的新闻/资源 id 收敛成一个列表 */
export async function idsWithTag(ids: string[], type: TagType): Promise<string[]> {
  if (!ids.length) {
    return [];
  }
  const rows = type === 'news'
    ? await getRepository(NewsTag).find({ where: { tagId: In(ids) }, select: ['newsId'] })
    : await getRepository(ResourceTag).find({ where: { tagId: In(ids) }, select: ['resourceId'] });
  return type === 'news'
    ? (rows as NewsTag[]).map(row => row.newsId)
    : (rows as ResourceTag[]).map(row => row.resourceId);
}
