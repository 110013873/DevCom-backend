import { Authorized, Body, CurrentUser, Get, JsonController, Param, Put, QueryParams } from 'routing-controllers';
import { getRepository } from 'common-db-node/dist/db';
import { User } from '../entity/user';
import { AuthorizedUser, badRequest, notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';
import { hash, isUuid, paginate, verify } from '../component/common/util';
import { PASSWORD_MIN_LENGTH } from '../component/common/constants';
import { getRoleCodes } from '../component/service/rbacService';
import { myDownloads } from '../component/service/resourceService';
import { MyDownloadQuery } from '../dto/content';

class UpdateProfileRequest {
  displayName?: string;
  avatar?: string;
  bio?: string;
}

class ChangePasswordRequest {
  oldPassword?: string;
  password?: string;
}

@JsonController('/v1/users')
export class UserController {
  /** 当前登录用户资料 */
  @Get('/me')
  @Authorized()
  async me(@CurrentUser() current: AuthorizedUser) {
    const user = await getRepository(User).findOne({ where: { id: current.id } });
    if (!user) {
      throw notFound(ResponseCode.user_not_exist, '用户不存在');
    }
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      avatar: user.avatar,
      bio: user.bio,
      roles: await getRoleCodes(user.id),
      emailVerified: Boolean(user.emailVerifiedAt),
      phoneVerified: Boolean(user.phoneVerifiedAt),
      createTime: user.createTime,
    };
  }

  @Put('/me')
  @Authorized()
  async updateMe(@CurrentUser() current: AuthorizedUser, @Body() body: UpdateProfileRequest) {
    const repository = getRepository(User);
    const user = await repository.findOne({ where: { id: current.id } });
    if (!user) {
      throw notFound(ResponseCode.user_not_exist, '用户不存在');
    }

    if (body.displayName !== undefined) {
      const name = body.displayName.trim();
      if (name.length < 2 || name.length > 20) {
        throw badRequest(ResponseCode.invalid_request, '昵称长度需在 2-20 字之间');
      }
      user.displayName = name;
    }
    if (body.avatar !== undefined) {
      user.avatar = body.avatar.trim() || null;
    }
    if (body.bio !== undefined) {
      user.bio = body.bio.trim().slice(0, 500) || null;
    }

    const saved = await repository.save(user);
    return {
      id: saved.id,
      displayName: saved.displayName,
      avatar: saved.avatar,
      bio: saved.bio,
    };
  }

  @Put('/me/password')
  @Authorized()
  async changePassword(@CurrentUser() current: AuthorizedUser, @Body() body: ChangePasswordRequest): Promise<{ updated: true }> {
    const repository = getRepository(User);
    const user = await repository.findOne({ where: { id: current.id } });
    if (!user) {
      throw notFound(ResponseCode.user_not_exist, '用户不存在');
    }
    if (!body.oldPassword || !(await verify(body.oldPassword, user.password))) {
      throw badRequest(ResponseCode.invalid_old_password, '原密码不正确');
    }
    if (!body.password || body.password.length < PASSWORD_MIN_LENGTH) {
      throw badRequest(ResponseCode.password_too_weak, `新密码长度不能少于 ${PASSWORD_MIN_LENGTH} 位`);
    }

    user.password = await hash(body.password);
    await repository.save(user);
    return { updated: true };
  }

  /**
   * 我的下载。
   *
   * **路径必须声明在 `/:id` 之前**：routing-controllers 按声明顺序匹配，
   * 若放在后面，`/users/me/downloads` 会先撞上 `/:id` 并被当成一个 id 去查
   * 公开主页，结果是 404 而不是这份列表。
   */
  @Get('/me/downloads')
  @Authorized()
  async downloads(@CurrentUser() current: AuthorizedUser, @QueryParams() query: MyDownloadQuery) {
    const { take, skip } = paginate(query.pageNumber, query.pageSize);
    return myDownloads(current.id, skip, take);
  }

  /** 开发者公开主页（最小版）：只暴露昵称/头像/简介 */
  @Get('/:id')
  async publicProfile(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw notFound(ResponseCode.user_not_exist, '用户不存在');
    }
    const user = await getRepository(User).findOne({ where: { id } });
    if (!user || user.status !== 'active') {
      throw notFound(ResponseCode.user_not_exist, '用户不存在');
    }
    return {
      id: user.id,
      displayName: user.displayName,
      avatar: user.avatar,
      bio: user.bio,
      createTime: user.createTime,
    };
  }
}
