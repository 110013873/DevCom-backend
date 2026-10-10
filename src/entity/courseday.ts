import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Course } from './course';

/**
 * 课程中的一天（Day1–Day10）。仅作分组与展示顺序，不含内容本身 ——
 * 内容在 [[Lesson]]。
 */
@Entity('course_days')
@Index('idx_course_days_course', ['courseId', 'sortOrder'])
export class CourseDay {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Course, { nullable: false, onDelete: 'CASCADE' })
  course: Course;

  @Column({ type: 'uuid', nullable: false })
  courseId: string;

  @Column({ type: 'int', nullable: false })
  dayNumber: number;

  @Column({ type: 'varchar', length: 200, nullable: false })
  title: string;

  @Column({ type: 'int', nullable: false, default: 0 })
  sortOrder: number;
}
