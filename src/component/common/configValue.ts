import { CONFIG_KEYS, type ConfigKey } from './constants';

/**
 * 配置值的形状规则。
 *
 * **读写两条路径共用同一份**，这是本模块存在的理由：
 * - 写路径（`dto/admin.ts` → `adminSystemController.updateConfig`）用它拒绝脏值；
 * - 读路径（`configService.getPublicConfig`）用它判断库里已有的值是否还能用。
 *
 * 若各写一份，会出现「后台能存进去、前台读不出来」这种最难排查的不一致 ——
 * 存的时候校验通过，读的时候兜底回落，运营看到的是「保存成功但页面没变」。
 */

/** 新闻分类：前台筛选器与后台编辑器共用的一份词表。 */
export interface NewsCategory {
  /** 入库值，写入 `News.category` */
  value: string;
  /** 展示名 */
  label: string;
}

/**
 * `value` 的长度上限。
 *
 * 与 `dto/content.ts` 里 `NewsCreate.category` 的 `@Length(1, 40)` 对齐 ——
 * 词表里的取值最终要能写进 `News.category`（`varchar(40)`），
 * 这里放宽就等于允许运营存一个永远写不进新闻的分类。
 */
export const NEWS_CATEGORY_VALUE_MAX = 40;

/** 展示名长度上限。一期仅中文，20 字足够。 */
export const NEWS_CATEGORY_LABEL_MAX = 20;

/**
 * 词表条目数上限。
 *
 * 分类会铺成新闻列表侧栏的一排按钮，条目多了侧栏会被撑爆；而后端没有理由
 * 需要几十个新闻分类。取 30 是「够用且不至于失控」的经验值。
 */
export const NEWS_CATEGORY_COUNT_MAX = 30;

/** 判「可做浅合并的普通对象」：数组与 null 都不算，合并它们只会得到错的东西。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 分类词表的形状守卫。逐条查长度与去重 —— 重复的 `value` 会让前台筛选按钮出现幽灵项。 */
export function isNewsCategoryList(value: unknown): value is NewsCategory[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > NEWS_CATEGORY_COUNT_MAX) {
    return false;
  }

  const seen = new Set<string>();
  for (const item of value) {
    if (!isPlainObject(item)) {
      return false;
    }
    const { value: itemValue, label } = item;
    if (typeof itemValue !== 'string' || itemValue.length < 1 || itemValue.length > NEWS_CATEGORY_VALUE_MAX) {
      return false;
    }
    if (typeof label !== 'string' || label.length < 1 || label.length > NEWS_CATEGORY_LABEL_MAX) {
      return false;
    }
    if (seen.has(itemValue)) {
      return false;
    }
    seen.add(itemValue);
  }
  return true;
}

/**
 * 某个配置键是否接受这个值。写路径的最终判据。
 *
 * 对象键（`site_brand` / `site_footer` / `feature_flags`）只校验「是普通对象」：
 * 它们字段少且都有前端兜底，逐字段建模会随着加字段而不断改这里，
 * 而收益只是把错误提前几毫秒。**数组/标量脏数据仍会被挡住**，这才是要害。
 *
 * 词表则严格校验 —— 它的形状同时决定前台能不能筛、后台能不能选。
 */
export function isValidConfigValue(key: ConfigKey, value: unknown): boolean {
  if (key === 'news_categories') {
    return isNewsCategoryList(value);
  }
  return isPlainObject(value);
}

/** 全部可写配置键的运行时集合，供「未知键」判断。 */
const CONFIG_KEY_SET = new Set<string>(CONFIG_KEYS);

export function isConfigKey(key: string): key is ConfigKey {
  return CONFIG_KEY_SET.has(key);
}
