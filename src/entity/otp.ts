import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** 验证码用途 */
export type OtpPurpose = 'register' | 'reset' | 'bind' | 'login';
export type OtpChannel = 'email' | 'sms';

/**
 * 一次性验证码。identifier 为邮箱或手机号。
 * 用 attempts 限制爆破次数，usedAt 标记已消费，同一 identifier+purpose 只认最新一条。
 */
@Entity('otp')
@Index('idx_otp_identifier_purpose', ['identifier', 'purpose'])
export class Otp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160, nullable: false })
  identifier: string;

  @Column({ type: 'varchar', length: 10, nullable: false, default: 'email' })
  channel: OtpChannel;

  @Column({ type: 'varchar', length: 20, nullable: false, default: 'register' })
  purpose: OtpPurpose;

  @Column({ type: 'varchar', length: 10, nullable: false })
  code: string;

  @Column({ type: 'timestamp with time zone', nullable: false })
  expireAt: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  usedAt: Date | null;

  @Column({ type: 'int', nullable: false, default: 0 })
  attempts: number;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;
}
