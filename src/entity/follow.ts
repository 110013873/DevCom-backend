import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { FollowTargetType } from '../component/common/content';
import { User } from './user';

/**
 * 关注。关注对象是「主体」（用户 / 版块 / 标签），不是单条内容，
 * 因此不复用 [[ContentTargetType]]。
 */
@Entity('follows')
@Index('idx_follows_target', ['targetType', 'targetId'])
@Index('idx_follows_unique', ['userId', 'targetType', 'targetId'], { unique: true })
export class Follow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @Column({ type: 'varchar', length: 20, nullable: false })
  targetType: FollowTargetType;

  @Column({ type: 'uuid', nullable: false })
  targetId: string;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;
}
