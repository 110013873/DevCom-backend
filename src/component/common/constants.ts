/**
 * 全站常量。集中放置，避免在各 controller 里散落魔法字符串。
 */

/** 登录令牌的 localStorage 键名（前端使用） */
export const TOKEN_STORAGE_KEY = 'devcom_token';

/** 密码最短长度 */
export const PASSWORD_MIN_LENGTH = 8;

/** 昵称长度区间 */
export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 20;

/** 会话默认有效期（秒），随令牌一并下发 */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** 允许的列表排序字段白名单，按模块划分。禁止任意字段排序。 */
export const SORTABLE_FIELDS: Record<string, string[]> = {
  news: ['publishedAt', 'viewCount', 'createTime'],
  resource: ['downloadCount', 'ratingAvg', 'createTime', 'name'],
  course: ['sortOrder', 'createTime'],
  user: ['createTime', 'lastLoginAt'],
  auditlog: ['createTime'],
};

/** 审计日志模块名 */
export const AUDIT_MODULES = {
  auth: 'auth',
  user: 'user',
  news: 'news',
  resource: 'resource',
  course: 'course',
  legal: 'legal',
  upload: 'upload',
  system: 'system',
} as const;

/** 默认分页大小 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * 可在后台维护的配置键白名单。
 *
 * 放在常量而非 DTO 里，是因为**两个地方**都要用它，且必须同步：
 * 一是后台写接口的入参校验（`UpdateSystemConfigRequest.key`），
 * 二是公开配置接口决定哪些键可以对外下发。若各写一份，新增键时很容易
 * 「后台能写、前台读不到」或反过来「前台能读、后台写不进」。
 */
export const CONFIG_KEYS = ['site_brand', 'site_footer', 'feature_flags', 'news_categories'] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

/**
 * 允许**匿名**读取的配置键。
 *
 * 与 `CONFIG_KEYS` 分开：白名单里的键不等于都适合公开。`feature_flags`
 * 目前是内部开关，`site_brand` / `site_footer` / `news_categories` 才是
 * 前台渲染真的需要的。要公开新键，得显式加到这里 —— 这是一个刻意的
 * 二次确认，避免新增内部配置时无意间泄漏出去。
 */
export const PUBLIC_CONFIG_KEYS: ConfigKey[] = ['site_brand', 'site_footer', 'news_categories'];
