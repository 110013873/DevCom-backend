import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { User } from './user';
import { Role } from './role';

/** 授权范围：全局 / 版块 / 班级 / 项目。首期只用到 global，其余为后续阶段预留。 */
export type ScopeType = 'global' | 'board' | 'cohort' | 'project';

/**
 * 用户与角色的关联，支持按范围授权（合并原计划的 ScopedGrant）。
 */
@Entity('user_roles')
@Unique('uq_user_roles_user_role_scope', ['userId', 'roleId', 'scopeType', 'scopeId'])
export class UserRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_user_roles_user')
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @Column({ type: 'uuid', nullable: false })
  roleId: string;

  @Column({ type: 'varchar', length: 20, nullable: false, default: 'global' })
  scopeType: ScopeType;

  @Column({ type: 'varchar', length: 64, nullable: false, default: '' })
  scopeId: string;

  @ManyToOne(() => User, user => user.userRoles, { onDelete: 'CASCADE' })
  user: User;

  @ManyToOne(() => Role, role => role.userRoles, { onDelete: 'CASCADE', eager: true })
  role: Role;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;
}
