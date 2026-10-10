import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post, Put, QueryParams, Req } from 'routing-controllers';
import { Request } from 'express';
import { getRepository } from 'common-db-node/dist/db';
import { Announcement } from '../entity/announcement';
import { RecommendationSlot } from '../entity/recommendationslot';
import { UpsertAnnouncementRequest, UpsertRecommendationSlotRequest } from '../dto/community';
import { AuthorizedUser, OPS_ADMINS, badRequest, notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { isUuid, paginate } from '../component/common/util';
import { AUDIT_MODULES } from '../component/common/constants';
import { ipOf, recordAudit } from '../component/service/auditService';

/**
 * 首页运营位：公告与推荐槽。
 *
 * 与 [[HomeController]] 是同一批数据的读写两端 —— 前台只取有效期内的启用项，
 * 后台能看到全部（含已过期、已停用），否则运营无法复用旧公告。
 */
@JsonController('/v1/admin')
export class AdminContentController {
  // ---------------- 公告 ----------------

  @Get('/announcements')
  @Authorized(OPS_ADMINS)
  async listAnnouncements(@QueryParams() query: { position?: string; pageNumber?: string; pageSize?: string }) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const where = query.position ? { position: query.position } : {};

    const [items, total] = await getRepository(Announcement).findAndCount({
      where,
      order: { createTime: 'DESC' },
      skip,
      take,
    });
    return { total, items };
  }

  @Post('/announcements')
  @Authorized(OPS_ADMINS)
  async createAnnouncement(
    @CurrentUser() current: AuthorizedUser,
    @Body({ validate: true }) body: UpsertAnnouncementRequest,
    @Req() req: Request
  ) {
    const repository = getRepository(Announcement);
    const announcement = repository.create({
      title: body.title,
      // content 是 NOT NULL DEFAULT ''，不是可空列
      content: body.content ?? '',
      position: body.position ?? 'home_top',
      startAt: body.startAt ? new Date(body.startAt) : null,
      endAt: body.endAt ? new Date(body.endAt) : null,
      isActive: body.isActive ?? true,
    });
    this.assertWindow(announcement.startAt, announcement.endAt);
    await repository.save(announcement);

    await recordAudit({
      adminName: current.name,
      action: '新建公告',
      module: AUDIT_MODULES.system,
      targetType: 'announcement',
      targetId: announcement.id,
      details: { title: announcement.title, position: announcement.position },
      ip: ipOf(req),
    });

    return announcement;
  }

  @Put('/announcements/:id')
  @Authorized(OPS_ADMINS)
  async updateAnnouncement(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body({ validate: true }) body: UpsertAnnouncementRequest,
    @Req() req: Request
  ) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.invalid_request, '公告不存在');
    }
    const repository = getRepository(Announcement);
    const announcement = await repository.findOne({ where: { id } });
    if (!announcement) {
      throw notFound(ResponseCode.invalid_request, '公告不存在');
    }

    announcement.title = body.title;
    announcement.content = body.content ?? '';
    announcement.position = body.position ?? announcement.position;
    announcement.startAt = body.startAt ? new Date(body.startAt) : null;
    announcement.endAt = body.endAt ? new Date(body.endAt) : null;
    announcement.isActive = body.isActive ?? announcement.isActive;
    this.assertWindow(announcement.startAt, announcement.endAt);
    await repository.save(announcement);

    await recordAudit({
      adminName: current.name,
      action: '更新公告',
      module: AUDIT_MODULES.system,
      targetType: 'announcement',
      targetId: id,
      details: { title: announcement.title },
      ip: ipOf(req),
    });

    return announcement;
  }

  @Delete('/announcements/:id')
  @Authorized(OPS_ADMINS)
  async removeAnnouncement(@CurrentUser() current: AuthorizedUser, @Param('id') id: string, @Req() req: Request): Promise<{ deleted: true }> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.invalid_request, '公告不存在');
    }
    const repository = getRepository(Announcement);
    const announcement = await repository.findOne({ where: { id } });
    if (!announcement) {
      throw notFound(ResponseCode.invalid_request, '公告不存在');
    }
    // 公告没有软删列，也无互动数据挂在它下面
    await repository.remove(announcement);

    await recordAudit({
      adminName: current.name,
      action: '删除公告',
      module: AUDIT_MODULES.system,
      targetType: 'announcement',
      targetId: id,
      details: { title: announcement.title },
      ip: ipOf(req),
    });
    return { deleted: true };
  }

  // ---------------- 推荐槽 ----------------

  /** 推荐槽列表。可按 slotKey 过滤，后台按「槽位 → 组内顺序」展示。 */
  @Get('/recommendation-slots')
  @Authorized(OPS_ADMINS)
  async listSlots(@QueryParams() query: { slotKey?: string; pageNumber?: string; pageSize?: string }) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const where = query.slotKey ? { slotKey: query.slotKey } : {};

    const [items, total] = await getRepository(RecommendationSlot).findAndCount({
      where,
      order: { slotKey: 'ASC', sortOrder: 'ASC' },
      skip,
      take,
    });
    return { total, items };
  }

  @Post('/recommendation-slots')
  @Authorized(OPS_ADMINS)
  async createSlot(
    @CurrentUser() current: AuthorizedUser,
    @Body({ validate: true }) body: UpsertRecommendationSlotRequest,
    @Req() req: Request
  ) {
    const repository = getRepository(RecommendationSlot);
    // 同一槽位内同一目标只应出现一次，否则前台会渲染出重复卡片
    const duplicate = await repository.findOne({ where: { slotKey: body.slotKey, targetType: body.targetType, targetId: body.targetId } });
    if (duplicate) {
      throw badRequest(ResponseCode.invalid_request, '该内容已在此推荐位中');
    }

    const slot = repository.create({
      slotKey: body.slotKey,
      targetType: body.targetType,
      targetId: body.targetId,
      sortOrder: body.sortOrder ?? 0,
      startAt: body.startAt ? new Date(body.startAt) : null,
      endAt: body.endAt ? new Date(body.endAt) : null,
      isActive: body.isActive ?? true,
    });
    this.assertWindow(slot.startAt, slot.endAt);
    await repository.save(slot);

    await recordAudit({
      adminName: current.name,
      action: '新增推荐位',
      module: AUDIT_MODULES.system,
      targetType: 'recommendationslot',
      targetId: slot.id,
      details: { slotKey: slot.slotKey, targetType: slot.targetType, targetId: slot.targetId },
      ip: ipOf(req),
    });

    return slot;
  }

  @Put('/recommendation-slots/:id')
  @Authorized(OPS_ADMINS)
  async updateSlot(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body({ validate: true }) body: UpsertRecommendationSlotRequest,
    @Req() req: Request
  ) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.invalid_request, '推荐位不存在');
    }
    const repository = getRepository(RecommendationSlot);
    const slot = await repository.findOne({ where: { id } });
    if (!slot) {
      throw notFound(ResponseCode.invalid_request, '推荐位不存在');
    }

    slot.slotKey = body.slotKey;
    slot.targetType = body.targetType;
    slot.targetId = body.targetId;
    slot.sortOrder = body.sortOrder ?? slot.sortOrder;
    slot.startAt = body.startAt ? new Date(body.startAt) : null;
    slot.endAt = body.endAt ? new Date(body.endAt) : null;
    slot.isActive = body.isActive ?? slot.isActive;
    this.assertWindow(slot.startAt, slot.endAt);
    await repository.save(slot);

    await recordAudit({
      adminName: current.name,
      action: '更新推荐位',
      module: AUDIT_MODULES.system,
      targetType: 'recommendationslot',
      targetId: id,
      details: { slotKey: slot.slotKey, isActive: slot.isActive },
      ip: ipOf(req),
    });

    return slot;
  }

  @Delete('/recommendation-slots/:id')
  @Authorized(OPS_ADMINS)
  async removeSlot(@CurrentUser() current: AuthorizedUser, @Param('id') id: string, @Req() req: Request): Promise<{ deleted: true }> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.invalid_request, '推荐位不存在');
    }
    const repository = getRepository(RecommendationSlot);
    const slot = await repository.findOne({ where: { id } });
    if (!slot) {
      throw notFound(ResponseCode.invalid_request, '推荐位不存在');
    }
    // 推荐槽是纯配置行，删掉不影响被推荐的内容本身
    await repository.remove(slot);

    await recordAudit({
      adminName: current.name,
      action: '删除推荐位',
      module: AUDIT_MODULES.system,
      targetType: 'recommendationslot',
      targetId: id,
      details: { slotKey: slot.slotKey, targetId: slot.targetId },
      ip: ipOf(req),
    });
    return { deleted: true };
  }

  /**
   * 校验有效期区间。开始时间晚于结束时间时，前台两条比较条件互斥，
   * 公告/推荐位会静默地永远不出现 —— 这类「配了却不生效」最难排查，宁可在写入口拒绝。
   */
  private assertWindow(startAt: Date | null, endAt: Date | null): void {
    if (startAt && endAt && startAt.getTime() > endAt.getTime()) {
      throw badRequest(ResponseCode.invalid_request, '开始时间不能晚于结束时间');
    }
  }
}
