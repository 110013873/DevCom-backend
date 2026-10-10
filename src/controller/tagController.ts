import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post, Put, QueryParams, Req } from 'routing-controllers';
import { Request } from 'express';
import { getRepository } from 'common-db-node/dist/db';
import { Tag, TagType } from '../entity/tag';
import { TagQuery, UpsertTagRequest } from '../dto/content';
import { AuthorizedUser, OPS_ADMINS, badRequest, notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { escapeLike, isUuid, paginate } from '../component/common/util';
import { AUDIT_MODULES, SORTABLE_FIELDS } from '../component/common/constants';
import { ipOf, recordAudit } from '../component/service/auditService';

/**
 * 标签接口。
 *
 * 新闻标签与资源标签共用本控制器，由 URL 段（news-tags / resource-tags）
 * 映射到 TagType。两者结构完全相同、仅 type 取值不同，拆成两个类只会复制粘贴。
 * 读取公开（筛选条用），写入限运营管理员。
 */
@JsonController('/v1')
export class TagController {
  /** 标签列表：可按名称模糊筛选，默认按使用量降序 */
  @Get('/news-tags')
  async listNewsTags(@QueryParams() query: TagQuery) {
    return this.list('news', query);
  }

  @Get('/resource-tags')
  async listResourceTags(@QueryParams() query: TagQuery) {
    return this.list('resource', query);
  }

  /** 热门标签：首页/列表页筛选条用的 Top N */
  @Get('/news-tags/hot')
  async hotNewsTags(@QueryParams() query: { limit?: string }) {
    return this.hot('news', query.limit);
  }

  @Get('/resource-tags/hot')
  async hotResourceTags(@QueryParams() query: { limit?: string }) {
    return this.hot('resource', query.limit);
  }

  @Post('/news-tags')
  @Authorized(OPS_ADMINS)
  async createNewsTag(@CurrentUser() current: AuthorizedUser, @Body({ validate: true }) body: UpsertTagRequest, @Req() req: Request) {
    return this.create('news', current, body, req);
  }

  @Post('/resource-tags')
  @Authorized(OPS_ADMINS)
  async createResourceTag(@CurrentUser() current: AuthorizedUser, @Body({ validate: true }) body: UpsertTagRequest, @Req() req: Request) {
    return this.create('resource', current, body, req);
  }

  @Put('/news-tags/:id')
  @Authorized(OPS_ADMINS)
  async updateNewsTag(@CurrentUser() current: AuthorizedUser, @Param('id') id: string, @Body({ validate: true }) body: UpsertTagRequest, @Req() req: Request) {
    return this.update('news', current, id, body, req);
  }

  @Put('/resource-tags/:id')
  @Authorized(OPS_ADMINS)
  async updateResourceTag(@CurrentUser() current: AuthorizedUser, @Param('id') id: string, @Body({ validate: true }) body: UpsertTagRequest, @Req() req: Request) {
    return this.update('resource', current, id, body, req);
  }

  @Delete('/news-tags/:id')
  @Authorized(OPS_ADMINS)
  async removeNewsTag(@CurrentUser() current: AuthorizedUser, @Param('id') id: string, @Req() req: Request): Promise<{ deleted: true }> {
    return this.remove('news', current, id, req);
  }

  @Delete('/resource-tags/:id')
  @Authorized(OPS_ADMINS)
  async removeResourceTag(@CurrentUser() current: AuthorizedUser, @Param('id') id: string, @Req() req: Request): Promise<{ deleted: true }> {
    return this.remove('resource', current, id, req);
  }

  // ---- 以下为共用实现，type 由上面的路由固定传入，不来自请求体 ----

  private async list(type: TagType, query: TagQuery) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const order: 'ASC' | 'DESC' = query.order === 'ASC' ? 'ASC' : 'DESC';

    const builder = getRepository(Tag).createQueryBuilder('tag').where('tag.type = :type', { type });
    if (query.keyword) {
      builder.andWhere('tag.name ILIKE :keyword', { keyword: `%${escapeLike(query.keyword)}%` });
    }
    // 默认按使用量排序，列表页的标签通常也按热度读
    const sortField = ['name', 'usageCount', 'createTime'].includes(query.sort ?? '') ? (query.sort as string) : 'usageCount';

    const [items, total] = await builder
      .orderBy(`tag.${sortField}`, order)
      .addOrderBy('tag.name', 'ASC')
      .skip(skip)
      .take(take)
      .getManyAndCount();

    return { total, items };
  }

  private async hot(type: TagType, limit?: string) {
    const take = Math.min(Math.max(Number(limit ?? 20) || 20, 1), 100);
    return getRepository(Tag).find({
      where: { type },
      order: { usageCount: 'DESC', name: 'ASC' },
      take,
    });
  }

  private async create(type: TagType, current: AuthorizedUser, body: UpsertTagRequest, req: Request) {
    const repository = getRepository(Tag);
    const exists = await repository.findOne({ where: { name: body.name, type } });
    if (exists) {
      // 名称+类型是唯一键，重复创建会撞约束，这里提前给出可读的错误
      throw badRequest(ResponseCode.tag_exist, '同名标签已存在');
    }

    const tag = repository.create({ name: body.name, type, usageCount: 0 });
    await repository.save(tag);

    await recordAudit({
      adminName: current.name,
      action: '新增标签',
      module: AUDIT_MODULES.news,
      targetType: 'tag',
      targetId: tag.id,
      details: { name: body.name, type },
      ip: ipOf(req),
    });
    return tag;
  }

  private async update(type: TagType, current: AuthorizedUser, id: string, body: UpsertTagRequest, req: Request) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.tag_not_found, '标签不存在');
    }
    const repository = getRepository(Tag);
    const tag = await repository.findOne({ where: { id, type } });
    if (!tag) {
      throw notFound(ResponseCode.tag_not_found, '标签不存在');
    }

    const conflict = await repository.findOne({ where: { name: body.name, type } });
    if (conflict && conflict.id !== id) {
      throw badRequest(ResponseCode.tag_exist, '同名标签已存在');
    }

    tag.name = body.name;
    await repository.save(tag);

    await recordAudit({
      adminName: current.name,
      action: '更新标签',
      module: AUDIT_MODULES.news,
      targetType: 'tag',
      targetId: tag.id,
      details: { name: body.name, type },
      ip: ipOf(req),
    });
    return tag;
  }

  private async remove(type: TagType, current: AuthorizedUser, id: string, req: Request): Promise<{ deleted: true }> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.tag_not_found, '标签不存在');
    }
    const tag = await getRepository(Tag).findOne({ where: { id, type } });
    if (!tag) {
      throw notFound(ResponseCode.tag_not_found, '标签不存在');
    }

    // 关联表对 tag 是 CASCADE，删除标签即解除其与内容的关联，不会留下悬空引用
    await getRepository(Tag).remove(tag);

    await recordAudit({
      adminName: current.name,
      action: '删除标签',
      module: AUDIT_MODULES.news,
      targetType: 'tag',
      targetId: id,
      details: { name: tag.name, type },
      ip: ipOf(req),
    });
    return { deleted: true };
  }
}
