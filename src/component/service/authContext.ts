import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { publicKey } from '../config';
import { AuthorizedUser, JwtPayload } from '../common/http';

/**
 * 解析**可选**登录态。
 *
 * 公共接口（列表 / 详情）需要在未登录与已登录两种情况下都能工作，因此不能用
 * `@CurrentUser` —— 它背后的 `currentUserChecker` 在没有令牌时直接抛 401，会把
 * 公开页面变成必须登录。这里做一次软解析：无令牌、令牌非法或已过期一律返回
 * null，由调用方按游客处理（例如点赞状态全部为 false）。
 */
export function optionalUser(req?: Request): AuthorizedUser | null {
  const header = req?.headers?.['authorization'];
  if (!header || !/^Bearer\s/i.test(header)) {
    return null;
  }
  const token = header.replace(/^Bearer\s/i, '');
  try {
    const payload = jwt.verify(token, publicKey) as JwtPayload;
    if (!payload.sub) {
      return null;
    }
    return {
      id: payload.sub,
      name: payload.name,
      roles: payload.roles ?? [],
      isActive: payload.isActive,
    };
  } catch {
    return null;
  }
}

/** 可选登录态下的用户 id，未登录为 null */
export function optionalUserId(req?: Request): string | null {
  return optionalUser(req)?.id ?? null;
}
