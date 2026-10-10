import { IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, Matches, Max, Min, Length } from 'class-validator';
import { PaginationQuery } from '../component/common/types';
import { ALL_ROLES } from '../component/common/http';
import { CONFIG_KEYS, DISPLAY_NAME_MAX_LENGTH, DISPLAY_NAME_MIN_LENGTH } from '../component/common/constants';

const PHONE_PATTERN = /^1[3-9]\d{9}$/;

const USER_STATUSES = ['active', 'banned'] as const;
const LEGAL_TYPES = ['user_agreement', 'privacy_policy'] as const;

/** 用户状态。用具名别名而非内联 `(typeof USER_STATUSES)[number]` —— 后者是索引
 * 访问类型，TS 只能反射成 Object，routing-controllers 会据此对查询参数做 JSON.parse。 */
type UserStatus = (typeof USER_STATUSES)[number];

/** 管理端用户列表查询 */
export class AdminUserQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  role?: string;
}

/** 修改用户状态（封禁/解封） */
export class UpdateUserStatusRequest {
  @IsIn(USER_STATUSES, { message: '状态只能是 active 或 banned' })
  status: (typeof USER_STATUSES)[number];

  @IsOptional()
  @IsString()
  reason?: string;
}

/** 调整用户角色（全量替换 global 范围） */
export class UpdateUserRolesRequest {
  @IsArray()
  @IsIn(ALL_ROLES, { each: true, message: '包含无效的角色' })
  roles: string[];
}

/** 管理端用户资料编辑（不涉及密码，密码走用户自己的改密流程） */
export class UpdateUserProfileRequest {
  @IsOptional()
  @IsString()
  @Length(DISPLAY_NAME_MIN_LENGTH, DISPLAY_NAME_MAX_LENGTH, {
    message: `昵称长度需在 ${DISPLAY_NAME_MIN_LENGTH}-${DISPLAY_NAME_MAX_LENGTH} 字之间`,
  })
  displayName?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @Matches(PHONE_PATTERN, { message: '手机号格式不正确' })
  phone?: string;
}

/** 操作日志查询 */
export class AdminAuditLogQuery extends PaginationQuery {
  @IsOptional()
  @IsString()
  module?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsISO8601({}, { message: '开始时间格式不正确' })
  startTime?: string;

  @IsOptional()
  @IsISO8601({}, { message: '结束时间格式不正确' })
  endTime?: string;
}

/** 写协议/隐私政策新版本 */
export class UpsertLegalDocumentRequest {
  @IsIn(LEGAL_TYPES, { message: '未知的文档类型' })
  type: (typeof LEGAL_TYPES)[number];

  @IsString()
  @Length(1, 20, { message: '版本号长度需在 1-20 位之间' })
  version: string;

  @IsOptional()
  @IsISO8601({}, { message: '生效日期格式不正确' })
  effectiveDate?: string;

  @IsString({ message: '正文不能为空' })
  contentHtml: string;

  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  /** 保存后是否立即启用；默认 true，且启用时同 type 的其他版本自动失效 */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * 更新运营配置（品牌/页脚/开关/新闻分类词表）。
 *
 * `value` 用 `@IsDefined()` 而非 `@IsObject()`：词表是**数组**，
 * 而 class-validator 的 `isObject()` 显式排除数组（见其实现里的 `!Array.isArray`），
 * 用了它等于让新闻分类永远存不进去。真正的形状校验在
 * `isValidConfigValue()`（controller 里按 key 分派），那里能同时覆盖
 * 对象与数组两种形状。这里只挡住「字段压根没传」。
 *
 * `@IsDefined()` 不会把 `null` 判为缺失，因此 null 需要在 controller 里另行拒绝。
 */
export class UpdateSystemConfigRequest {
  @IsIn(CONFIG_KEYS, { message: '未知的配置项' })
  key: (typeof CONFIG_KEYS)[number];

  @IsDefined({ message: '配置值不能为空' })
  value: unknown;
}

/** 管理端内容统计的时间范围 */
export class AdminMetricQuery {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}
