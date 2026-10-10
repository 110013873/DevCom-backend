import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 首页推荐位。按 `slotKey` 分组（如 home_banner / home_featured_resource），
 * 组内按 `sortOrder` 排序，`targetType` + `targetId` 指向被推荐的对象。
 *
 * 不做外键约束：推荐位是**运营配置**，目标类型横跨新闻/资源/课程，
 * 无法用单一外键表达；目标被删时由前台跳过该槽位。
 */
@Entity('recommendation_slots')
@Index('idx_recommendation_slots_key', ['slotKey', 'sortOrder'])
export class RecommendationSlot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 60, nullable: false })
  slotKey: string;

  @Column({ type: 'varchar', length: 30, nullable: false })
  targetType: string;

  @Column({ type: 'uuid', nullable: false })
  targetId: string;

  @Column({ type: 'int', nullable: false, default: 0 })
  sortOrder: number;

  @Column({ type: 'timestamp with time zone', nullable: true })
  startAt: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  endAt: Date | null;

  @Column({ type: 'boolean', nullable: false, default: true })
  isActive: boolean;

  @UpdateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  updateTime: Date;
}
