import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 管理操作审计日志。参照 portal 的 OperationLogEntity，增加 target 与 reason 便于追溯。
 */
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  adminName: string;

  @Index('idx_audit_logs_user')
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: false })
  action: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  module: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  targetType: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  targetId: string | null;

  /** success | warning | danger */
  @Column({ type: 'varchar', length: 20, nullable: false, default: 'success' })
  status: string;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string | null;

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, unknown> | null;

  @Index('idx_audit_logs_create_time')
  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;
}
