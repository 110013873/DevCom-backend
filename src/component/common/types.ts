import { IsArray, IsNumberString, IsOptional, IsString } from 'class-validator';

export interface Page<T> {
  total: number;
  items: T[];
}

export interface TokenResponse {
  token: string;
}

/** 通用分页查询基类，所有列表 DTO 继承它 */
export class PaginationQuery {
  @IsNumberString()
  @IsOptional()
  pageNumber?: string;

  @IsNumberString()
  @IsOptional()
  pageSize?: string;

  @IsString()
  @IsOptional()
  keyword?: string;

  @IsString()
  @IsOptional()
  sort?: string;

  @IsString()
  @IsOptional()
  order?: 'ASC' | 'DESC';
}

export class RegisterRequest {
  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  password: string;

  @IsString()
  @IsOptional()
  displayName?: string;
}

export class UpdateUserRequest {
  @IsString()
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  avatar?: string;

  @IsString()
  @IsOptional()
  bio?: string;

  @IsString()
  @IsOptional()
  oldPassword?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];
}

export class AddClipRequest {
  @IsString()
  type: ClipType;

  @IsString()
  @IsOptional()
  category?: ClipCategory;
}

/**
 * 业务错误码。与 portal 保持同一编号段风格：
 * 100xx 系统 / 101xx 用户与鉴权 / 102xx 内容 / 103xx 上传 / 104xx 资源
 */
export enum ResponseCode {
  // 系统
  internal_server_error = '10000',
  invalid_request = '10001',
  invalid_signature = '10005',
  expired_request = '10006',
  rate_limited = '10007',

  // 用户与鉴权
  user_not_exist = '10100',
  user_exist = '10101',
  invalid_role = '10102',
  invalid_user = '10103',
  invalid_old_password = '10104',
  cannot_delete_self = '10105',
  invalid_username_or_password = '10106',
  invalid_phone_number = '10008',
  invalid_email = '10107',
  invalid_sms_code = '10009',
  invalid_email_code = '10108',
  account_disabled = '10109',
  token_expired = '10110',
  token_empty = '10111',
  forbidden_operation = '10112',
  password_too_weak = '10113',

  // 内容
  news_not_found = '10200',
  comment_not_found = '10201',
  tag_exist = '10202',
  tag_not_found = '10203',
  content_hidden = '10204',
  comment_forbidden = '10205',

  // 上传
  upload_file_failed = '10300',
  unsupported_file_type = '10301',
  file_too_large = '10302',

  // 资源
  resource_not_found = '10400',
  resource_version_not_found = '10401',
  resource_file_not_found = '10402',
  resource_private = '10403',
  rating_out_of_range = '10404',

  // 课程 / 订阅
  course_not_found = '10500',
  lesson_not_found = '10501',
  subscription_exists = '10502',
  subscription_token_invalid = '10503',
  legal_document_not_found = '10504',
}

export enum ClipType {
  Video = 'Video',
  Image = 'Image',
  Audio = 'Audio',
  Document = 'Document',
}

export enum ClipCategory {
  system = 'system',
  custom = 'custom',
}
