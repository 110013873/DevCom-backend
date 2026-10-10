import { Get, JsonController, Param, QueryParam } from 'routing-controllers';
import { getRepository } from 'common-db-node/dist/db';
import { LegalDocument, LegalDocumentType } from '../entity/legaldocument';
import { notFound } from '../component/common/http';
import { ResponseCode } from '../component/common/types';

const TYPES: LegalDocumentType[] = ['user_agreement', 'privacy_policy'];

@JsonController('/v1/legal')
export class LegalController {
  /**
   * 取当前生效的协议/隐私政策。默认返回最新生效版本。
   * 传 version 可查询历史版本（用于审计留存）。
   */
  @Get('/:type')
  async get(
    @Param('type') type: string,
    @QueryParam('version') version?: string
  ) {
    if (!TYPES.includes(type as LegalDocumentType)) {
      throw notFound(ResponseCode.legal_document_not_found, '未知的文档类型');
    }
    const docType = type as LegalDocumentType;

    const repository = getRepository(LegalDocument);
    const document = version
      ? await repository.findOne({ where: { type: docType, version } })
      : await repository.findOne({ where: { type: docType, isActive: true }, order: { effectiveDate: 'DESC' } });

    if (!document) {
      throw notFound(ResponseCode.legal_document_not_found, '文档尚未发布');
    }

    return {
      id: document.id,
      type: document.type,
      version: document.version,
      effectiveDate: document.effectiveDate,
      contentHtml: document.contentHtml,
      lang: document.lang,
      updateTime: document.updateTime,
    };
  }
}
