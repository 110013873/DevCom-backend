import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { PaginationQuery } from '../component/common/types';
import { FOLLOW_TARGET_TYPES } from '../component/common/content';

/** 邮件订阅（面向未登录访客） */
export class SubscribeRequest {
  @IsEmail({}, { message: '邮箱格式不正确' })
  @Length(1, 160)
  email: string;

  /** 订阅类别偏好，如 { news: true, courses: true } */
  @IsOptional()
  @IsObject()
  preferences?: Record<string, unknown>;
}

/** 确认 / 退订：令牌来自邮件链接，只按哈希比对 */
export class SubscriptionTokenRequest {
  @IsString({ message: '令牌不能为空' })
  @Length(1, 255)
  token: string;
}

/** 更新订阅偏好（凭令牌，无需登录） */
export class UpdateSubscriptionRequest {
  @IsString({ message: '令牌不能为空' })
  @Length(1, 255)
  token: string;

  @IsOptional()
  @IsObject()
  preferences?: Record<string, unknown>;
}

/** 站内消息列表 */
export class NotificationQuery extends PaginationQuery {
  /** 传 'true' 只看未读 */
  @IsOptional()
  @IsString()
  unreadOnly?: string;
}

/** 消息/通知偏好 */
export class UpdateNotificationPreferenceRequest {
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsObject()
  categories?: Record<string, unknown>;
}

/** 关注 / 取关（关注对象是主体，不是单条内容） */
export class FollowRequest {
  @IsIn(FOLLOW_TARGET_TYPES, { message: '未知的关注类型' })
  targetType: (typeof FOLLOW_TARGET_TYPES)[number];

  @IsUUID('all', { message: '关注对象 id 格式不正确' })
  targetId: string;
}

/** 全站搜索 */
export class SearchQuery extends PaginationQuery {
  /** 限定搜索域：news / resource / course，留空即全搜 */
  @IsOptional()
  @IsIn(['news', 'resource', 'course'], { message: '未知的搜索范围' })
  scope?: 'news' | 'resource' | 'course';
}

/** 首页公告（后台） */
export class UpsertAnnouncementRequest {
  @IsString({ message: '公告标题不能为空' })
  @Length(1, 200, { message: '公告标题长度需在 1-200 字之间' })
  title: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  position?: string;

  @IsOptional()
  @IsISO8601({}, { message: '开始时间格式不正确' })
  startAt?: string;

  @IsOptional()
  @IsISO8601({}, { message: '结束时间格式不正确' })
  endAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** 首页推荐位（后台） */
export class UpsertRecommendationSlotRequest {
  @IsString({ message: '槽位标识不能为空' })
  @Length(1, 60, { message: '槽位标识长度需在 1-60 字之间' })
  slotKey: string;

  @IsIn(['news', 'resource', 'course'], { message: '未知的推荐目标类型' })
  targetType: 'news' | 'resource' | 'course';

  @IsUUID('all', { message: '推荐目标 id 格式不正确' })
  targetId: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsISO8601({}, { message: '开始时间格式不正确' })
  startAt?: string;

  @IsOptional()
  @IsISO8601({}, { message: '结束时间格式不正确' })
  endAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** 后台订阅列表查询 */
export class AdminSubscriptionQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(['pending', 'active', 'unsubscribed', 'suppressed'], { message: '未知的订阅状态' })
  status?: 'pending' | 'active' | 'unsubscribed' | 'suppressed';
}
