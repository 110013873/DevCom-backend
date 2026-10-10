import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Resource } from './resource';

export type ResourceVersionStatus = 'draft' | 'published' | 'archived';

export const RESOURCE_VERSION_STATUSES: readonly ResourceVersionStatus[] = ['draft', 'published', 'archived'];

/**
 * 资源的某个版本。默认版本互斥（同一 resourceId 下至多一条 isDefault=true），
 * 切换默认版本必须在事务内完成：先把旧默认置 false，再置新版本为 true。
 *
 * 文件不放在这一层 —— 一个版本可以有多个架构 / 系统的文件，见 [[ResourceFile]]。
 */
@Entity('resource_versions')
@Index('idx_resource_versions_resource', ['resourceId', 'createTime'])
@Index('idx_resource_versions_default', ['resourceId', 'isDefault'])
export class ResourceVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Resource, { nullable: false, onDelete: 'CASCADE' })
  resource: Resource;

  @Column({ type: 'uuid', nullable: false })
  resourceId: string;

  @Column({ type: 'varchar', length: 40, nullable: false })
  version: string;

  @Column({ type: 'varchar', length: 160, nullable: false })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  changelog: string | null;

  @Column({ type: 'boolean', nullable: false, default: false })
  isDefault: boolean;

  @Column({ type: 'text', nullable: true })
  giteeUrl: string | null;

  @Column({ type: 'text', nullable: true })
  githubUrl: string | null;

  @Column({ type: 'varchar', length: 20, nullable: false, default: 'published' })
  status: ResourceVersionStatus;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  updateTime: Date;
}
