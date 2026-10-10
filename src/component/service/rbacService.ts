import { getRepository } from 'common-db-node/dist/db';
import { Role } from '../../entity/role';
import { UserRole } from '../../entity/userrole';
import {
  AUTHOR,
  MEMBER,
  MENTOR,
  MODERATOR,
  OPS_ADMIN,
  SYS_ADMIN,
  VISITOR,
} from '../common/http';

/** 内置角色基线（功能清单 §18.3）。code 与 common/http.ts 中的常量一一对应。 */
const BUILT_IN_ROLES: Array<Pick<Role, 'code' | 'name' | 'description'>> = [
  { code: VISITOR, name: '访客', description: '未登录或未完成验证的浏览者' },
  { code: MEMBER, name: '社区成员', description: '完成注册验证的普通开发者' },
  { code: AUTHOR, name: '作者', description: '可投稿新闻、文章与资源' },
  { code: MODERATOR, name: '版主', description: '可审核与处置评论、举报内容' },
  { code: MENTOR, name: '导师', description: '可参与培养计划的课程与评审' },
  { code: OPS_ADMIN, name: '运营管理员', description: '可进入后台管理内容与用户' },
  { code: SYS_ADMIN, name: '系统管理员', description: '拥有全部权限，含角色与系统配置' },
];

/**
 * 幂等地写入内置角色。应用启动时调用，避免手工造数。
 */
export async function ensureBuiltInRoles(): Promise<void> {
  const repository = getRepository(Role);
  for (const role of BUILT_IN_ROLES) {
    const existing = await repository.findOneBy({ code: role.code });
    if (!existing) {
      await repository.save(repository.create({ ...role, isSystem: true }));
    }
  }
}

/** 读取用户已授予的角色 code 列表 */
export async function getRoleCodes(userId: string): Promise<string[]> {
  const repository = getRepository(UserRole);
  const rows = await repository.find({ where: { userId }, relations: ['role'] });
  return rows.map(row => row.role?.code).filter((code): code is string => Boolean(code));
}

/**
 * 设置用户角色（全量替换 global 范围的角色）。
 * 调用方需已完成权限校验，此处只负责落库。
 */
export async function setGlobalRoles(userId: string, roleCodes: string[]): Promise<void> {
  const userRoleRepository = getRepository(UserRole);
  const roleRepository = getRepository(Role);

  const roles = await Promise.all(
    roleCodes.map(code => roleRepository.findOneBy({ code }))
  );
  const validRoles = roles.filter((role): role is Role => Boolean(role));
  if (validRoles.length !== roleCodes.length) {
    const missing = roleCodes.filter(code => !validRoles.some(r => r.code === code));
    throw new Error(`无效的角色: ${missing.join(', ')}`);
  }

  await userRoleRepository.delete({ userId, scopeType: 'global' });
  for (const role of validRoles) {
    await userRoleRepository.save(
      userRoleRepository.create({ userId, roleId: role.id, scopeType: 'global', scopeId: '' })
    );
  }
}
