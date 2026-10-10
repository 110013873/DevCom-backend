import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { UserRole } from './userrole';

/** 账号状态 */
export type UserStatus = 'active' | 'banned';

/**
 * 社区用户。邮箱与手机号二选一注册，均可为空但不可同时为空（由服务端校验）。
 * 与官网 portal 的账号体系完全独立。
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_users_email', { unique: true })
  @Column({ type: 'varchar', length: 160, nullable: true })
  email: string | null;

  @Index('idx_users_phone', { unique: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'text', nullable: false })
  password: string;

  @Column({ type: 'varchar', length: 50, nullable: false })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  avatar: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ type: 'varchar', length: 20, nullable: false, default: 'active' })
  status: UserStatus;

  @Column({ type: 'timestamp with time zone', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  phoneVerifiedAt: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastLoginAt: Date | null;

  @OneToMany(() => UserRole, userRole => userRole.user, { cascade: true, eager: true })
  userRoles: UserRole[];

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  updateTime: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deleteTime: Date | null;
}
