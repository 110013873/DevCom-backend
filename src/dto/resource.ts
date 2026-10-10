import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { PaginationQuery } from '../component/common/types';
import { RESOURCE_CATEGORIES, ResourceCategory } from '../entity/resource';
import { RESOURCE_VERSION_STATUSES } from '../entity/resourceversion';

/** 前台资源列表查询 */
export class ResourceQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(RESOURCE_CATEGORIES, { message: '未知的资源分类' })
  category?: ResourceCategory;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsString()
  recommended?: string;

  @IsOptional()
  @IsString()
  free?: string;
}

/** 写 / 更新资源（后台） */
export class UpsertResourceRequest {
  @IsString({ message: '资源名称不能为空' })
  @Length(1, 160, { message: '资源名称长度需在 1-160 字之间' })
  name: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  coverImage?: string;

  @IsOptional()
  @IsIn(RESOURCE_CATEGORIES, { message: '未知的资源分类' })
  category?: (typeof RESOURCE_CATEGORIES)[number];

  @IsOptional()
  @IsString()
  @Length(0, 120)
  author?: string;

  @IsOptional()
  @IsBoolean()
  isRecommended?: boolean;

  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  /** 公开 / 隐藏。隐藏资源不出现在列表与搜索，仅直链可访问 */
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsString()
  overview?: string;

  @IsOptional()
  @IsString()
  keyFeatures?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  supportedArch?: string;

  @IsOptional()
  @IsString()
  quickStart?: string;

  @IsOptional()
  @IsString()
  systemRequirements?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  slug?: string;

  @IsOptional()
  @IsIn(['draft', 'published', 'archived'], { message: '未知的资源状态' })
  status?: 'draft' | 'published' | 'archived';

  @IsOptional()
  @IsISO8601({}, { message: '发布时间格式不正确' })
  publishedAt?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true, message: '标签 id 格式不正确' })
  tagIds?: string[];
}

/** 写 / 更新资源版本（后台） */
export class UpsertResourceVersionRequest {
  @IsString({ message: '版本号不能为空' })
  @Length(1, 40, { message: '版本号长度需在 1-40 位之间' })
  version: string;

  @IsString({ message: '版本名称不能为空' })
  @Length(1, 160, { message: '版本名称长度需在 1-160 字之间' })
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  changelog?: string;

  /** 置为默认版本。服务端在事务内保证同资源下默认版本唯一 */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  giteeUrl?: string;

  @IsOptional()
  @IsString()
  githubUrl?: string;

  @IsOptional()
  @IsIn(RESOURCE_VERSION_STATUSES, { message: '未知的版本状态' })
  status?: (typeof RESOURCE_VERSION_STATUSES)[number];
}

/** 新增 / 更新版本下的单个文件（后台） */
export class UpsertResourceFileRequest {
  @IsString({ message: '文件名不能为空' })
  @Length(1, 255, { message: '文件名长度需在 1-255 字之间' })
  fileName: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  osArch?: string;

  /** 字节数。bigint 列，DTO 层收 number 后按字符串落库 */
  @IsOptional()
  @IsInt()
  @Min(0, { message: '文件大小不能为负' })
  size?: number;

  @IsOptional()
  @IsString()
  @Length(0, 128)
  checksum?: string;

  @IsString({ message: '存储键不能为空' })
  storageKey: string;

  @IsString({ message: '访问地址不能为空' })
  url: string;
}
