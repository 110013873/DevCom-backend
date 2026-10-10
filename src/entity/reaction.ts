import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ContentTargetType } from '../component/common/content';
import { User } from './user';

/**
 * 点赞。唯一约束 (userId, targetType, targetId) 是点赞去重的**唯一依据** ——
 * 并发重复提交由数据库兜底，服务层不做「先查再插」的乐观假设。
 */
@Entity('reactions')
@Index('idx_reactions_target', ['targetType', 'targetId'])
@Index('idx_reactions_unique', ['userId', 'targetType', 'targetId'], { unique: true })
export class Reaction {
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
