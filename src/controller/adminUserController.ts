import { Authorized, Body, CurrentUser, Get, JsonController, Param, Put, QueryParams, Req } from 'routing-controllers';
import { Request } from 'express';
import { In } from 'typeorm';
import { getRepository } from 'common-db-node/dist/db';
import { User } from '../entity/user';
import { UserRole } from '../entity/userrole';
import {
  AdminUserQuery,
  UpdateUserProfileRequest,
  UpdateUserRolesRequest,
  UpdateUserStatusRequest,
} from '../dto/admin';
import { AuthorizedUser, OPS_ADMINS, badRequest, forbidden, isSysAdmin, notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { isUuid, paginate } from '../component/common/util';
import { AUDIT_MODULES, SORTABLE_FIELDS } from '../component/common/constants';
import { getRoleCodes, setGlobalRoles } from '../component/service/rbacService';
import { toProfile } from '../component/service/userService';
import { ipOf, recordAudit } from '../component/service/auditService';

/** LIKE 通配符转义，避免关键词里的 % / _ 变成全表扫描 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, ch => `\\${ch}`);
}

/**
 * 目标账号已经持有管理角色，或本次将要授予管理角色时，只有系统管理员可以操作。
 * 否则运营管理员可以给自己或同伴提权到 sys_admin。
 */
function assertMayTouchAdmins(current: AuthorizedUser, targetRoles: string[], nextRoles: string[] = []): void {
  const involvesAdmin = [...targetRoles, ...nextRoles].some(code => OPS_ADMINS.includes(code));
  if (involvesAdmin && !isSysAdmin(current)) {
    throw forbidden(ResponseCode.forbidden_operation, '该账号涉及管理角色，仅系统管理员可操作');
  }
}

@JsonController('/v1/admin/users')
export class AdminUserController {
  /** 用户列表：状态 / 角色 / 关键词筛选，分页返回 */
  @Get()
  @Authorized(OPS_ADMINS)
  async list(@QueryParams() query: AdminUserQuery) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    const sortable = SORTABLE_FIELDS.user;
    const sortField = query.sort && sortable.includes(query.sort) ? query.sort : 'createTime';
    const order: 'ASC' | 'DESC' = query.order === 'ASC' ? 'ASC' : 'DESC';

    const builder = getRepository(User).createQueryBuilder('u');

    if (query.status) {
      builder.andWhere('u.status = :status', { status: query.status });
    }
    const keyword = query.keyword?.trim();
    if (keyword) {
      builder.andWhere(
        '(u."displayName" ILIKE :kw OR u.email ILIKE :kw OR u.phone ILIKE :kw)',
        { kw: `%${escapeLike(keyword)}%` }
      );
    }
    if (query.role) {
      // 先按角色取出用户 id 再回填条件，避免在 QueryBuilder 里拼裸 SQL 子查询
      const grants = await getRepository(UserRole).find({ where: { role: { code: query.role } } });
      const userIds = [...new Set(grants.map(grant => grant.userId))];
      if (userIds.length === 0) {
        return { total: 0, items: [] };
      }
      builder.andWhere('u.id IN (:...userIds)', { userIds });
    }

    const [rows, total] = await builder
      .orderBy(`u.${sortField}`, order)
      .skip(skip)
      .take(take)
      .getManyAndCount();

    // 一次性取回本页用户的角色，避免逐条查询
    const ids = rows.map(row => row.id);
    const granted = ids.length
      ? await getRepository(UserRole).find({ where: { userId: In(ids) } })
      : [];
    const rolesByUser = new Map<string, string[]>();
    for (const grant of granted) {
      const code = grant.role?.code;
      if (!code) {
        continue;
      }
      rolesByUser.set(grant.userId, [...(rolesByUser.get(grant.userId) ?? []), code]);
    }

    return {
      total,
      items: rows.map(row => ({
        ...toProfile(row, rolesByUser.get(row.id) ?? []),
        lastLoginAt: row.lastLoginAt,
      })),
    };
  }

  /** 用户详情 */
  @Get('/:id')
  @Authorized(OPS_ADMINS)
  async detail(@Param('id') id: string) {
    const user = await this.findUser(id);
    return {
      ...toProfile(user, await getRoleCodes(user.id)),
      lastLoginAt: user.lastLoginAt,
      updateTime: user.updateTime,
    };
  }

  /** 封禁 / 解封账号。封禁必须填写原因，便于事后追溯。 */
  @Put('/:id/status')
  @Authorized(OPS_ADMINS)
  async updateStatus(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body({ validate: true }) body: UpdateUserStatusRequest,
    @Req() req: Request
  ): Promise<{ updated: true }> {
    const user = await this.findUser(id);
    if (user.id === current.id) {
      throw badRequest(ResponseCode.forbidden_operation, '不能修改自己的账号状态');
    }
    assertMayTouchAdmins(current, await getRoleCodes(user.id));

    const reason = body.reason?.trim();
    if (body.status === 'banned' && !reason) {
      throw badRequest(ResponseCode.invalid_request, '封禁账号需填写原因');
    }

    user.status = body.status;
    await getRepository(User).save(user);

    await recordAudit({
      userId: user.id,
      adminName: current.name,
      action: body.status === 'banned' ? '封禁账号' : '解封账号',
      module: AUDIT_MODULES.user,
      targetType: 'user',
      targetId: user.id,
      status: body.status === 'banned' ? 'warning' : 'success',
      reason,
      ip: ipOf(req),
    });
    return { updated: true };
  }

  /** 全量替换用户的全局角色 */
  @Put('/:id/roles')
  @Authorized(OPS_ADMINS)
  async updateRoles(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body({ validate: true }) body: UpdateUserRolesRequest,
    @Req() req: Request
  ): Promise<{ updated: true; roles: string[] }> {
    const user = await this.findUser(id);
    if (user.id === current.id) {
      throw badRequest(ResponseCode.forbidden_operation, '不能修改自己的角色');
    }

    const nextRoles = [...new Set(body.roles)];
    if (nextRoles.length === 0) {
      throw badRequest(ResponseCode.invalid_role, '请至少保留一个角色');
    }

    const previousRoles = await getRoleCodes(user.id);
    assertMayTouchAdmins(current, previousRoles, nextRoles);

    try {
      await setGlobalRoles(user.id, nextRoles);
    } catch (error) {
      // setGlobalRoles 校验角色 code 时抛的是普通 Error，这里转成可读的业务错误
      throw badRequest(ResponseCode.invalid_role, error instanceof Error ? error.message : '角色更新失败');
    }

    await recordAudit({
      userId: user.id,
      adminName: current.name,
      action: '调整角色',
      module: AUDIT_MODULES.user,
      targetType: 'user',
      targetId: user.id,
      details: { before: previousRoles, after: nextRoles },
      ip: ipOf(req),
    });
    return { updated: true, roles: nextRoles };
  }

  /** 编辑用户资料（不含密码，密码走用户自己的改密流程） */
  @Put('/:id')
  @Authorized(OPS_ADMINS)
  async updateProfile(
    @CurrentUser() current: AuthorizedUser,
    @Param('id') id: string,
    @Body({ validate: true }) body: UpdateUserProfileRequest,
    @Req() req: Request
  ): Promise<{ updated: true }> {
    const user = await this.findUser(id);
    const repository = getRepository(User);

    if (body.displayName !== undefined) {
      user.displayName = body.displayName.trim();
    }
    if (body.avatar !== undefined) {
      user.avatar = body.avatar.trim() || null;
    }
    if (body.bio !== undefined) {
      user.bio = body.bio.trim().slice(0, 500) || null;
    }
    if (body.phone !== undefined) {
      const phone = body.phone.trim();
      if (phone !== user.phone) {
        const occupied = await repository.findOne({ where: { phone } });
        if (occupied && occupied.id !== user.id) {
          throw badRequest(ResponseCode.user_exist, '该手机号已被其他账号使用');
        }
      }
      user.phone = phone;
    }

    await repository.save(user);
    await recordAudit({
      userId: user.id,
      adminName: current.name,
      action: '编辑用户资料',
      module: AUDIT_MODULES.user,
      targetType: 'user',
      targetId: user.id,
      details: { fields: Object.keys(body) },
      ip: ipOf(req),
    });
    return { updated: true };
  }

  /** 按 id 取用户，统一处理 uuid 格式与不存在两种情况 */
  private async findUser(id: string): Promise<User> {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.user_not_exist, '用户不存在');
    }
    const user = await getRepository(User).findOne({ where: { id } });
    if (!user) {
      throw notFound(ResponseCode.user_not_exist, '用户不存在');
    }
    return user;
  }
}
