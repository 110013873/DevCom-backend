import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post, Put, QueryParams, Req } from 'routing-controllers';
import { Request } from 'express';
import { EntityManager, In } from 'typeorm';
import { getRepository, transaction } from 'common-db-node/dist/db';
import { Resource } from '../entity/resource';
import { ResourceVersion } from '../entity/resourceversion';
import { ResourceFile } from '../entity/resourcefile';
import { DownloadRecord } from '../entity/downloadrecord';
import { ResourceQuery, UpsertResourceFileRequest, UpsertResourceRequest, UpsertResourceVersionRequest } from '../dto/resource';
import { AuthorizedUser, OPS_ADMINS, badRequest, notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { escapeLike, isUuid, paginate } from '../component/common/util';
import { AUDIT_MODULES, SORTABLE_FIELDS } from '../component/common/constants';
import { ipOf, recordAudit } from '../component/service/auditService';
import { setResourceTags, tagsOfResource } from '../component/service/tagService';
import { numericToNumber } from '../component/service/resourceService';

/**
 * 后台资源管理：资源、版本、文件三层。
 *
 * 三层各自有增删改，但**版本与文件必须挂在已存在的父资源/父版本下** —— 每个
 * 带父 id 的写入口都先核对父记录存在，否则会造出永远取不到内容的孤儿行。
 */
@JsonController('/v1/admin/resources')
export class AdminResourceController {
  // ---------------- 资源本体 ----------------

  /** 资源列表（含草稿与隐藏资源） */
  @Get('/')
  @Authorized(OPS_ADMINS)
  async list(@QueryParams() query: ResourceQuery) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const sortField = SORTABLE_FIELDS.resource.includes(query.sort ?? '') ? (query.sort as string) : 'createTime';
    const order: 'ASC' | 'DESC' = query.order === 'ASC' ? 'ASC' : 'DESC';

    const builder = getRepository(Resource).createQueryBuilder('resource');
    if (query.category) {
      builder.andWhere('resource.category = :category', { category: query.category });
    }
    if (query.keyword) {
      const keyword = `%${escapeLike(query.keyword)}%`;
      builder.andWhere('(resource.name ILIKE :keyword OR resource.summary ILIKE :keyword)', { keyword });
    }

    const [rows, total] = await builder
      .orderBy(`resource.${sortField}`, order)
      .skip(skip)
      .take(take)
      .getManyAndCount();

    const tags = await tagsOfResource(rows.map(row => row.id));

    return {
      total,
      items: rows.map(row => ({
        id: row.id,
        name: row.name,
        summary: row.summary,
        coverImage: row.coverImage,
        category: row.category,
        author: row.author,
        status: row.status,
        isPublic: row.isPublic,
        isRecommended: row.isRecommended,
        isFree: row.isFree,
        downloadCount: row.downloadCount,
        ratingAvg: numericToNumber(row.ratingAvg),
        ratingCount: row.ratingCount,
        publishedAt: row.publishedAt,
        createTime: row.createTime,
        updateTime: row.updateTime,
        tags: tags.get(row.id) ?? [],
      })),
    };
  }

  // ---------------- 下载记录 ----------------

  /**
   * 下载记录：可按资源 / 用户过滤，用于统计与风控排查。
   *
   * ⚠️ 必须声明在 `@Get('/:id')` **之前**：routing-controllers 按声明顺序匹配路由，
   * 放在后面会被 `/:id` 抢先匹配到 `id='download-records'`，在 `isUuid` 处被判为
   * 非法 uuid 直接 404 —— 这条路由此永远不可达。
   */
  @Get('/download-records')
  @Authorized(OPS_ADMINS)
  async downloadRecords(@QueryParams() query: { resourceId?: string; userId?: string; pageNumber?: string; pageSize?: string }) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);

    const builder = getRepository(DownloadRecord).createQueryBuilder('record');
    if (query.resourceId && isUuid(query.resourceId)) {
      builder.andWhere('record.resourceId = :resourceId', { resourceId: query.resourceId });
    }
    if (query.userId && isUuid(query.userId)) {
      builder.andWhere('record.userId = :userId', { userId: query.userId });
    }

    const [items, total] = await builder
      .orderBy('record.createTime', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();

    return { total, items };
  }

  @Get('/:id')
  @Authorized(OPS_ADMINS)
  async detail(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }
    const resource = await getRepository(Resource).findOne({ where: { id } });
    if (!resource) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }
    const tags = await tagsOfResource([id]);
    return { ...resource, tagIds: (tags.get(id) ?? []).map(tag => tag.id) };
  }

  @Post('/')
  @Authorized(OPS_ADMINS)
  async create(@CurrentUser() current: AuthorizedUser, @Body({ validate: true }) body: UpsertResourceRequest, @Req() req: Request) {
    const resource = await transaction(async (manager: EntityManager) => {
      const repository = manager.getRepository(Resource);
      const entity = repository.create({
        name: body.name,
        // summary / overview 在实体上是 NOT NULL DEFAULT ''，不是可空列
        summary: body.summary ?? '',
        coverImage: body.coverImage ?? null,
        category: body.category ?? 'toolchain',
        author: body.author ?? null,
        isRecommended: body.isRecommended ?? false,
        isFree: body.isFree ?? true,
        // 默认不公开：新建资源应先配好版本与文件再放出，避免空壳资源上线
        isPublic: body.isPublic ?? false,
        overview: body.overview ?? '',
        keyFeatures: body.keyFeatures ?? null,
        supportedArch: body.supportedArch ?? null,
        quickStart: body.quickStart ?? null,
        systemRequirements: body.systemRequirements ?? null,
        slug: body.slug ?? null,
        status: body.status ?? 'draft',
        publishedAt: body.publishedAt ? new Date(body.publishedAt) : null,
        downloadCount: 0,
        ratingAvg: 0,
        ratingCount: 0,
        createdById: current.id,
      });
      const saved = await repository.save(entity);
      await setResourceTags(manager, saved.id, body.tagIds ?? []);
      return saved;
    });

    await recordAudit({
      adminName: current.name,
      action: '新建资源',
      module: AUDIT_MODULES.resource,
      targetType: 'resource',
      targetId: resource.id,
      details: { name: resource.name, status: resource.status },
      ip: ipOf(req),
    });

    return resource;
  }

  @Put('/:id')
  @Authorized(OPS_ADMINS)
  async update(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body({ validate: true }) body: UpsertResourceRequest,
    @Req() req: Request
  ) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }

    const resource = await transaction(async (manager: EntityManager) => {
      const repository = manager.getRepository(Resource);
      const entity = await repository.findOne({ where: { id } });
      if (!entity) {
        throw notFound(ResponseCode.resource_not_found, '资源不存在');
      }

      entity.name = body.name;
      entity.summary = body.summary ?? '';
      entity.coverImage = body.coverImage ?? null;
      entity.category = body.category ?? entity.category;
      entity.author = body.author ?? null;
      entity.isRecommended = body.isRecommended ?? entity.isRecommended;
      entity.isFree = body.isFree ?? entity.isFree;
      entity.isPublic = body.isPublic ?? entity.isPublic;
      entity.overview = body.overview ?? '';
      entity.keyFeatures = body.keyFeatures ?? null;
      entity.supportedArch = body.supportedArch ?? null;
      entity.quickStart = body.quickStart ?? null;
      entity.systemRequirements = body.systemRequirements ?? null;
      entity.slug = body.slug ?? entity.slug;
      entity.status = body.status ?? entity.status;
      if (body.publishedAt) {
        entity.publishedAt = new Date(body.publishedAt);
      } else if (entity.status === 'published' && !entity.publishedAt) {
        entity.publishedAt = new Date();
      }

      const saved = await repository.save(entity);
      if (body.tagIds) {
        await setResourceTags(manager, saved.id, body.tagIds);
      }
      return saved;
    });

    await recordAudit({
      adminName: current.name,
      action: '更新资源',
      module: AUDIT_MODULES.resource,
      targetType: 'resource',
      targetId: id,
      details: { name: resource.name, status: resource.status },
      ip: ipOf(req),
    });

    return resource;
  }

  /** 删除资源。软删 —— 版本、文件、下载记录都挂在它下面。 */
  @Delete('/:id')
  @Authorized(OPS_ADMINS)
  async remove(@CurrentUser() current: AuthorizedUser, @Param('id') id: string, @Req() req: Request): Promise<{ deleted: true }> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }
    const repository = getRepository(Resource);
    const resource = await repository.findOne({ where: { id } });
    if (!resource) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }
    await repository.softRemove(resource);

    await recordAudit({
      adminName: current.name,
      action: '删除资源',
      module: AUDIT_MODULES.resource,
      targetType: 'resource',
      targetId: id,
      details: { name: resource.name },
      ip: ipOf(req),
    });
    return { deleted: true };
  }

  // ---------------- 版本 ----------------

  /** 某资源下的版本列表 */
  @Get('/:id/versions')
  @Authorized(OPS_ADMINS)
  async versions(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }
    const versions = await getRepository(ResourceVersion).find({
      where: { resourceId: id },
      order: { createTime: 'DESC' },
    });
    const versionIds = versions.map(version => version.id);
    const files = versionIds.length
      ? await getRepository(ResourceFile).find({ where: { versionId: In(versionIds) } })
      : [];

    const filesByVersion = new Map<string, ResourceFile[]>();
    for (const file of files) {
      const list = filesByVersion.get(file.versionId) ?? [];
      list.push(file);
      filesByVersion.set(file.versionId, list);
    }

    return {
      total: versions.length,
      items: versions.map(version => ({ ...version, files: filesByVersion.get(version.id) ?? [] })),
    };
  }

  @Post('/:id/versions')
  @Authorized(OPS_ADMINS)
  async createVersion(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body({ validate: true }) body: UpsertResourceVersionRequest,
    @Req() req: Request
  ) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }
    const resource = await getRepository(Resource).findOne({ where: { id }, select: ['id'] });
    if (!resource) {
      throw notFound(ResponseCode.resource_not_found, '资源不存在');
    }

    const version = await transaction(async (manager: EntityManager) => {
      const repository = manager.getRepository(ResourceVersion);
      const duplicate = await repository.findOne({ where: { resourceId: id, version: body.version } });
      if (duplicate) {
        throw badRequest(ResponseCode.invalid_request, '该版本号已存在');
      }

      // 若这是第一个版本，或显式要求置为默认，则先把同资源下的默认标记全部清掉
      const shouldDefault =
        body.isDefault === true || (await repository.count({ where: { resourceId: id } })) === 0;
      if (shouldDefault) {
        await repository.update({ resourceId: id }, { isDefault: false });
      }

      const entity = repository.create({
        resourceId: id,
        version: body.version,
        name: body.name,
        description: body.description ?? null,
        changelog: body.changelog ?? null,
        isDefault: shouldDefault,
        giteeUrl: body.giteeUrl ?? null,
        githubUrl: body.githubUrl ?? null,
        status: body.status ?? 'published',
        createdById: current.id,
      });
      return repository.save(entity);
    });

    await recordAudit({
      adminName: current.name,
      action: '新增资源版本',
      module: AUDIT_MODULES.resource,
      targetType: 'resourceversion',
      targetId: version.id,
      details: { resourceId: id, version: version.version, isDefault: version.isDefault },
      ip: ipOf(req),
    });

    return version;
  }

  @Put('/:resourceId/versions/:versionId')
  @Authorized(OPS_ADMINS)
  async updateVersion(
    @CurrentUser() current: AuthorizedUser,
    @Param('resourceId') resourceId: string,
    @Param('versionId') versionId: string,
    @Body({ validate: true }) body: UpsertResourceVersionRequest,
    @Req() req: Request
  ) {
    if (!isUuid(resourceId) || !isUuid(versionId)) {
      throw notFound(ResponseCode.resource_version_not_found, '版本不存在');
    }

    const version = await transaction(async (manager: EntityManager) => {
      const repository = manager.getRepository(ResourceVersion);
      const entity = await repository.findOne({ where: { id: versionId, resourceId } });
      if (!entity) {
        throw notFound(ResponseCode.resource_version_not_found, '版本不存在');
      }

      // 默认版本互斥：置为默认时先把兄弟版本取消，保证同资源下最多一条 isDefault
      if (body.isDefault === true && !entity.isDefault) {
        await repository.update({ resourceId }, { isDefault: false });
        entity.isDefault = true;
      } else if (body.isDefault === false) {
        entity.isDefault = false;
      }

      entity.version = body.version;
      entity.name = body.name;
      entity.description = body.description ?? null;
      entity.changelog = body.changelog ?? null;
      entity.giteeUrl = body.giteeUrl ?? null;
      entity.githubUrl = body.githubUrl ?? null;
      entity.status = body.status ?? entity.status;

      return repository.save(entity);
    });

    await recordAudit({
      adminName: current.name,
      action: '更新资源版本',
      module: AUDIT_MODULES.resource,
      targetType: 'resourceversion',
      targetId: versionId,
      details: { resourceId, version: version.version, isDefault: version.isDefault },
      ip: ipOf(req),
    });

    return version;
  }

  /** 删除版本。其下文件由外键 CASCADE 一并删除，这里不下手删文件。 */
  @Delete('/:resourceId/versions/:versionId')
  @Authorized(OPS_ADMINS)
  async removeVersion(
    @CurrentUser() current: AuthorizedUser,
    @Param('resourceId') resourceId: string,
    @Param('versionId') versionId: string,
    @Req() req: Request
  ): Promise<{ deleted: true }> {
    if (!isUuid(resourceId) || !isUuid(versionId)) {
      throw notFound(ResponseCode.resource_version_not_found, '版本不存在');
    }
    const version = await getRepository(ResourceVersion).findOne({ where: { id: versionId, resourceId } });
    if (!version) {
      throw notFound(ResponseCode.resource_version_not_found, '版本不存在');
    }

    await getRepository(ResourceVersion).remove(version);

    await recordAudit({
      adminName: current.name,
      action: '删除资源版本',
      module: AUDIT_MODULES.resource,
      targetType: 'resourceversion',
      targetId: versionId,
      details: { resourceId, version: version.version },
      ip: ipOf(req),
    });
    return { deleted: true };
  }

  // ---------------- 文件 ----------------

  @Post('/:resourceId/versions/:versionId/files')
  @Authorized(OPS_ADMINS)
  async addFile(
    @CurrentUser() current: AuthorizedUser,
    @Param('resourceId') resourceId: string,
    @Param('versionId') versionId: string,
    @Body({ validate: true }) body: UpsertResourceFileRequest,
    @Req() req: Request
  ) {
    if (!isUuid(resourceId) || !isUuid(versionId)) {
      throw notFound(ResponseCode.resource_version_not_found, '版本不存在');
    }
    const version = await getRepository(ResourceVersion).findOne({ where: { id: versionId, resourceId }, select: ['id'] });
    if (!version) {
      throw notFound(ResponseCode.resource_version_not_found, '版本不存在');
    }

    const repository = getRepository(ResourceFile);
    const file = repository.create({
      versionId,
      fileName: body.fileName,
      osArch: body.osArch ?? null,
      // bigint 列：pg 驱动按字符串回读，写入时用字符串避免 JS 数字精度上限
      size: String(body.size ?? 0) as unknown as number,
      checksum: body.checksum ?? null,
      storageKey: body.storageKey,
      url: body.url,
    });
    await repository.save(file);

    await recordAudit({
      adminName: current.name,
      action: '新增资源文件',
      module: AUDIT_MODULES.resource,
      targetType: 'resourcefile',
      targetId: file.id,
      details: { resourceId, versionId, fileName: file.fileName },
      ip: ipOf(req),
    });

    return file;
  }

  @Put('/files/:fileId')
  @Authorized(OPS_ADMINS)
  async updateFile(
    @CurrentUser() current: AuthorizedUser,
    @Param('fileId') fileId: string,
    @Body({ validate: true }) body: UpsertResourceFileRequest,
    @Req() req: Request
  ) {
    if (!isUuid(fileId)) {
      throw notFound(ResponseCode.resource_file_not_found, '文件不存在');
    }
    const repository = getRepository(ResourceFile);
    const file = await repository.findOne({ where: { id: fileId } });
    if (!file) {
      throw notFound(ResponseCode.resource_file_not_found, '文件不存在');
    }

    file.fileName = body.fileName;
    file.osArch = body.osArch ?? null;
    if (body.size !== undefined) {
      file.size = String(body.size) as unknown as number;
    }
    file.checksum = body.checksum ?? null;
    file.storageKey = body.storageKey;
    file.url = body.url;
    await repository.save(file);

    await recordAudit({
      adminName: current.name,
      action: '更新资源文件',
      module: AUDIT_MODULES.resource,
      targetType: 'resourcefile',
      targetId: fileId,
      details: { fileName: file.fileName },
      ip: ipOf(req),
    });

    return file;
  }

  /** 删除文件。物理删除 —— 文件行没有软删列，且历史下载记录已单独留痕。 */
  @Delete('/files/:fileId')
  @Authorized(OPS_ADMINS)
  async removeFile(@CurrentUser() current: AuthorizedUser, @Param('fileId') fileId: string, @Req() req: Request): Promise<{ deleted: true }> {
    if (!isUuid(fileId)) {
      throw notFound(ResponseCode.resource_file_not_found, '文件不存在');
    }
    const file = await getRepository(ResourceFile).findOne({ where: { id: fileId } });
    if (!file) {
      throw notFound(ResponseCode.resource_file_not_found, '文件不存在');
    }
    await getRepository(ResourceFile).remove(file);

    await recordAudit({
      adminName: current.name,
      action: '删除资源文件',
      module: AUDIT_MODULES.resource,
      targetType: 'resourcefile',
      targetId: fileId,
      details: { fileName: file.fileName },
      ip: ipOf(req),
    });
    return { deleted: true };
  }

}
