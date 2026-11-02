import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Course } from './course';
import { CourseDay } from './courseday';

export type LessonType = 'markdown' | 'external';

export const LESSON_TYPES: readonly LessonType[] = ['markdown', 'external'];

/**
 * 课节。`type` 决定前台如何渲染：markdown 走正文渲染器（内容统一为 Markdown，
 * 图片/视频/文档以内嵌语法表达在 content 里），external 直接跳外链（如第三方
 * 平台课程，整节跳转，不渲染正文）。
 *
 * `isPaid` 只是**标识**：平台首版不代收第三方费用，付费课节不提供站内购买，
 * 仅提示用户前往来源站点。
 */
@Entity('lessons')
@Index('idx_lessons_course', ['courseId', 'sortOrder'])
@Index('idx_lessons_day', ['dayId', 'sortOrder'])
export class Lesson {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Course, { nullable: false, onDelete: 'CASCADE' })
  course: Course;

  @Column({ type: 'uuid', nullable: false })
  courseId: string;

  /** 可挂在某个 Day 下；为空即直接属于课程 */
  @ManyToOne(() => CourseDay, { nullable: true, onDelete: 'CASCADE' })
  day: CourseDay | null;

  @Column({ type: 'uuid', nullable: true })
  dayId: string | null;

  @Column({ type: 'varchar', length: 200, nullable: false })
  title: string;

  @Column({ type: 'varchar', length: 20, nullable: false, default: 'markdown' })
  type: LessonType;

  /** 课时正文（Markdown，唯一内容载体；媒体以内嵌语法表达） */
  @Column({ type: 'text', nullable: false, default: '' })
  content: string;

  /** 仅 external 类型整节跳转使用 */
  @Column({ type: 'text', nullable: true })
  externalUrl: string | null;

  @Column({ type: 'boolean', nullable: false, default: false })
  isPaid: boolean;

  /** 预计时长（分钟），用于「约 X 分钟」提示 */
  @Column({ type: 'int', nullable: true })
  duration: number | null;

  @Column({ type: 'int', nullable: false, default: 0 })
  sortOrder: number;
}
