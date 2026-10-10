import { Get, JsonController, Param, QueryParams } from 'routing-controllers';
import { getRepository } from 'common-db-node/dist/db';
import { Course } from '../entity/course';
import { CourseDay } from '../entity/courseday';
import { Lesson } from '../entity/lesson';
import { CourseQuery } from '../dto/course';
import { notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { isUuid, paginate } from '../component/common/util';
import { SORTABLE_FIELDS } from '../component/common/constants';

/**
 * 课程接口。
 *
 * 目录结构与正文分开取：列表页与详情页首屏只需要 Day/Lesson 的标题与顺序，
 * 把 21 节课的正文一并塞进详情响应会让首屏多传几十 KB 无用内容，
 * 因此详情只返回课节目录（无 content），正文由 /:courseId/lessons/:lessonId 单独取。
 */
@JsonController('/v1/courses')
export class CourseController {
  /** 课程列表：难度 / 方向 / 分页 */
  @Get('/')
  async list(@QueryParams() query: CourseQuery) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const sortField = SORTABLE_FIELDS.course.includes(query.sort ?? '') ? (query.sort as string) : 'sortOrder';
    const order: 'ASC' | 'DESC' = query.order === 'DESC' ? 'DESC' : 'ASC';

    const builder = getRepository(Course).createQueryBuilder('course')
      .where('course.status = :status', { status: 'published' });

    if (query.level) {
      builder.andWhere('course.level = :level', { level: query.level });
    }
    if (query.direction) {
      builder.andWhere('course.direction = :direction', { direction: query.direction });
    }

    const [rows, total] = await builder
      .orderBy(`course.${sortField}`, order)
      .addOrderBy('course.createTime', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();

    return {
      total,
      items: rows.map(row => ({
        id: row.id,
        title: row.title,
        coverImage: row.coverImage,
        level: row.level,
        direction: row.direction,
        instructor: row.instructor,
        duration: row.duration,
        description: row.description,
      })),
    };
  }

  /** 课程详情：含 Day / Lesson 目录（不含课节正文） */
  @Get('/:id')
  async detail(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }

    const course = await getRepository(Course).findOne({ where: { id, status: 'published' } });
    if (!course) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }

    const [days, lessons] = await Promise.all([
      getRepository(CourseDay).find({ where: { courseId: id }, order: { sortOrder: 'ASC', dayNumber: 'ASC' } }),
      getRepository(Lesson).find({ where: { courseId: id }, order: { sortOrder: 'ASC' } }),
    ]);

    const shape = (lesson: Lesson) => ({
      id: lesson.id,
      dayId: lesson.dayId,
      title: lesson.title,
      type: lesson.type,
      // 正文不在此下发，见类注释；external 类型的前端直接跳 externalUrl
      externalUrl: lesson.externalUrl,
      isPaid: lesson.isPaid,
      duration: lesson.duration,
      sortOrder: lesson.sortOrder,
    });

    // 未挂 Day 的课节单独成组，避免它们在目录里凭空消失
    const loose = lessons.filter(lesson => !lesson.dayId).map(shape);

    return {
      id: course.id,
      title: course.title,
      coverImage: course.coverImage,
      level: course.level,
      direction: course.direction,
      instructor: course.instructor,
      duration: course.duration,
      prerequisites: course.prerequisites,
      description: course.description,
      updateTime: course.updateTime,
      days: days.map(day => ({
        id: day.id,
        dayNumber: day.dayNumber,
        title: day.title,
        lessons: lessons.filter(lesson => lesson.dayId === day.id).map(shape),
      })),
      lessons: loose,
      lessonCount: lessons.length,
    };
  }

  /** 单个课节正文。markdown 类型返回 content，external 类型返回外链，二者互斥。 */
  @Get('/:courseId/lessons/:lessonId')
  async lesson(@Param('courseId') courseId: string, @Param('lessonId') lessonId: string) {
    if (!isUuid(courseId) || !isUuid(lessonId)) {
      throw notFound(ResponseCode.lesson_not_found, '课节不存在');
    }

    // 先确认课程对前台可见，防止用未发布课程的 id 猜测课节
    const course = await getRepository(Course).findOne({ where: { id: courseId, status: 'published' }, select: ['id', 'title'] });
    if (!course) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }

    const lesson = await getRepository(Lesson).findOne({ where: { id: lessonId, courseId } });
    if (!lesson) {
      throw notFound(ResponseCode.lesson_not_found, '课节不存在');
    }

    return {
      id: lesson.id,
      courseId: lesson.courseId,
      courseTitle: course.title,
      dayId: lesson.dayId,
      title: lesson.title,
      type: lesson.type,
      content: lesson.content,
      externalUrl: lesson.externalUrl,
      isPaid: lesson.isPaid,
      duration: lesson.duration,
    };
  }

  /** 课程下的全部课节（扁平，含正文），供学习页一次性拉取 */
  @Get('/:courseId/lessons')
  async lessons(@Param('courseId') courseId: string) {
    if (!isUuid(courseId)) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }
    const course = await getRepository(Course).findOne({ where: { id: courseId, status: 'published' }, select: ['id'] });
    if (!course) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }

    const lessons = await getRepository(Lesson).find({
      where: { courseId },
      order: { sortOrder: 'ASC' },
    });
    return { total: lessons.length, items: lessons };
  }
}
