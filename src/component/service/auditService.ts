import { getRepository } from 'common-db-node/dist/db';
import { AuditLog } from '../../entity/auditlog';
import { clientIp } from '../common/util';

export interface AuditEntry {
  adminName?: string;
  userId?: string;
  action: string;
  module: string;
  targetType?: string;
  targetId?: string;
  status?: 'success' | 'warning' | 'danger';
  reason?: string;
  details?: Record<string, unknown>;
  ip?: string;
}

/**
 * 记录一条管理操作日志。
 * 审计失败不应阻断业务主流程，因此这里吞掉异常只告警。
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const repository = getRepository(AuditLog);
    await repository.save(repository.create({
      adminName: entry.adminName ?? 'system',
      userId: entry.userId,
      action: entry.action,
      module: entry.module,
      targetType: entry.targetType,
      targetId: entry.targetId,
      status: entry.status ?? 'success',
      reason: entry.reason,
      ip: entry.ip,
      details: entry.details,
    }));
  } catch (error) {
    console.error('[audit] 写入审计日志失败:', error);
  }
}

export interface AuditRequestContext {
  ip?: string;
  user?: { id: string; name: string };
}

/** 从路由上下文中提取审计所需的操作人与 IP */
export function auditContext(req?: AuditRequestContext): AuditEntry {
  return {
    action: '',
    module: '',
    ip: req?.ip,
    userId: req?.user?.id,
    adminName: req?.user?.name,
  };
}

/** 从 Express 请求对象提取客户端 IP，请求缺失时返回空串 */
export function ipOf(req?: { headers?: Record<string, unknown>; ip?: string; socket?: { remoteAddress?: string } }): string {
  if (!req) {
    return '';
  }
  return clientIp({ headers: req.headers ?? {}, ip: req.ip, socket: req.socket });
}
