import * as cors from 'cors';
import * as express from 'express';
import { createServer, Server, STATUS_CODES } from 'http';
import * as jwt from 'jsonwebtoken';
import { Action, HttpError, useExpressServer } from 'routing-controllers';
import type { AuthorizationChecker } from 'routing-controllers/types/AuthorizationChecker';
import type { CurrentUserChecker } from 'routing-controllers/types/CurrentUserChecker';
import { StatusCodes } from 'http-status-codes';
import { config } from '../config';
import { ResponseCode } from './types';

export class AppError extends Error {
  public code: string;
  public httpCode: number;
  public data: unknown;

  constructor(code: string, message?: string, httpCode?: number, data?: unknown) {
    super(message);
    this.code = code;
    this.httpCode = httpCode ?? StatusCodes.BAD_REQUEST;
    this.data = data;
  }
}

export function badRequest(code: string, message?: string, data?: unknown): AppError {
  return new AppError(code, message, StatusCodes.BAD_REQUEST, data);
}

export function notFound(code: string, message?: string, data?: unknown): AppError {
  return new AppError(code, message, StatusCodes.NOT_FOUND, data);
}

export function unauthorized(code: string, message?: string, data?: unknown): AppError {
  return new AppError(code, message, StatusCodes.UNAUTHORIZED, data);
}

export function forbidden(code: string, message?: string, data?: unknown): AppError {
  return new AppError(code, message, StatusCodes.FORBIDDEN, data);
}

export function tooManyRequests(code: string, message?: string, data?: unknown): AppError {
  return new AppError(code, message, StatusCodes.TOO_MANY_REQUESTS, data);
}

export interface AuthorizedUser {
  id: string;
  name: string;
  roles: string[];
  /** 账号是否处于可用状态（封禁即失效） */
  isActive?: boolean;
}

/**
 * 社区角色基线（功能清单 §18.3）。
 * 权限由低到高：visitor < member < author < moderator < mentor < ops_admin < sys_admin
 */
export const VISITOR = 'visitor';
export const MEMBER = 'member';
export const AUTHOR = 'author';
export const MODERATOR = 'moderator';
export const MENTOR = 'mentor';
export const OPS_ADMIN = 'ops_admin';
export const SYS_ADMIN = 'sys_admin';

export const SYS_ADMINS = [SYS_ADMIN];
export const OPS_ADMINS = [...SYS_ADMINS, OPS_ADMIN];
export const MODERATORS = [...OPS_ADMINS, MODERATOR];
export const MENTORS = [...MODERATORS, MENTOR];
export const AUTHORS = [...MENTORS, AUTHOR];
export const MEMBERS = [...AUTHORS, MEMBER];
export const ALL_ROLES = [...MEMBERS, VISITOR];

export function isSysAdmin(user: AuthorizedUser): boolean {
  return user.roles.some(r => SYS_ADMINS.includes(r));
}

export function isOpsAdmin(user: AuthorizedUser): boolean {
  return user.roles.some(r => OPS_ADMINS.includes(r));
}

export function isModerator(user: AuthorizedUser): boolean {
  return user.roles.some(r => MODERATORS.includes(r));
}

export function isMentor(user: AuthorizedUser): boolean {
  return user.roles.some(r => MENTORS.includes(r));
}

export function isAuthor(user: AuthorizedUser): boolean {
  return user.roles.some(r => AUTHORS.includes(r));
}

/** 是否具备后台访问权限 */
export function isAdmin(user: AuthorizedUser): boolean {
  return isOpsAdmin(user);
}

/** 是否为注册会员（含作者及以上） */
export function isMember(user: AuthorizedUser): boolean {
  return user.roles.some(r => MEMBERS.includes(r));
}

export interface JwtPayload {
  sub: string;
  name: string;
  exp: number;
  roles: string[];
  isActive?: boolean;
}

export interface HttpServerOptions {
  port: number;
  application: string;
  controllers: string[];
  publicKey?: string;
}

const requestLogger = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.info(`Receiving ${req.method} request ${req.path}`);
  next();
};

function authorizationChecker(publicKey: string): AuthorizationChecker {
  return async (action: Action, roles: string[]): Promise<boolean> => {
    let token: string | undefined = action.request.headers['authorization'];
    if (!token || !/^Bearer\s/i.test(token)) {
      throw unauthorized('token_empty');
    }
    token = token.replace(/^Bearer\s/i, '');
    return new Promise((resolve, reject) => {
      jwt.verify(token as string, publicKey, (error, decoded) => {
        if (error) {
          console.error(error);
          return reject(unauthorized('token_expired'));
        }
        const payload = decoded as JwtPayload;
        if (roles.length > 0 && roles.every(r => !payload.roles.includes(r))) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  };
}

function currentUserChecker(): CurrentUserChecker {
  return async (action: Action): Promise<AuthorizedUser> => {
    let token: string | undefined = action.request.headers['authorization'];
    if (!token || !/^Bearer\s/.test(token)) {
      throw unauthorized('token_empty');
    }
    token = token.replace(/^Bearer\s/i, '');
    const payload = jwt.decode(token) as JwtPayload;
    return {
      id: payload.sub,
      name: payload.name,
      roles: payload.roles ?? [],
      isActive: payload.isActive,
    };
  };
}

export async function initializeHttpServer(options: HttpServerOptions): Promise<Server> {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1000mb' }));
  app.use(cors());
  app.use(requestLogger);
  app.use('/static/video', express.static(config.cache.videoClipPath));
  app.use('/static/audio', express.static(config.cache.audioClipPath));
  app.use('/static/image', express.static(config.cache.imageClipPath));
  app.use('/static/docs', express.static(config.cache.docPath));

  const server = createServer(useExpressServer(app, {
    controllers: options.controllers,
    authorizationChecker: options.publicKey ? authorizationChecker(options.publicKey) : undefined,
    currentUserChecker: options.publicKey ? currentUserChecker() : undefined,
    defaultErrorHandler: false,
  }));

  // health check
  app.get('/', (req, res) => {
    res.status(200).json({
      'application': options.application,
    });
  });

  // error handler
  app.use((err: Error | HttpError | AppError, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err);
    if (err instanceof AppError) {
      res.status(err.httpCode).json({ code: err.code, message: err.message || undefined, data: err.data });
      return;
    }
    // 框架抛出的 HttpError（例如 body 校验失败）统一收敛为 {code,message} 信封，
    // 不再把 routing-controllers 的 errors 明细原样外泄。
    if ('httpCode' in err) {
      const httpCode = (err as HttpError).httpCode;
      res.status(httpCode).json({
        code: httpCode === StatusCodes.BAD_REQUEST ? ResponseCode.invalid_request : (STATUS_CODES[httpCode] || 'unknown'),
        message: httpCode === StatusCodes.BAD_REQUEST ? '请求参数校验失败' : err.message,
      });
      return;
    }
    // 未预期的异常：只记服务端日志，响应体不携带内部错误文本（含数据库报错），避免信息泄漏
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      code: ResponseCode.internal_server_error,
      message: '服务器内部错误，请稍后重试',
    });
  });

  // 未匹配到任何路由时兜底为 JSON，避免 Express 默认返回 HTML 页面。
  //
  // 必须先判断 headersSent：routing-controllers 的 handleSuccess 在
  // response.json() 之后还会再调一次 next()（用于驱动 after-middleware），
  // 而本项目控制器均未挂 after-middleware，该次 next() 会一路冒泡到这里。
  // 若不跳过，就会对已完成的响应二次发送，抛 ERR_HTTP_HEADERS_SENT。
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      return next();
    }
    res.status(StatusCodes.NOT_FOUND).json({
      code: ResponseCode.invalid_request,
      message: `接口不存在：${req.method} ${req.path}`,
    });
  });

  return new Promise((resolve => {
    server.listen(options.port, () => {
      console.log(`Http server is running on http://localhost:${options.port}`);
      resolve(server);
    });
  }));
}
