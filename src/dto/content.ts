import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { PaginationQuery } from '../component/common/types';
import { CONTENT_TARGET_TYPES, ContentTargetType } from '../component/common/content';
import { NEWS_STATUSES } from '../entity/news';
import { TAG_TYPES, TagType } from '../entity/tag';

/** 评论正文长度上限。过长的「评论」实质是投稿，应走内容流程。 */
export const COMMENT_MAX_LENGTH = 2000;

/** 前台新闻列表查询 */
export class NewsQuery extends PaginationQuery {
  @IsOptional()
  @IsString()
  category?: string;

  /** 标签 id 或标签名，二者皆可命中 */
  @IsOptional()
  @IsString()
  tag?: string;

  /** 字符串 'true' / 'false'：查询串里没有布尔类型 */
  @IsOptional()
  @IsString()
  featured?: string;

  /**
   * 状态筛选。**仅后台接口读取此字段** —— 前台控制器会忽略它并强制只出
   * `published`，避免草稿经查询串泄漏（见 NewsController.list）。
   */
  @IsOptional()
  @IsIn(NEWS_STATUSES)
  status?: string;
}

/** 写/更新新闻（后台） */
export class UpsertNewsRequest {
  @IsString({ message: '标题不能为空' })
  @Length(1, 200, { message: '标题长度需在 1-200 字之间' })
  title: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  subtitle?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  coverImage?: string;

  /** Markdown 源或结构化正文，原样存 jsonb */
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  /** 渲染结果。服务端不引入 Markdown 依赖，由管理端渲染后提交 */
  @IsString({ message: '正文不能为空' })
  contentHtml: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  category?: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  author?: string;

  @IsOptional()
  @IsISO8601({}, { message: '发布时间格式不正确' })
  publishedAt?: string;

  @IsOptional()
  @IsIn(NEWS_STATUSES, { message: '未知的内容状态' })
  status?: (typeof NEWS_STATUSES)[number];

  @IsOptional()
  @IsString()
  @Length(0, 220)
  slug?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  seoDescription?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  seoKeywords?: string;

  /** 全量替换标签集（传空数组即清空） */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true, message: '标签 id 格式不正确' })
  tagIds?: string[];
}

/** 标签列表查询 */
export class TagQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(TAG_TYPES, { message: '未知的标签类型' })
  type?: TagType;
}

/** 新建 / 更新标签 */
export class UpsertTagRequest {
  @IsString({ message: '标签名不能为空' })
  @Length(1, 40, { message: '标签名长度需在 1-40 字之间' })
  name: string;

  @IsIn(TAG_TYPES, { message: '未知的标签类型' })
  type: (typeof TAG_TYPES)[number];
}

/** 某目标下的评论列表 */
export class CommentQuery extends PaginationQuery {
  @IsIn(CONTENT_TARGET_TYPES, { message: '未知的内容类型' })
  targetType: ContentTargetType;

  @IsUUID('all', { message: '内容 id 格式不正确' })
  targetId: string;
}

/** 发表评论（目标由请求体指明） */
export class CreateCommentRequest {
  @IsIn(CONTENT_TARGET_TYPES, { message: '未知的内容类型' })
  targetType: ContentTargetType;

  @IsUUID('all', { message: '内容 id 格式不正确' })
  targetId: string;

  /** 父评论 id；为空即主楼。仅支持一层楼中楼，指向二级评论会被拒绝 */
  @IsOptional()
  @IsUUID('all', { message: '父评论 id 格式不正确' })
  parentId?: string;

  @IsString({ message: '评论内容不能为空' })
  @Length(1, COMMENT_MAX_LENGTH, { message: `评论长度需在 1-${COMMENT_MAX_LENGTH} 字之间` })
  content: string;
}

/**
 * 资源反馈。
 *
 * 刻意与 `CreateCommentRequest` 分开：反馈的目标完全由 URL 决定
 * （`targetId` 取 `@Param('id')`，`targetType` 固定为 `resource`），
 * 请求体里再带一遍既冗余，又会让调用方多做一次无用功 —— 前端只发
 * `{ content }`，若复用上面那个 DTO，缺 `targetType`/`targetId` 会被
 * 校验直接判为 400。
 */
export class CreateFeedbackRequest {
  /** 父评论 id；为空即主楼 */
  @IsOptional()
  @IsUUID('all', { message: '父评论 id 格式不正确' })
  parentId?: string;

  @IsString({ message: '反馈内容不能为空' })
  @Length(1, COMMENT_MAX_LENGTH, { message: `反馈长度需在 1-${COMMENT_MAX_LENGTH} 字之间` })
  content: string;
}

/** 点赞 / 收藏的操作对象 */
export class InteractionRequest {
  @IsIn(CONTENT_TARGET_TYPES, { message: '未知的内容类型' })
  targetType: (typeof CONTENT_TARGET_TYPES)[number];

  @IsUUID('all', { message: '内容 id 格式不正确' })
  targetId: string;
}

/** 我的收藏列表 */
export class MyFavoriteQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(CONTENT_TARGET_TYPES, { message: '未知的内容类型' })
  targetType?: ContentTargetType;
}

/**
 * 我的下载列表。
 *
 * 继承分页基类会带上 `keyword`/`sort`/`order` 三个字段，但本接口既不搜索也
 * 不排序（固定按时间倒序）。这里刻意留空而不是把基类字段删掉 —— 多出的
 * 字段被静默忽略，好过让 `PaginationQuery` 为了一个接口裂成两个基类。
 */
export class MyDownloadQuery extends PaginationQuery {}

/** 评论审核（后台） */
export class ModerateCommentRequest {
  @IsIn(['pending', 'published', 'hidden'], { message: '未知的评论状态' })
  status: 'pending' | 'published' | 'hidden';

  @IsOptional()
  @IsString()
  @Length(0, 200)
  reason?: string;
}

/** 后台评论查询：可按目标 / 状态 / 关键词过滤 */
export class AdminCommentQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(CONTENT_TARGET_TYPES, { message: '未知的内容类型' })
  targetType?: ContentTargetType;

  @IsOptional()
  @IsIn(['pending', 'published', 'hidden'], { message: '未知的评论状态' })
  status?: 'pending' | 'published' | 'hidden';
}

/** 分数取值范围，与 ResponseCode.rating_out_of_range 对应 */
export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** 资源评分（1–5） */
export class RateResourceRequest {
  @IsInt({ message: '评分必须是整数' })
  @Min(RATING_MIN, { message: `评分不能低于 ${RATING_MIN} 分` })
  @Max(RATING_MAX, { message: `评分不能高于 ${RATING_MAX} 分` })
  score: number;
}
