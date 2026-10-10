import * as nodemailer from 'nodemailer';
import { config } from '../config';
import { getRepository } from 'common-db-node/dist/db';
import { SystemConfig } from '../../entity/systemconfig';
import { validateEmail } from '../common/util';

/** SystemConfig 中存管理员通知收件人与开关的键名 */
export const NOTIFY_CONFIG_KEY = 'admin_notify';

interface NotifyConfig {
  enabled: boolean;
  recipients: string[];
}

function createTransport(): nodemailer.Transporter | undefined {
  const smtp = config.email?.smtp;
  if (!smtp || !smtp.host || !smtp.user || !smtp.pass) {
    console.warn('[email] SMTP 未配置，跳过邮件发送');
    return undefined;
  }
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure ?? true,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });
}

/**
 * 发送邮件；返回是否真正投递成功，便于调用方在验证码流程中提示用户。
 */
export async function sendEmail(recipients: string[], subject: string, html: string): Promise<boolean> {
  const validRecipients = recipients.filter(validateEmail);
  if (!validRecipients.length) {
    console.warn('[email] 无有效收件人，跳过邮件发送');
    return false;
  }

  const transport = createTransport();
  if (!transport) {
    return false;
  }

  try {
    await transport.sendMail({
      from: config.email.from,
      to: validRecipients.join(','),
      subject,
      html,
    });
    return true;
  } catch (error) {
    console.error('[email] 邮件发送失败:', error);
    return false;
  }
}

async function getNotifyConfig(): Promise<NotifyConfig> {
  try {
    const repository = getRepository(SystemConfig);
    const row = await repository.findOneBy({ key: NOTIFY_CONFIG_KEY });
    const value = (row?.value ?? {}) as Partial<NotifyConfig>;
    return { enabled: value.enabled ?? false, recipients: value.recipients ?? [] };
  } catch (error) {
    console.error('[email] 读取通知配置失败:', error);
    return { enabled: false, recipients: [] };
  }
}

/**
 * 向后台管理员发送事件通知邮件（新投稿、待审核等）。
 * 未启用、收件人为空或 SMTP 未配置时静默跳过；发送失败不影响业务主流程。
 */
export async function notifyAdmins(subject: string, html: string): Promise<void> {
  const settings = await getNotifyConfig();
  if (!settings.enabled || !settings.recipients.length) {
    return;
  }
  await sendEmail(settings.recipients, subject, html);
}
