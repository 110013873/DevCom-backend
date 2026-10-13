import { getRepository } from 'common-db-node/dist/db';
import { MoreThan } from 'typeorm';
import { Otp, OtpChannel, OtpPurpose } from '../../entity/otp';
import { badRequest } from '../common/http';
import { generateSmsCode } from '../common/util';
import { ResponseCode } from '../common/types';
import { sendEmail } from './emailService';
import { isSmsConfigured, sendSms } from './aliyunSMS';

/** 验证码有效期（秒） */
const OTP_TTL_SECONDS = 5 * 60;
/** 单个验证码允许的校验尝试次数 */
const OTP_MAX_ATTEMPTS = 5;
/** 同一 identifier 两次发送的最小间隔（秒），用于最基础的频率控制 */
const OTP_RESEND_INTERVAL_SECONDS = 60;

/**
 * 开发模式下把验证码打到服务端日志，便于在未配置 SMTP/短信时本地联调注册流程。
 * 默认关闭；仅在 `.env` 显式设置 OTP_DEV_ECHO=true 时生效，生产的容器环境变量不注入该值即可保持关闭。
 */
function devEchoEnabled(): boolean {
  return process.env.OTP_DEV_ECHO === 'true';
}

/**
 * 发送验证码。同一 identifier + purpose 只保留最新有效的一条，旧记录直接作废。
 * 短信/邮件均未配置时抛错，避免"静默发不出去"的假成功。
 */
export async function issueOtp(identifier: string, channel: OtpChannel, purpose: OtpPurpose): Promise<void> {
  const repository = getRepository(Otp);

  const latest = await repository.findOne({
    where: { identifier, purpose },
    order: { createTime: 'DESC' },
  });
  if (latest) {
    const elapsed = (Date.now() - new Date(latest.createTime).getTime()) / 1000;
    if (elapsed < OTP_RESEND_INTERVAL_SECONDS) {
      throw badRequest(ResponseCode.rate_limited, `请求过于频繁，请 ${Math.ceil(OTP_RESEND_INTERVAL_SECONDS - elapsed)} 秒后再试`);
    }
  }

  const code = generateSmsCode();
  const expireAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

  // 先作废该 identifier+purpose 下的历史验证码
  await repository.update({ identifier, purpose, usedAt: undefined }, { usedAt: new Date() });
  await repository.save(repository.create({ identifier, channel, purpose, code, expireAt, attempts: 0 }));

  if (channel === 'sms') {
    if (devEchoEnabled()) {
      console.warn(`[otp][dev] ${purpose} 验证码 → ${identifier}: ${code}`);
      return;
    }
    await sendSms(identifier, code);
    return;
  }

  const sent = await sendEmail(
    [identifier],
    '【TileLang for RISC-V 社区】验证码',
    `<p>您的验证码是 <strong style="font-size:20px">${code}</strong>，${OTP_TTL_SECONDS / 60} 分钟内有效。</p><p>如非本人操作，请忽略本邮件。</p>`
  );
  if (sent) {
    return;
  }
  if (devEchoEnabled()) {
    console.warn(`[otp][dev] SMTP 未配置，验证码改为打印 → ${identifier}: ${code}`);
    return;
  }
  throw badRequest(ResponseCode.internal_server_error, '邮件发送失败，请稍后重试或联系管理员');
}

/**
 * 校验验证码并消费它。失败次数超限即作废，需重新获取。
 */
export async function consumeOtp(identifier: string, purpose: OtpPurpose, code: string): Promise<void> {
  const repository = getRepository(Otp);
  const record = await repository.findOne({
    where: { identifier, purpose, code, expireAt: MoreThan(new Date()) },
    order: { createTime: 'DESC' },
  });

  if (!record || record.usedAt) {
    throw badRequest(ResponseCode.invalid_sms_code, '验证码无效或已过期');
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    throw badRequest(ResponseCode.invalid_sms_code, '验证码尝试次数过多，请重新获取');
  }

  record.usedAt = new Date();
  await repository.save(record);
}

/** 判断某个通道当前是否可用（用于前端决定展示哪种注册方式） */
export function channelAvailable(channel: OtpChannel): boolean {
  return channel === 'sms' ? isSmsConfigured() : true;
}
