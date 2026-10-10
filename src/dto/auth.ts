import { IsEmail, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { DISPLAY_NAME_MAX_LENGTH, DISPLAY_NAME_MIN_LENGTH, PASSWORD_MIN_LENGTH } from '../component/common/constants';

/** 中国大陆手机号 */
const PHONE_PATTERN = /^1[3-9]\d{9}$/;

export type OtpPurposeDto = 'register' | 'reset' | 'bind' | 'login';

export class SendCodeRequest {
  /** 邮箱或手机号 */
  @IsString()
  identifier: string;

  @IsIn(['email', 'sms'])
  channel: 'email' | 'sms';

  @IsIn(['register', 'reset', 'bind', 'login'])
  purpose: OtpPurposeDto;
}

export class RegisterRequestDto {
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;

  @IsOptional()
  @Matches(PHONE_PATTERN, { message: '手机号格式不正确' })
  phone?: string;

  @IsString({ message: '验证码不能为空' })
  @Length(6, 6, { message: '验证码为 6 位数字' })
  code: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, 64, { message: `密码长度需在 ${PASSWORD_MIN_LENGTH}-64 位之间` })
  password: string;

  @IsOptional()
  @IsString()
  @Length(DISPLAY_NAME_MIN_LENGTH, DISPLAY_NAME_MAX_LENGTH, { message: `昵称长度需在 ${DISPLAY_NAME_MIN_LENGTH}-${DISPLAY_NAME_MAX_LENGTH} 字之间` })
  displayName?: string;
}

export class LoginRequestDto {
  /** 邮箱或手机号 */
  @IsString({ message: '账号不能为空' })
  account: string;

  @IsString({ message: '密码不能为空' })
  password: string;
}

export class ForgotPasswordRequestDto {
  @IsString()
  identifier: string;

  @IsIn(['email', 'sms'])
  channel: 'email' | 'sms';
}

export class ResetPasswordRequestDto {
  @IsString()
  identifier: string;

  @IsString()
  @Length(6, 6, { message: '验证码为 6 位数字' })
  code: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, 64, { message: `密码长度需在 ${PASSWORD_MIN_LENGTH}-64 位之间` })
  password: string;
}
