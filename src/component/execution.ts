import * as cron from 'node-cron';
import { getRepository } from 'common-db-node/dist/db';
import { Otp } from '../entity/otp';
import { UserSession } from '../entity/usersession';
import { LessThan } from 'typeorm';

/**
 * 定时任务：清理过期数据。使用简单表 + cron，暂不引入队列组件。
 */
export class Execution {
  private readonly otpRepository = getRepository(Otp);
  private readonly sessionRepository = getRepository(UserSession);

  scheduleTask(): void {
    // 每小时清理一次：过期超过 1 天的验证码、已过期或被撤销的会话
    cron.schedule('7 * * * *', async () => {
      try {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        await this.otpRepository.delete({ expireAt: LessThan(cutoff) });
        await this.sessionRepository.delete({ expiresAt: LessThan(new Date()) });
      } catch (error) {
        console.error('[cron] 清理过期数据失败', error);
      }
    });
  }
}
