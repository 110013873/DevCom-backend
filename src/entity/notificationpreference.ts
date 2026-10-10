import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user';

/**
 * 用户通知偏好。每位用户一条记录，账号创建时按默认值补齐。
 * `categories` 存细分类别开关，如 { comment: true, reply: true, system: true }。
 */
@Entity('notification_preferences')
@Index('idx_notification_preferences_user', ['userId'], { unique: true })
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'uuid', nullable: false })
  userId: string;

  /** 是否接收邮件通知；站内消息不受此开关影响 */
  @Column({ type: 'boolean', nullable: false, default: false })
  emailEnabled: boolean;

  @Column({ type: 'jsonb', nullable: false, default: () => "'{}'" })
  categories: Record<string, unknown>;

  @UpdateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  updateTime: Date;
}
