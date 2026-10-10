import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { PaginationQuery } from '../component/common/types';
import { COURSE_LEVELS, CourseLevel, CourseStatus } from '../entity/course';
import { LESSON_TYPES } from '../entity/lesson';

const COURSE_STATUSES: readonly CourseStatus[] = ['draft', 'published', 'archived'];

/** 前台课程列表查询 */
export class CourseQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(COURSE_LEVELS, { message: '未知的课程难度' })
  level?: CourseLevel;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  direction?: string;

  /** 仅后台读取，前台强制只出 published */
  @IsOptional()
  @IsIn(COURSE_STATUSES, { message: '未知的课程状态' })
  status?: CourseStatus;
}

/** 写 / 更新课程（后台） */
export class UpsertCourseRequest {
  @IsString({ message: '课程标题不能为空' })
  @Length(1, 200, { message: '课程标题长度需在 1-200 字之间' })
  title: string;

  @IsOptional()
  @IsString()
  coverImage?: string;

  @IsOptional()
  @IsIn(COURSE_LEVELS, { message: '未知的课程难度' })
  level?: (typeof COURSE_LEVELS)[number];

  @IsOptional()
  @IsString()
  @Length(0, 40)
  direction?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  instructor?: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  duration?: string;

  @IsOptional()
  @IsString()
  prerequisites?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(COURSE_STATUSES, { message: '未知的课程状态' })
  status?: CourseStatus;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

/** 写 / 更新课程中的一天（后台） */
export class UpsertCourseDayRequest {
  @IsInt({ message: 'Day 序号必须是整数' })
  @Min(1, { message: 'Day 序号不能小于 1' })
  dayNumber: number;

  @IsString({ message: 'Day 标题不能为空' })
  @Length(1, 200, { message: 'Day 标题长度需在 1-200 字之间' })
  title: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

/** 写 / 更新课节（后台） */
export class UpsertLessonRequest {
  @IsString({ message: '课节标题不能为空' })
  @Length(1, 200, { message: '课节标题长度需在 1-200 字之间' })
  title: string;

  /** 挂到某个 Day 下；为空即直接属于课程 */
  @IsOptional()
  @IsUUID('all', { message: 'Day id 格式不正确' })
  dayId?: string;

  @IsOptional()
  @IsIn(LESSON_TYPES, { message: '未知的课节类型' })
  type?: (typeof LESSON_TYPES)[number];

  @IsOptional()
  @IsString()
  content?: string;

  /** type=external 时必填，指向第三方来源站点 */
  @IsOptional()
  @IsString()
  externalUrl?: string;

  /** 付费标识。平台不代收第三方费用，仅作展示与来源跳转提示 */
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0, { message: '时长不能为负' })
  duration?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
