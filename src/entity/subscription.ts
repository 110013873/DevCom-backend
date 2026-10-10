import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type SubscriptionStatus = 'pending' | 'active' | 'unsubscribed' | 'suppressed';

/**
 * 邮件订阅。面向**未登录访客**，因此以 email 为唯一键，不与 User 表关联。
 *
 * 确认链接与退订链接中的令牌只存哈希（`tokenHash`）：即便数据库被读，
 * 也无法反推出可用的确认/退订地址。退订即时生效，`suppressed` 用于
 * 硬退信等「不应再发」的状态。
 */
@Entity('subscriptions')
@Index('idx_subscriptions_email', ['email'], { unique: true })
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160, nullable: false })
  email: string;

  @Column({ type: 'varchar', length: 20, nullable: false, default: 'pending' })
  status: SubscriptionStatus;

  @Index('idx_subscriptions_token', { unique: true })
  @Column({ type: 'varchar', length: 128, nullable: false })
  tokenHash: string;

  /** 订阅类别偏好，如 { news: true, courses: true, events: false } */
  @Column({ type: 'jsonb', nullable: false, default: () => "'{}'" })
  preferences: Record<string, unknown>;

  @Column({ type: 'timestamp with time zone', nullable: true })
  confirmedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  updateTime: Date;
}
