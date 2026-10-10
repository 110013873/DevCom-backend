import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { UserRole } from './userrole';

/**
 * 角色基线（功能清单 §18.3）。code 为权限判定依据，name 供后台展示。
 */
@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_roles_code', { unique: true })
  @Column({ type: 'varchar', length: 40, nullable: false })
  code: string;

  @Column({ type: 'varchar', length: 60, nullable: false })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 内置角色不允许后台删除 */
  @Column({ type: 'boolean', nullable: false, default: false })
  isSystem: boolean;

  @OneToMany(() => UserRole, userRole => userRole.role)
  userRoles: UserRole[];

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  updateTime: Date;
}
