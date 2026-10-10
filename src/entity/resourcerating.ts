import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Resource } from './resource';
import { User } from './user';

/**
 * 资源评分。唯一约束 (resourceId, userId) 表示「每人每资源一份有效评分」，
 * 改分走更新而非新增。资源上的 `ratingAvg` / `ratingCount` 由服务层在
 * 同一事务内重算，避免读时聚合。
 */
@Entity('resource_ratings')
@Index('idx_resource_ratings_resource', ['resourceId'])
@Index('idx_resource_ratings_unique', ['resourceId', 'userId'], { unique: true })
export class ResourceRating {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Resource, { nullable: false, onDelete: 'CASCADE' })
  resource: Resource;

  @Column({ type: 'uuid', nullable: false })
  resourceId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'uuid', nullable: false })
  userId: string;

  /** 1–5 分，取值范围由服务端校验（对应 ResponseCode.rating_out_of_range） */
  @Column({ type: 'smallint', nullable: false })
  score: number;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  updateTime: Date;
}
