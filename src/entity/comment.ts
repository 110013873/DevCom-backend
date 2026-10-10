import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ContentTargetType } from '../component/common/content';
import { User } from './user';

/** 评论状态：待审 / 已发布 / 已隐藏 */
export type CommentStatus = 'pending' | 'published' | 'hidden';

/**
 * 评论与资源反馈。新闻评论、资源使用反馈共用一张表，以 `targetType` 区分。
 *
 * `parentId` 支持一层楼中楼；不做无限嵌套 —— 前台按「主楼 + 回复列表」渲染，
 * 再深的层级对中文社区阅读体验无益，反而让审核难以追溯。
 */
@Entity('comments')
@Index('idx_comments_target', ['targetType', 'targetId', 'createTime'])
@Index('idx_comments_parent', ['parentId'])
@Index('idx_comments_user', ['userId'])
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  user: User | null;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 20, nullable: false })
  targetType: ContentTargetType;

  @Column({ type: 'uuid', nullable: false })
  targetId: string;

  /** 父评论 id；为空即主楼 */
  @Column({ type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ type: 'text', nullable: false })
  content: string;

  @Column({ type: 'varchar', length: 20, nullable: false, default: 'published' })
  status: CommentStatus;

  /** 冗余点赞数，与 [[Reaction]] 的增删在同一事务内维护 */
  @Column({ type: 'int', nullable: false, default: 0 })
  likeCount: number;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  updateTime: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deleteTime: Date | null;
}
