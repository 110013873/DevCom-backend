import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type CourseStatus = 'draft' | 'published' | 'archived';
export type CourseLevel = 'beginner' | 'intermediate' | 'advanced';

export const COURSE_LEVELS: readonly CourseLevel[] = ['beginner', 'intermediate', 'advanced'];

/**
 * 培养课程（含原 Triton 十天课）。课节结构为 Course → CourseDay → Lesson，
 * Day 用于「Day1–7 学习 / Day8–10 实践」这类分段展示。
 */
@Entity('courses')
@Index('idx_courses_status_sort', ['status', 'sortOrder'])
export class Course {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200, nullable: false })
  title: string;

  @Column({ type: 'text', nullable: true })
  coverImage: string | null;

  @Column({ type: 'varchar', length: 20, nullable: false, default: 'beginner' })
  level: CourseLevel;

  /** 技术方向，如 riscv / ai / toolchain */
  @Column({ type: 'varchar', length: 40, nullable: true })
  direction: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  instructor: string | null;

  /** 课程时长说明，自由文本（如「10 天 · 约 20 学时」） */
  @Column({ type: 'varchar', length: 60, nullable: true })
  duration: string | null;

  /** 先修要求，一行一条 */
  @Column({ type: 'text', nullable: true })
  prerequisites: string | null;

  @Column({ type: 'text', nullable: false, default: '' })
  description: string;

  @Column({ type: 'varchar', length: 20, nullable: false, default: 'draft' })
  status: CourseStatus;

  @Column({ type: 'int', nullable: false, default: 0 })
  sortOrder: number;

  @Column({ type: 'varchar', length: 10, nullable: false, default: 'zh' })
  lang: string;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  updateTime: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deleteTime: Date | null;
}
