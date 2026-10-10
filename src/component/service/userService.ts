import { getRepository } from 'common-db-node/dist/db';
import { EntityManager } from 'typeorm';
import { User, UserStatus } from '../../entity/user';
import { hash } from '../common/util';

/** 对外输出的用户档案（不含密码等敏感字段） */
export interface UserProfile {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  avatar: string | null;
  bio: string | null;
  status: UserStatus;
  roles: string[];
  emailVerified: boolean;
  phoneVerified: boolean;
  createTime: Date;
}

export function toProfile(user: User, roles: string[]): UserProfile {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    avatar: user.avatar,
    bio: user.bio,
    status: user.status,
    roles,
    emailVerified: Boolean(user.emailVerifiedAt),
    phoneVerified: Boolean(user.phoneVerifiedAt),
    createTime: user.createTime,
  };
}

/** 手机号中间四位打码，用于公开主页等场景 */
export function maskPhone(phone: string | null): string | null {
  if (!phone || phone.length !== 11) {
    return phone;
  }
  return `${phone.slice(0, 3)}****${phone.slice(7)}`;
}

export function getUserRepository(manager?: EntityManager) {
  return manager ? manager.getRepository(User) : getRepository(User);
}

export function findByEmail(email: string, manager?: EntityManager): Promise<User | null> {
  return getUserRepository(manager).findOne({ where: { email }, withDeleted: false });
}

export function findByPhone(phone: string, manager?: EntityManager): Promise<User | null> {
  return getUserRepository(manager).findOne({ where: { phone }, withDeleted: false });
}

export function findById(id: string, manager?: EntityManager): Promise<User | null> {
  return getUserRepository(manager).findOne({ where: { id } });
}

export interface CreateUserInput {
  email?: string | null;
  phone?: string | null;
  password: string;
  displayName: string;
}

/** 创建用户并写入密码哈希。角色授予交由 rbacService 处理。 */
export async function createUser(input: CreateUserInput, manager?: EntityManager): Promise<User> {
  const repository = getUserRepository(manager);
  const user = repository.create({
    email: input.email ?? null,
    phone: input.phone ?? null,
    password: await hash(input.password),
    displayName: input.displayName,
    status: 'active',
    emailVerifiedAt: input.email ? new Date() : null,
    phoneVerifiedAt: input.phone ? new Date() : null,
  });
  return repository.save(user);
}

/** 根据邮箱或手机号查找用户（登录/找回密码统一入口） */
export async function findByAccount(account: string): Promise<User | null> {
  return /^1[3-9]\d{9}$/.test(account) ? findByPhone(account) : findByEmail(account);
}
