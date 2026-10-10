import { Authorized, Body, CurrentUser, Get, JsonController, Param, Put, QueryParams, Req } from 'routing-controllers';
import { Request } from 'express';
import { getRepository } from 'common-db-node/dist/db';
import { AuditLog } from '../entity/auditlog';
import { LegalDocument, LegalDocumentType } from '../entity/legaldocument';
import { SystemConfig } from '../entity/systemconfig';
import {
  AdminAuditLogQuery,
  AdminMetricQuery,
  UpdateSystemConfigRequest,
  UpsertLegalDocumentRequest,
} from '../dto/admin';
import { AuthorizedUser, OPS_ADMINS, badRequest, isSysAdmin, notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { isUuid, paginate } from '../component/common/util';
import { AUDIT_MODULES, SORTABLE_FIELDS } from '../component/common/constants';
import { isValidConfigValue } from '../component/common/configValue';
import { ipOf, recordAudit } from '../component/service/auditService';
import { buildOverviewMetrics } from '../component/service/metricService';

@JsonController('/v1/admin')
export class AdminSystemController {
  /** 操作日志查询：模块 / 动作 / 结果 / 时间区间 */
  @Get('/audit-logs')
  @Authorized(OPS_ADMINS)
  async auditLogs(@QueryParams() query: AdminAuditLogQuery) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const sortField = SORTABLE_FIELDS.auditlog.includes(query.sort ?? '') ? (query.sort as string) : 'createTime';
    const order: 'ASC' | 'DESC' = query.order === 'ASC' ? 'ASC' : 'DESC';

    const builder = getRepository(AuditLog).createQueryBuilder('log');
    if (query.module) {
      builder.andWhere('log.module = :module', { module: query.module });
    }
    if (query.action) {
      builder.andWhere('log.action ILIKE :action', { action: `%${query.action.replace(/[\\%_]/g, ch => `\\${ch}`)}%` });
    }
    if (query.status) {
      builder.andWhere('log.status = :status', { status: query.status });
    }
    if (query.startTime) {
      builder.andWhere('log.createTime >= :start', { start: new Date(query.startTime) });
    }
    if (query.endTime) {
      builder.andWhere('log.createTime <= :end', { end: new Date(query.endTime) });
    }

    const [items, total] = await builder
      .orderBy(`log.${sortField}`, order)
      .skip(skip)
      .take(take)
      .getManyAndCount();

    return { total, items };
  }

  /** 站点运营大屏统计。数字全部来自真实查询，不返回占位值。 */
  @Get('/metrics/overview')
  @Authorized(OPS_ADMINS)
  async overview(@QueryParams() query: AdminMetricQuery) {
    const days = query.days ?? 30;

    // 从当天零点往前推，让窗口边界落在自然日上：否则「近 30 天」会随请求时刻
    // 漂移，与图表里按自然日分桶的点对不齐。
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));

    return buildOverviewMetrics(days, since);
  }

  /** 站点配置列表 */
  @Get('/configs')
  @Authorized(OPS_ADMINS)
  async listConfigs() {
    const configs = await getRepository(SystemConfig).find({ order: { key: 'ASC' } });
    return configs.map(item => ({
      key: item.key,
      value: item.value,
      description: item.description,
      updateTime: item.updateTime,
    }));
  }

  /** 更新单个配置项。key 由 DTO 白名单限定，不接受任意键。 */
  @Put('/configs')
  @Authorized(OPS_ADMINS)
  async updateConfig(
    @CurrentUser() current: AuthorizedUser,
    @Body({ validate: true }) body: UpdateSystemConfigRequest,
    @Req() req: Request
  ): Promise<{ updated: true }> {
    // 品牌与页脚会影响全站对外展示，收紧到系统管理员
    if (!isSysAdmin(current)) {
      throw badRequest(ResponseCode.forbidden_operation, '站点配置仅系统管理员可修改');
    }

    // 形状校验按 key 分派：词表是数组，其余是对象，无法用单个装饰器表达
    if (!isValidConfigValue(body.key, body.value)) {
      throw badRequest(ResponseCode.invalid_request, '配置值格式不正确');
    }

    const repository = getRepository(SystemConfig);
    const existing = await repository.findOneBy({ key: body.key });
    const previous = existing?.value ?? null;

    if (existing) {
      existing.value = body.value;
      await repository.save(existing);
    } else {
      await repository.save(repository.create({ key: body.key, value: body.value, description: null }));
    }

    await recordAudit({
      adminName: current.name,
      action: '更新站点配置',
      module: AUDIT_MODULES.system,
      targetType: 'system_config',
      targetId: body.key,
      details: { key: body.key, before: previous, after: body.value },
      ip: ipOf(req),
    });
    return { updated: true };
  }

  /** 协议/隐私政策版本列表（含历史版本，便于回滚） */
  @Get('/legal-documents')
  @Authorized(OPS_ADMINS)
  async listLegalDocuments(@QueryParams() query: { type?: string; pageNumber?: string; pageSize?: string }) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const where = query.type ? { type: query.type as LegalDocumentType } : {};
    const [items, total] = await getRepository(LegalDocument).findAndCount({
      where,
      order: { effectiveDate: 'DESC' },
      skip,
      take,
      select: ['id', 'type', 'version', 'effectiveDate', 'lang', 'isActive', 'createTime', 'updateTime'],
    });
    return { total, items };
  }

  /**
   * 单个版本详情，含正文。列表接口刻意不返回 contentHtml（大文本），
   * 编辑既有版本时再由这个接口按需取回。
   */
  @Get('/legal-documents/:id')
  @Authorized(OPS_ADMINS)
  async legalDocumentDetail(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.legal_document_not_found, '协议版本不存在');
    }
    const document = await getRepository(LegalDocument).findOne({ where: { id } });
    if (!document) {
      throw notFound(ResponseCode.legal_document_not_found, '协议版本不存在');
    }
    return document;
  }

  /**
   * 写入协议/隐私政策的新版本。
   * 启用时同一 type 下的其他版本自动失效，但历史版本保留可查。
   */
  @Put('/legal-documents')
  @Authorized(OPS_ADMINS)
  async upsertLegalDocument(
    @CurrentUser() current: AuthorizedUser,
    @Body({ validate: true }) body: UpsertLegalDocumentRequest,
    @Req() req: Request
  ): Promise<{ updated: true }> {
    if (!isSysAdmin(current)) {
      throw badRequest(ResponseCode.forbidden_operation, '协议维护仅系统管理员可操作');
    }

    const repository = getRepository(LegalDocument);
    const existing = await repository.findOne({ where: { type: body.type, version: body.version } });
    const activate = body.isActive ?? true;

    if (activate) {
      await repository.update({ type: body.type }, { isActive: false });
    }

    const document = existing ?? repository.create({
      type: body.type,
      version: body.version,
      isActive: false,
    });
    document.effectiveDate = body.effectiveDate ? new Date(body.effectiveDate) : (existing?.effectiveDate ?? new Date());
    document.contentHtml = body.contentHtml;
    document.content = body.content ?? existing?.content ?? null;
    document.lang = 'zh';
    document.isActive = activate;
    await repository.save(document);

    await recordAudit({
      adminName: current.name,
      action: existing ? '更新协议' : '新增协议',
      module: AUDIT_MODULES.legal,
      targetType: 'legal_document',
      targetId: document.id,
      details: { type: body.type, version: body.version, isActive: activate },
      ip: ipOf(req),
    });
    return { updated: true };
  }
}
