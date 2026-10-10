import { In } from 'typeorm';
import { getRepository } from 'common-db-node/dist/db';
import { SystemConfig } from '../../entity/systemconfig';
import { ConfigKey, PUBLIC_CONFIG_KEYS } from '../common/constants';
import { DEFAULT_NEWS_CATEGORIES, DEFAULT_SYSTEM_CONFIGS } from '../common/defaultConfigs';
import { NewsCategory, isNewsCategoryList, isPlainObject } from '../common/configValue';

/**
 * 运营配置的读取与默认值。
 *
 * `SystemConfig` 表是**稀疏**的：只有运营在后台改过的键才有行。因此读取方
 * 必须能容忍「键不存在」—— 这里的默认值直接取自 `DEFAULT_SYSTEM_CONFIGS`
 * （即 bootstrap 的种子），**不另立一份**。两份默认值迟早会不一致，
 * 到时候「本地起库有值、线上没值」这种问题会非常难查。
 *
 * 形状守卫（`isNewsCategoryList` / `isPlainObject`）放在 `common/configValue.ts`，
 * 与写路径共用一份 —— 否则会出现「存得进去、读不出来」的静默不一致。
 */

/** 种子表按 key 索引，供读取时兜底。 */
const SEED = new Map(DEFAULT_SYSTEM_CONFIGS.map(item => [item.key, item.value]));

/**
 * 取公开配置（匿名可读）。
 *
 * 只返回 `PUBLIC_CONFIG_KEYS` 里列出的键，且**逐个与默认值合并**：
 * `site_brand` 这类对象，合并能让运营只配 `name` 时其余字段仍有值，
 * 不必整份重写。数组型的 `news_categories` 则不做元素级合并 ——
 * 运营改词表就是要整份替换，合并出一个既不在默认表也不在运营表的
 * 混合体毫无意义。
 */
export async function getPublicConfig(): Promise<Record<string, unknown>> {
  const rows = await getRepository(SystemConfig).find({
    where: { key: In(PUBLIC_CONFIG_KEYS as unknown as string[]) },
  });
  const stored = new Map(rows.map(row => [row.key as ConfigKey, row.value]));

  const result: Record<string, unknown> = {};
  for (const key of PUBLIC_CONFIG_KEYS) {
    const storedValue = stored.get(key);
    const fallback = SEED.get(key);

    if (storedValue === undefined || storedValue === null) {
      result[key] = fallback;
      continue;
    }

    // 词表额外做一次形状校验：后台虽已拦过脏值，但历史数据可能早于那次校验，
    // 写坏的 jsonb 不该让前台崩在渲染上
    if (key === 'news_categories' && !isNewsCategoryList(storedValue)) {
      result[key] = fallback;
      continue;
    }

    result[key] = isPlainObject(fallback) && isPlainObject(storedValue)
      ? { ...fallback, ...storedValue }
      : storedValue;
  }

  return result;
}

/** 新闻分类词表，已保证是合法数组。供后台编辑器与其他服务复用。 */
export async function getNewsCategories(): Promise<NewsCategory[]> {
  const config = await getPublicConfig();
  const value = config.news_categories;
  return isNewsCategoryList(value) ? value : DEFAULT_NEWS_CATEGORIES;
}
