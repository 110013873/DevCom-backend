import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** 内容状态：草稿 / 已发布 / 已归档 */
export type NewsStatus = 'draft' | 'published' | 'archived';

export const NEWS_STATUSES: readonly NewsStatus[] = ['draft', 'published', 'archived'];

/**
 * 社区新闻 / 动态。
 *
 * `content` 存 Markdown 源（jsonb，兼容后续富文本结构），`contentHtml` 存渲染结果，
 * 列表接口只返回 `summary`，正文一律走 Markdown 渲染管线 —— 原站把 Markdown 原文
 * 直接铺到头条的做法不再沿用。
 */
@Entity('news')
@Index('idx_news_status_published', ['status', 'publishedAt'])
@Index('idx_news_category_status', ['category', 'status'])
export class News {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200, nullable: false })
  title: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  subtitle: string | null;

  @Column({ type: 'text', nullable: false, default: '' })
  summary: string;

  @Column({ type: 'text', nullable: true })
  coverImage: string | null;

  /** Markdown 源。结构化存放以便日后扩展（引用、附件等） */
  @Column({ type: 'jsonb', nullable: true })
  content: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: false, default: '' })
  contentHtml: string;

  @Index('idx_news_category')
  @Column({ type: 'varchar', length: 40, nullable: false, default: 'industry-news' })
  category: string;

  /** 署名字符串，与登录账号解耦：可署「中心」「编辑部」等 */
  @Column({ type: 'varchar', length: 60, nullable: true })
  author: string | null;

  @Index('idx_news_published_at')
  @Column({ type: 'timestamp with time zone', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: false, default: 'draft' })
  status: NewsStatus;

  /** SEO 友好的稳定标识。可空 —— 路由以 id 为准，slug 仅作美化链接 */
  @Index('idx_news_slug', { unique: true })
  @Column({ type: 'varchar', length: 220, nullable: true })
  slug: string | null;

  @Column({ type: 'int', nullable: false, default: 0 })
  viewCount: number;

  @Column({ type: 'boolean', nullable: false, default: false })
  isFeatured: boolean;

  @Column({ type: 'boolean', nullable: false, default: true })
  isActive: boolean;

  @Column({ type: 'int', nullable: false, default: 0 })
  sortOrder: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  seoTitle: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  seoDescription: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  seoKeywords: string | null;

  @Column({ type: 'varchar', length: 10, nullable: false, default: 'zh' })
  lang: string;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedById: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  updateTime: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deleteTime: Date | null;
}
