import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user';

/**
 * 站内消息。`linkType` + `linkId` 指向消息对应的业务对象（新闻 / 资源 / 课程…），
 * 前台据此生成跳转；为空即纯文本通知。
 */
@Entity('notifications')
@Index('idx_notifications_user_read', ['userId', 'readAt', 'createTime'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'uuid', nullable: false })
  userId: string;

  /** 消息类别，如 comment / reply / system / audit */
  @Column({ type: 'varchar', length: 30, nullable: false, default: 'system' })
  type: string;

  @Column({ type: 'varchar', length: 200, nullable: false })
  title: string;

  @Column({ type: 'text', nullable: false, default: '' })
  body: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  linkType: string | null;

  @Column({ type: 'uuid', nullable: true })
  linkId: string | null;

  /** 为空即未读 */
  @Column({ type: 'timestamp with time zone', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;
}
