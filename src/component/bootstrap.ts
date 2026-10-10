import { getRepository } from 'common-db-node/dist/db';
import { LegalDocument } from '../entity/legaldocument';
import { SystemConfig } from '../entity/systemconfig';
import { User } from '../entity/user';
import { SYS_ADMIN } from './common/http';
import { hash } from './common/util';
import { ensureBuiltInRoles, getRoleCodes, setGlobalRoles } from './service/rbacService';
import { createUser } from './service/userService';
import { LEGAL_DRAFTS } from './common/legalDrafts';
import { DEFAULT_SYSTEM_CONFIGS } from './common/defaultConfigs';

/**
 * 应用启动时的幂等初始化：内置角色 → 初始系统管理员 → 协议文档 → 默认系统配置。
 * 每一步都先查后写，重复启动不会产生重复数据。
 */
export async function bootstrap(): Promise<void> {
  await ensureBuiltInRoles();
  await ensureBootstrapAdmin();
  await ensureLegalDocuments();
  await ensureSystemConfigs();
}

/**
 * 创建初始系统管理员。
 * 账号与密码只能来自环境变量（BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD），
 * 仓库内不出现任何硬编码凭据；两者未配置时跳过并提示，交由运维在部署阶段注入。
 */
async function ensureBootstrapAdmin(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!email || !password) {
    console.warn('[bootstrap] 未配置 BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD，跳过初始管理员创建');
    return;
  }

  const repository = getRepository(User);
  const existing = await repository.findOne({ where: { email } });

  if (existing) {
    // 已有账号则只补齐管理员角色，不覆盖密码
    const roles = await getRoleCodes(existing.id);
    if (!roles.includes(SYS_ADMIN)) {
      await setGlobalRoles(existing.id, [...roles, SYS_ADMIN]);
      console.log(`[bootstrap] 已将 ${email} 提升为系统管理员`);
    }
    return;
  }

  const user = await createUser({
    email,
    phone: null,
    password,
    displayName: process.env.BOOTSTRAP_ADMIN_NAME?.trim() || '系统管理员',
  });
  await setGlobalRoles(user.id, [SYS_ADMIN]);
  console.log(`[bootstrap] 已创建初始系统管理员 ${email}`);
}

/** 写入协议与隐私政策的 v1 草稿；已存在同 type 的启用版本时不覆盖 */
async function ensureLegalDocuments(): Promise<void> {
  const repository = getRepository(LegalDocument);
  for (const draft of LEGAL_DRAFTS) {
    const existing = await repository.findOne({ where: { type: draft.type, isActive: true } });
    if (existing) {
      continue;
    }
    await repository.save(repository.create({
      type: draft.type,
      version: draft.version,
      effectiveDate: new Date(),
      content: { markdown: draft.markdown },
      contentHtml: draft.html,
      lang: 'zh',
      isActive: true,
    }));
    console.log(`[bootstrap] 已写入协议文档 ${draft.type} ${draft.version}`);
  }
}

/** 写入品牌/页脚/功能开关等默认运营配置，键不存在时才写入 */
async function ensureSystemConfigs(): Promise<void> {
  const repository = getRepository(SystemConfig);
  for (const item of DEFAULT_SYSTEM_CONFIGS) {
    const existing = await repository.findOneBy({ key: item.key });
    if (existing) {
      continue;
    }
    await repository.save(repository.create(item));
  }
}
