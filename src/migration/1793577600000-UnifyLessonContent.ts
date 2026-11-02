import { MigrationInterface, QueryRunner } from 'typeorm';

/** 将旧 video/doc 课时的外链合入 Markdown 正文，保留原正文和 externalUrl。 */
export class UnifyLessonContent1793577600000 implements MigrationInterface {
  name = 'UnifyLessonContent1793577600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: {
      id: string; type: string; content: string; externalUrl: string | null;
    }[] = await queryRunner.query(
      `SELECT id, type, content, "externalUrl"
       FROM "service"."lessons" WHERE type IN ('video', 'doc')`
    );

    const updates = rows.map(row => {
      const content = row.content ?? '';
      const link = row.externalUrl?.trim();
      // 兼容缺少媒体地址的历史课时：保留正文，不阻断迁移及服务启动。
      if (!link) {
        return { id: row.id, type: row.type, content };
      }
      // URL 中的空格、括号等不能破坏 Markdown 链接；保留原 URL 列不变。
      const url = link.replace(/[\s()<>\\]/g, char => char === '(' ? '%28' : char === ')' ? '%29' : encodeURIComponent(char));
      const media = row.type === 'video' ? `![video](${url})` : `[文档](${url})`;
      return {
        id: row.id,
        type: row.type,
        content: content.includes(media) ? content : (content ? content + '\n\n' : '') + media,
      };
    });

    for (const row of updates) {
      await queryRunner.query(
        `UPDATE "service"."lessons" SET content = $1, type = 'markdown'
         WHERE id = $2 AND type = $3`,
        [row.content, row.id, row.type]
      );
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // 不能假装回滚成功并删除迁移记录；原类型无法从 Markdown 可靠推断。
    throw new Error('课时内容合并无法自动回滚，请使用迁移前的数据库备份恢复');
  }
}
