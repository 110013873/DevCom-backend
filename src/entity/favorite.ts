import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ContentTargetType } from '../component/common/content';
import { User } from './user';

/**
 * 收藏。与 [[Reaction]] 同构，同样以唯一约束保证同一用户对同一目标只有一条记录。
 */
@Entity('favorites')
@Index('idx_favorites_target', ['targetType', 'targetId'])
@Index('idx_favorites_user', ['userId', 'createTime'])
@Index('idx_favorites_unique', ['userId', 'targetType', 'targetId'], { unique: true })
export class Favorite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @Column({ type: 'varchar', length: 20, nullable: false })
  targetType: ContentTargetType;

  @Column({ type: 'uuid', nullable: false })
  targetId: string;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;
}
