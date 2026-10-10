import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 标签适用域。新闻与资源各用一类，不合并成单一枚举 ——
 * 同一个词在两类内容下的热度、运营口径都不同。
 */
export type TagType = 'news' | 'resource' | 'article' | 'topic';

export const TAG_TYPES: readonly TagType[] = ['news', 'resource', 'article', 'topic'];

/**
 * 标签。`usageCount` 为冗余计数，随关联表增删在同一事务内维护，
 * 供后台按热度排序与清理无标签使用。
 */
@Entity('tags')
@Index('idx_tags_name_type', ['name', 'type'], { unique: true })
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 20, nullable: false })
  type: TagType;

  @Column({ type: 'int', nullable: false, default: 0 })
  usageCount: number;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  updateTime: Date;
}
