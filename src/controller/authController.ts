import { Body, JsonController, Post, Req } from 'routing-controllers';
import { Request } from 'express';
import { getRepository } from 'common-db-node/dist/db';
import {
  ForgotPasswordRequestDto,
  LoginRequestDto,
  RegisterRequestDto,
  ResetPasswordRequestDto,
  SendCodeRequest,
} from '../dto/auth';
import { User } from '../entity/user';
import { OtpChannel, OtpPurpose } from '../entity/otp';
import { badRequest, unauthorized } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { generateToken, hash, isValidPhoneNumber, validateEmail, verify } from '../component/common/util';
import { enforceRateLimit, RATE_LIMITS } from '../component/common/rateLimit';
import { AUDIT_MODULES } from '../component/common/constants';
import { channelAvailable, consumeOtp, issueOtp } from '../component/service/otpService';
import { findByAccount } from '../component/service/userService';
import { ensureBuiltInRoles, getRoleCodes, setGlobalRoles } from '../component/service/rbacService';
import { MEMBER } from '../component/common/http';
import { ipOf, recordAudit } from '../component/service/auditService';

/** 对外输出的用户字段，剔除密码等敏感项 */
export function publicUser(user: User, roles: string[]) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    avatar: user.avatar,
    bio: user.bio,
    roles,
  };
}

function defaultDisplayName(identifier: string): string {
  return validateEmail(identifier) ? identifier.split('@')[0] : `开发者${identifier.slice(-4)}`;
}

@JsonController('/v1/auth')
export class AuthController {
  /**
   * 发送验证码。同一个 identifier 与 purpose 组合只保留最新一条有效记录。
   */
  @Post('/send-code')
  async sendCode(@Body({ validate: true }) body: SendCodeRequest, @Req() req: Request): Promise<{ sent: true }> {
    const identifier = body.identifier?.trim();
    if (!identifier) {
      throw badRequest(ResponseCode.invalid_request, '请输入邮箱或手机号');
    }
    if (body.channel === 'email' && !validateEmail(identifier)) {
      throw badRequest(ResponseCode.invalid_email, '邮箱格式不正确');
    }
    if (body.channel === 'sms' && !isValidPhoneNumber(identifier)) {
      throw badRequest(ResponseCode.invalid_phone_number, '手机号格式不正确');
    }
    if (!channelAvailable(body.channel as OtpChannel)) {
      throw badRequest(ResponseCode.internal_server_error, '短信通道未开启，请使用邮箱注册');
    }

    enforceRateLimit(`otp:id:${body.purpose}:${identifier}`, RATE_LIMITS.otpSend.max, RATE_LIMITS.otpSend.windowMs);
    enforceRateLimit(`otp:ip:${ipOf(req)}`, RATE_LIMITS.otpSendByIp.max, RATE_LIMITS.otpSendByIp.windowMs);

    // 注册与绑定用途要求账号尚未占用；重置用途则要求账号已存在
    const existing = await findByAccount(identifier);
    if (body.purpose === 'register' && existing) {
      throw badRequest(ResponseCode.user_exist, '该账号已被注册');
    }
    if ((body.purpose === 'reset' || body.purpose === 'login') && !existing) {
      throw badRequest(ResponseCode.user_not_exist, '该账号尚未注册');
    }

    await issueOtp(identifier, body.channel as OtpChannel, body.purpose as OtpPurpose);
    return { sent: true };
  }

  @Post('/register')
  async register(
    @Body({ validate: true }) body: RegisterRequestDto,
    @Req() req: Request
  ): Promise<{ token: string; user: ReturnType<typeof publicUser> }> {
    const email = body.email?.trim() || null;
    const phone = body.phone?.trim() || null;
    if (!email && !phone) {
      throw badRequest(ResponseCode.invalid_request, '请提供邮箱或手机号');
    }
    if (email && phone) {
      throw badRequest(ResponseCode.invalid_request, '请只选择一种注册方式');
    }

    const identifier = (email ?? phone) as string;
    await consumeOtp(identifier, 'register', body.code);

    const repository = getRepository(User);
    if (email && await repository.findOne({ where: { email } })) {
      throw badRequest(ResponseCode.user_exist, '该邮箱已被注册');
    }
    if (phone && await repository.findOne({ where: { phone } })) {
      throw badRequest(ResponseCode.user_exist, '该手机号已被注册');
    }

    await ensureBuiltInRoles();

    const saved = await repository.save(repository.create({
      email,
      phone,
      password: await hash(body.password),
      displayName: body.displayName?.trim() || defaultDisplayName(identifier),
      status: 'active',
      emailVerifiedAt: email ? new Date() : null,
      phoneVerifiedAt: phone ? new Date() : null,
      lastLoginAt: new Date(),
    }));
    await setGlobalRoles(saved.id, [MEMBER]);

    await recordAudit({
      userId: saved.id,
      adminName: saved.displayName,
      action: '注册账号',
      module: AUDIT_MODULES.auth,
      targetType: 'user',
      targetId: saved.id,
      ip: ipOf(req),
    });

    return { token: generateToken(saved, [MEMBER]), user: publicUser(saved, [MEMBER]) };
  }

  @Post('/login')
  async login(
    @Body({ validate: true }) body: LoginRequestDto,
    @Req() req: Request
  ): Promise<{ token: string; user: ReturnType<typeof publicUser> }> {
    const account = body.account?.trim();
    enforceRateLimit(`login:${account}`, RATE_LIMITS.login.max, RATE_LIMITS.login.windowMs);

    const user = await findByAccount(account);
    // 统一错误文案，避免通过响应差异探测账号是否存在
    if (!user || !(await verify(body.password, user.password))) {
      throw badRequest(ResponseCode.invalid_username_or_password, '账号或密码错误');
    }
    if (user.status !== 'active') {
      throw unauthorized(ResponseCode.account_disabled, '账号已被禁用，请联系管理员');
    }

    await ensureBuiltInRoles();
    const roles = await getRoleCodes(user.id);
    user.lastLoginAt = new Date();
    await getRepository(User).save(user);

    await recordAudit({
      userId: user.id,
      adminName: user.displayName,
      action: '登录',
      module: AUDIT_MODULES.auth,
      targetType: 'user',
      targetId: user.id,
      ip: ipOf(req),
    });

    return { token: generateToken(user, roles), user: publicUser(user, roles) };
  }

  @Post('/forgot-password')
  async forgotPassword(@Body({ validate: true }) body: ForgotPasswordRequestDto, @Req() req: Request): Promise<{ sent: true }> {
    const identifier = body.identifier?.trim();
    enforceRateLimit(`otp:id:reset:${identifier}`, RATE_LIMITS.otpSend.max, RATE_LIMITS.otpSend.windowMs);
    enforceRateLimit(`otp:ip:${ipOf(req)}`, RATE_LIMITS.otpSendByIp.max, RATE_LIMITS.otpSendByIp.windowMs);

    if (!await findByAccount(identifier)) {
      throw badRequest(ResponseCode.user_not_exist, '该账号尚未注册');
    }
    if (!channelAvailable(body.channel as OtpChannel)) {
      throw badRequest(ResponseCode.internal_server_error, '短信通道未开启，请使用邮箱找回');
    }
    await issueOtp(identifier, body.channel as OtpChannel, 'reset');
    return { sent: true };
  }

  @Post('/reset-password')
  async resetPassword(@Body({ validate: true }) body: ResetPasswordRequestDto, @Req() req: Request): Promise<{ reset: true }> {
    const identifier = body.identifier?.trim();
    await consumeOtp(identifier, 'reset', body.code);

    const user = await findByAccount(identifier);
    if (!user) {
      throw badRequest(ResponseCode.user_not_exist, '该账号尚未注册');
    }

    user.password = await hash(body.password);
    await getRepository(User).save(user);

    await recordAudit({
      userId: user.id,
      adminName: user.displayName,
      action: '重置密码',
      module: AUDIT_MODULES.auth,
      targetType: 'user',
      targetId: user.id,
      ip: ipOf(req),
    });
    return { reset: true };
  }
}
