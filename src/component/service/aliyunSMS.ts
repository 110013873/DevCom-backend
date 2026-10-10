import Dysmsapi20170525, * as $Dysmsapi20170525 from '@alicloud/dysmsapi20170525';
import * as $OpenApi from '@alicloud/openapi-client';
import { config } from '../config';

export function isSmsConfigured(): boolean {
  const sms = config.aliyun.SMS;
  return Boolean(sms.accessKeyId && sms.accessKeySecret && sms.signName && sms.templateCode);
}

export function createClient(): Dysmsapi20170525 {
  const shortMessageConfig = new $OpenApi.Config({
    accessKeyId: config.aliyun.SMS.accessKeyId,
    accessKeySecret: config.aliyun.SMS.accessKeySecret,
  });
  shortMessageConfig.endpoint = config.aliyun.SMS.endpoint;
  return new Dysmsapi20170525(shortMessageConfig);
}

/**
 * 发送验证码短信。失败时抛出异常，由调用方决定是否回滚验证码记录。
 */
export async function sendSms(phoneNo: string, smsCode: string): Promise<void> {
  if (!isSmsConfigured()) {
    throw new Error('短信服务未配置：请设置 SMS_ACCESS_KEY_ID / SMS_ACCESS_KEY_SECRET / SMS_SIGN_NAME / SMS_TEMPLATE_CODE');
  }
  const client = createClient();
  const request = new $Dysmsapi20170525.SendSmsRequest({
    phoneNumbers: phoneNo,
    signName: config.aliyun.SMS.signName,
    templateCode: config.aliyun.SMS.templateCode,
    templateParam: JSON.stringify({ code: smsCode }),
  });
  const response = await client.sendSms(request);
  if (response.body?.code !== 'OK') {
    throw new Error(`短信发送失败: ${response.body?.code} ${response.body?.message}`);
  }
}
