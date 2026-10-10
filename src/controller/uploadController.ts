import { Authorized, Body, CurrentUser, JsonController, Post, QueryParams, Req, UploadedFiles } from 'routing-controllers';
import { Request } from 'express';
import { getRepository } from 'common-db-node/dist/db';
import { Attachment } from '../entity/attachment';
import { ClipCategory, ClipType, ResponseCode } from '../component/common/types';
import { AuthorizedUser, badRequest } from '../component/common/http';
import { AUDIT_MODULES } from '../component/common/constants';
import { MAX_UPLOAD_BYTES, storeFile } from '../component/service/storageService';
import { ipOf, recordAudit } from '../component/service/auditService';

/** purpose → 允许的扩展名分组（与 storageService.ALLOWED_EXTENSIONS 对应） */
const PURPOSE_ALLOWED: Record<string, { groups: string[]; type: ClipType }> = {
  image: { groups: ['image'], type: ClipType.Image },
  avatar: { groups: ['image'], type: ClipType.Image },
  cover: { groups: ['image'], type: ClipType.Image },
  video: { groups: ['video'], type: ClipType.Video },
  audio: { groups: ['audio'], type: ClipType.Audio },
  document: { groups: ['document'], type: ClipType.Document },
  resource: { groups: ['document', 'archive'], type: ClipType.Document },
};

/**
 * purpose 同时接受 query 与 multipart 表单字段。
 *
 * 前端 `uploadFile` 把它拼在 URL query 上（`?purpose=cover`），而 multipart
 * 的正文只有文件本身，`@Body()` 读不到 query。此前只读 body，于是 purpose
 * 静默退化为默认值 `document`，上传封面（.png）被扩展名白名单拒绝，报
 * 「不支持的文件类型 .png」—— 像是扩展名不合法，实则是参数没收到。
 * 两种都收，避免调用方被这个细节绊住。
 */
class UploadQuery {
  purpose?: string;
}

@JsonController('/v1/upload')
export class UploadController {
  /**
   * 通用附件上传。仅登录用户可上传，返回附件记录与可访问 URL。
   * 本地模式落盘到 CACHE_*_PATH；OSS 模式上传对象存储。
   */
  @Post()
  @Authorized()
  async upload(
    @UploadedFiles('files', { options: { limits: { fileSize: MAX_UPLOAD_BYTES } } }) files: Express.Multer.File[],
    @Body() body: UploadQuery,
    @QueryParams() query: UploadQuery,
    @CurrentUser() current: AuthorizedUser,
    @Req() req: Request
  ) {
    const purpose = (query.purpose || body.purpose || 'document').toLowerCase();
    const rule = PURPOSE_ALLOWED[purpose];
    if (!rule) {
      throw badRequest(ResponseCode.invalid_request, `不支持的用途 ${purpose}`);
    }
    if (!files?.length) {
      throw badRequest(ResponseCode.upload_file_failed, '未收到上传文件');
    }

    const repository = getRepository(Attachment);
    const results = [];

    for (const file of files) {
      if (!file.buffer?.length) {
        throw badRequest(ResponseCode.upload_file_failed, `文件 ${file.originalname} 内容为空`);
      }
      const stored = await storeFile(file.buffer, file.originalname, purpose, rule.groups);
      const entity = repository.create({
        originalName: decodeOriginalName(file.originalname),
        filename: decodeOriginalName(file.originalname),
        mimeType: file.mimetype,
        // multer 的 size 是 number，落库为 bigint 列
        size: String(file.size) as unknown as number,
        storageKey: stored.storageKey,
        url: stored.url,
        type: rule.type,
        category: ClipCategory.custom,
        purpose,
        uploaderId: current.id,
      });
      const attachment = await repository.save(entity);

      results.push({
        id: attachment.id,
        url: stored.url,
        originalName: attachment.originalName,
        size: file.size,
        mimeType: file.mimetype,
      });
    }

    await recordAudit({
      userId: current.id,
      adminName: current.name,
      action: `上传附件(${purpose})`,
      module: AUDIT_MODULES.upload,
      targetType: 'attachment',
      targetId: results.map(r => r.id).join(','),
      ip: ipOf(req),
      details: { count: results.length, purpose },
    });

    return results;
  }
}

/** multer 用 latin1 解析文件名，中文名需要转回 utf-8 */
function decodeOriginalName(name: string): string {
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf-8');
    return decoded.includes('�') ? name : decoded;
  } catch {
    return name;
  }
}
