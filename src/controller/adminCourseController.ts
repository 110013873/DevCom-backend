import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post, Put, QueryParams, Req } from 'routing-controllers';
import { Request } from 'express';
import { getRepository } from 'common-db-node/dist/db';
import { Course } from '../entity/course';
import { CourseDay } from '../entity/courseday';
import { Lesson } from '../entity/lesson';
import { CourseQuery, UpsertCourseDayRequest, UpsertCourseRequest, UpsertLessonRequest } from '../dto/course';
import { AuthorizedUser, OPS_ADMINS, notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { escapeLike, isUuid, paginate } from '../component/common/util';
import { AUDIT_MODULES, SORTABLE_FIELDS } from '../component/common/constants';
import { ipOf, recordAudit } from '../component/service/auditService';

/**
 * 后台课程管理：课程 → Day → 课节三层。
 *
 * 课节可以在 Day 下，也可以直接挂在课程下（`dayId` 为空）。无论哪种，
 * 写入口都要校验「Day 属于本课程」，否则会把课节挂到别的课程的 Day 上，
 * 前台按课程序列化目录时就丢课节。
 */
@JsonController('/v1/admin/courses')
export class AdminCourseController {
  // ---------------- 课程 ----------------

  /** 课程列表（含草稿与归档） */
  @Get('/')
  @Authorized(OPS_ADMINS)
  async list(@QueryParams() query: CourseQuery) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const sortField = SORTABLE_FIELDS.course.includes(query.sort ?? '') ? (query.sort as string) : 'sortOrder';
    const order: 'ASC' | 'DESC' = query.order === 'DESC' ? 'DESC' : 'ASC';

    const builder = getRepository(Course).createQueryBuilder('course');
    if (query.status) {
      builder.andWhere('course.status = :status', { status: query.status });
    }
    if (query.level) {
      builder.andWhere('course.level = :level', { level: query.level });
    }
    if (query.direction) {
      builder.andWhere('course.direction = :direction', { direction: query.direction });
    }
    if (query.keyword) {
      const keyword = `%${escapeLike(query.keyword)}%`;
      builder.andWhere('(course.title ILIKE :keyword OR course.instructor ILIKE :keyword)', { keyword });
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
        status: row.status,
        sortOrder: row.sortOrder,
        createTime: row.createTime,
        updateTime: row.updateTime,
      })),
    };
  }

  /** 课程详情，附带 Day 与课节目录（含课节正文，供编辑回填） */
  @Get('/:id')
  @Authorized(OPS_ADMINS)
  async detail(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }
    const course = await getRepository(Course).findOne({ where: { id } });
    if (!course) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }

    const [days, lessons] = await Promise.all([
      getRepository(CourseDay).find({ where: { courseId: id }, order: { sortOrder: 'ASC', dayNumber: 'ASC' } }),
      getRepository(Lesson).find({ where: { courseId: id }, order: { sortOrder: 'ASC', id: 'ASC' } }),
    ]);

    return { ...course, days, lessons };
  }

  @Post('/')
  @Authorized(OPS_ADMINS)
  async create(@CurrentUser() current: AuthorizedUser, @Body({ validate: true }) body: UpsertCourseRequest, @Req() req: Request) {
    const repository = getRepository(Course);
    const course = repository.create({
      title: body.title,
      coverImage: body.coverImage ?? null,
      level: body.level ?? 'beginner',
      direction: body.direction ?? null,
      instructor: body.instructor ?? null,
      duration: body.duration ?? null,
      prerequisites: body.prerequisites ?? null,
      // description 是 NOT NULL DEFAULT ''，不是可空列
      description: body.description ?? '',
      status: body.status ?? 'draft',
      sortOrder: body.sortOrder ?? 0,
      createdById: current.id,
    });
    await repository.save(course);

    await recordAudit({
      adminName: current.name,
      action: '新建课程',
      module: AUDIT_MODULES.course,
      targetType: 'course',
      targetId: course.id,
      details: { title: course.title, status: course.status },
      ip: ipOf(req),
    });

    return course;
  }

  @Put('/:id')
  @Authorized(OPS_ADMINS)
  async update(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body({ validate: true }) body: UpsertCourseRequest,
    @Req() req: Request
  ) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }
    const repository = getRepository(Course);
    const course = await repository.findOne({ where: { id } });
    if (!course) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }

    course.title = body.title;
    course.coverImage = body.coverImage ?? null;
    course.level = body.level ?? course.level;
    course.direction = body.direction ?? null;
    course.instructor = body.instructor ?? null;
    course.duration = body.duration ?? null;
    course.prerequisites = body.prerequisites ?? null;
    course.description = body.description ?? '';
    course.status = body.status ?? course.status;
    course.sortOrder = body.sortOrder ?? course.sortOrder;
    await repository.save(course);

    await recordAudit({
      adminName: current.name,
      action: '更新课程',
      module: AUDIT_MODULES.course,
      targetType: 'course',
      targetId: id,
      details: { title: course.title, status: course.status },
      ip: ipOf(req),
    });

    return course;
  }

  /** 删除课程。软删：Day 与课节通过外键级联，但软删保住课程本体可恢复。 */
  @Delete('/:id')
  @Authorized(OPS_ADMINS)
  async remove(@CurrentUser() current: AuthorizedUser, @Param('id') id: string, @Req() req: Request): Promise<{ deleted: true }> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }
    const repository = getRepository(Course);
    const course = await repository.findOne({ where: { id } });
    if (!course) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }
    await repository.softRemove(course);

    await recordAudit({
      adminName: current.name,
      action: '删除课程',
      module: AUDIT_MODULES.course,
      targetType: 'course',
      targetId: id,
      details: { title: course.title },
      ip: ipOf(req),
    });
    return { deleted: true };
  }

  // ---------------- Day ----------------

  @Get('/:id/days')
  @Authorized(OPS_ADMINS)
  async days(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }
    const rows = await getRepository(CourseDay).find({
      where: { courseId: id },
      order: { sortOrder: 'ASC', dayNumber: 'ASC' },
    });
    return { total: rows.length, items: rows };
  }

  @Post('/:id/days')
  @Authorized(OPS_ADMINS)
  async createDay(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body({ validate: true }) body: UpsertCourseDayRequest,
    @Req() req: Request
  ) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }
    const course = await getRepository(Course).findOne({ where: { id }, select: ['id'] });
    if (!course) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }

    const repository = getRepository(CourseDay);
    const day = repository.create({
      courseId: id,
      dayNumber: body.dayNumber,
      title: body.title,
      // 未显式排序时按 dayNumber 排，避免新加的 Day 落到末尾之外的位置
      sortOrder: body.sortOrder ?? body.dayNumber,
    });
    await repository.save(day);

    await recordAudit({
      adminName: current.name,
      action: '新增课程 Day',
      module: AUDIT_MODULES.course,
      targetType: 'courseday',
      targetId: day.id,
      details: { courseId: id, dayNumber: day.dayNumber, title: day.title },
      ip: ipOf(req),
    });

    return day;
  }

  @Put('/:courseId/days/:dayId')
  @Authorized(OPS_ADMINS)
  async updateDay(
    @CurrentUser() current: AuthorizedUser,
    @Param('courseId') courseId: string,
    @Param('dayId') dayId: string,
    @Body({ validate: true }) body: UpsertCourseDayRequest,
    @Req() req: Request
  ) {
    if (!isUuid(courseId) || !isUuid(dayId)) {
      throw notFound(ResponseCode.invalid_request, '课程 Day 不存在');
    }
    const repository = getRepository(CourseDay);
    const day = await repository.findOne({ where: { id: dayId, courseId } });
    if (!day) {
      throw notFound(ResponseCode.invalid_request, '课程 Day 不存在');
    }

    day.dayNumber = body.dayNumber;
    day.title = body.title;
    day.sortOrder = body.sortOrder ?? day.sortOrder;
    await repository.save(day);

    await recordAudit({
      adminName: current.name,
      action: '更新课程 Day',
      module: AUDIT_MODULES.course,
      targetType: 'courseday',
      targetId: dayId,
      details: { courseId, dayNumber: day.dayNumber, title: day.title },
      ip: ipOf(req),
    });

    return day;
  }

  /**
   * 删除 Day。注意 `lessons.dayId` 的外键是 `ON DELETE CASCADE`，因此这会
   * **连同该 Day 下的所有课节一起删掉**，课节正文不会保留为「直接属于课程」。
   * 删除前若只想调整分组，应改课节的 `dayId` 而不是删 Day。
   */
  @Delete('/:courseId/days/:dayId')
  @Authorized(OPS_ADMINS)
  async removeDay(
    @CurrentUser() current: AuthorizedUser,
    @Param('courseId') courseId: string,
    @Param('dayId') dayId: string,
    @Req() req: Request
  ): Promise<{ deleted: true }> {
    if (!isUuid(courseId) || !isUuid(dayId)) {
      throw notFound(ResponseCode.invalid_request, '课程 Day 不存在');
    }
    const day = await getRepository(CourseDay).findOne({ where: { id: dayId, courseId } });
    if (!day) {
      throw notFound(ResponseCode.invalid_request, '课程 Day 不存在');
    }
    await getRepository(CourseDay).remove(day);

    await recordAudit({
      adminName: current.name,
      action: '删除课程 Day',
      module: AUDIT_MODULES.course,
      targetType: 'courseday',
      targetId: dayId,
      details: { courseId, dayNumber: day.dayNumber, title: day.title },
      ip: ipOf(req),
    });
    return { deleted: true };
  }

  // ---------------- 课节 ----------------

  @Get('/:id/lessons')
  @Authorized(OPS_ADMINS)
  async lessons(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }
    const rows = await getRepository(Lesson).find({
      where: { courseId: id },
      // Lesson 没有时间戳列，用 id 作稳定次级排序，保证同 sortOrder 时顺序不随机
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    return { total: rows.length, items: rows };
  }

  @Post('/:id/lessons')
  @Authorized(OPS_ADMINS)
  async createLesson(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body({ validate: true }) body: UpsertLessonRequest,
    @Req() req: Request
  ) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }
    const course = await getRepository(Course).findOne({ where: { id }, select: ['id'] });
    if (!course) {
      throw notFound(ResponseCode.course_not_found, '课程不存在');
    }
    await this.assertDayBelongsToCourse(id, body.dayId);

    const repository = getRepository(Lesson);
    const lesson = repository.create({
      courseId: id,
      dayId: body.dayId ?? null,
      title: body.title,
      type: body.type ?? 'markdown',
      // content 是 NOT NULL DEFAULT ''，不是可空列
      content: body.content ?? '',
      externalUrl: body.externalUrl ?? null,
      isPaid: body.isPaid ?? false,
      duration: body.duration ?? null,
      sortOrder: body.sortOrder ?? 0,
    });
    await repository.save(lesson);

    await recordAudit({
      adminName: current.name,
      action: '新增课节',
      module: AUDIT_MODULES.course,
      targetType: 'lesson',
      targetId: lesson.id,
      details: { courseId: id, title: lesson.title, type: lesson.type },
      ip: ipOf(req),
    });

    return lesson;
  }

  @Put('/:courseId/lessons/:lessonId')
  @Authorized(OPS_ADMINS)
  async updateLesson(
    @CurrentUser() current: AuthorizedUser,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Body({ validate: true }) body: UpsertLessonRequest,
    @Req() req: Request
  ) {
    if (!isUuid(courseId) || !isUuid(lessonId)) {
      throw notFound(ResponseCode.lesson_not_found, '课节不存在');
    }
    const repository = getRepository(Lesson);
    const lesson = await repository.findOne({ where: { id: lessonId, courseId } });
    if (!lesson) {
      throw notFound(ResponseCode.lesson_not_found, '课节不存在');
    }
    await this.assertDayBelongsToCourse(courseId, body.dayId);

    lesson.dayId = body.dayId ?? null;
    lesson.title = body.title;
    lesson.type = body.type ?? lesson.type;
    lesson.content = body.content ?? '';
    lesson.externalUrl = body.externalUrl ?? null;
    lesson.isPaid = body.isPaid ?? lesson.isPaid;
    lesson.duration = body.duration ?? lesson.duration;
    lesson.sortOrder = body.sortOrder ?? lesson.sortOrder;
    await repository.save(lesson);

    await recordAudit({
      adminName: current.name,
      action: '更新课节',
      module: AUDIT_MODULES.course,
      targetType: 'lesson',
      targetId: lessonId,
      details: { courseId, title: lesson.title, type: lesson.type },
      ip: ipOf(req),
    });

    return lesson;
  }

  @Delete('/:courseId/lessons/:lessonId')
  @Authorized(OPS_ADMINS)
  async removeLesson(
    @CurrentUser() current: AuthorizedUser,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Req() req: Request
  ): Promise<{ deleted: true }> {
    if (!isUuid(courseId) || !isUuid(lessonId)) {
      throw notFound(ResponseCode.lesson_not_found, '课节不存在');
    }
    const repository = getRepository(Lesson);
    const lesson = await repository.findOne({ where: { id: lessonId, courseId } });
    if (!lesson) {
      throw notFound(ResponseCode.lesson_not_found, '课节不存在');
    }
    // 课节没有软删列：它的正文就是全部价值，删掉即真删
    await repository.remove(lesson);

    await recordAudit({
      adminName: current.name,
      action: '删除课节',
      module: AUDIT_MODULES.course,
      targetType: 'lesson',
      targetId: lessonId,
      details: { courseId, title: lesson.title },
      ip: ipOf(req),
    });
    return { deleted: true };
  }

  /**
   * 校验课节要挂的 Day 确实属于本课程。不校验的话，前端传一个别的课程的
   * dayId 也能存进去，那条课节在自己的课程目录里就再也找不到了。
   */
  private async assertDayBelongsToCourse(courseId: string, dayId?: string): Promise<void> {
    if (!dayId) {
      return;
    }
    const day = await getRepository(CourseDay).findOne({ where: { id: dayId, courseId }, select: ['id'] });
    if (!day) {
      throw notFound(ResponseCode.invalid_request, '指定的课程 Day 不存在');
    }
  }
}
