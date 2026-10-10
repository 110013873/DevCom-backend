import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Resource } from './resource';
import { Tag } from './tag';

/**
 * 资源 ↔ 标签关联表。与 [[NewsTag]] 同构，独立成表以保持各自的唯一约束与计数语义。
 */
@Entity('resource_tags')
@Index('idx_resource_tags_resource', ['resourceId'])
@Index('idx_resource_tags_tag', ['tagId'])
@Index('idx_resource_tags_unique', ['resourceId', 'tagId'], { unique: true })
export class ResourceTag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Resource, { nullable: false, onDelete: 'CASCADE' })
  resource: Resource;

  @Column({ type: 'uuid', nullable: false })
  resourceId: string;

  @ManyToOne(() => Tag, { nullable: false, onDelete: 'CASCADE' })
  tag: Tag;

  @Column({ type: 'uuid', nullable: false })
  tagId: string;
}
