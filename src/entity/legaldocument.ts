import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type LegalDocumentType = 'user_agreement' | 'privacy_policy';

/**
 * 协议与隐私政策，支持版本化：同一 type 下只有一条 isActive=true。
 */
@Entity('legal_documents')
@Index('idx_legal_documents_type_version', ['type', 'version'], { unique: true })
export class LegalDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40, nullable: false })
  type: LegalDocumentType;

  @Column({ type: 'varchar', length: 20, nullable: false })
  version: string;

  @Column({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  effectiveDate: Date;

  /** 结构化内容（Markdown 源），便于后续多端渲染 */
  @Column({ type: 'jsonb', nullable: true })
  content: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: false, default: '' })
  contentHtml: string;

  @Column({ type: 'varchar', length: 10, nullable: false, default: 'zh' })
  lang: string;

  @Index('idx_legal_documents_active')
  @Column({ type: 'boolean', nullable: false, default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  updateTime: Date;
}
