import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user';

/**
 * 登录会话。刷新令牌以 sha256 摘要存储，支持"退出所有设备"与"封禁即撤销"。
 */
@Entity('user_sessions')
export class UserSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_user_sessions_user')
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @Index('idx_user_sessions_token', { unique: true })
  @Column({ type: 'varchar', length: 128, nullable: false })
  refreshTokenHash: string;

  @Column({ type: 'timestamp with time zone', nullable: false })
  expiresAt: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', length: 400, nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;
}
