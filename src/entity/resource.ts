import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type ResourceStatus = 'draft' | 'published' | 'archived';

/** 资源形态，决定详情页突出哪种入门指引 */
export type ResourceCategory =
  | 'isa-extension'
  | 'compiler-toolchain'
  | 'model-operator-library'
  | 'simulation-platform'
  | 'technical-docs';

export const RESOURCE_CATEGORIES: readonly ResourceCategory[] = [
  'isa-extension',
  'compiler-toolchain',
  'model-operator-library',
  'simulation-platform',
  'technical-docs',
];

/**
 * 资源条目本身（如某模型 / 某工具链）。具体可下载的文件挂在
 * [[ResourceVersion]] → [[ResourceFile]] 下，本表只描述「这是什么」。
 *
 * `isPublic=false` 表示隐藏资源：不出现在任何列表与搜索，仅有直链的
 * 已授权用户可访问。服务端在列表、详情、搜索三处都要按此过滤。
 */
@Entity('resources')
@Index('idx_resources_category_public', ['category', 'isPublic'])
@Index('idx_resources_status', ['status', 'publishedAt'])
export class Resource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160, nullable: false })
  name: string;

  @Column({ type: 'text', nullable: false, default: '' })
  summary: string;

  @Column({ type: 'text', nullable: true })
  coverImage: string | null;

  @Index('idx_resources_category')
  @Column({ type: 'varchar', length: 30, nullable: false, default: 'model-operator-library' })
  category: ResourceCategory;

  /** 所属方 / 贡献者署名，与登录账号解耦 */
  @Column({ type: 'varchar', length: 120, nullable: true })
  author: string | null;

  @Column({ type: 'boolean', nullable: false, default: false })
  isRecommended: boolean;

  /** 是否免费。平台首版不代收第三方费用，付费资源只作标识与外链 */
  @Column({ type: 'boolean', nullable: false, default: true })
  isFree: boolean;

  /** 公开 / 隐藏。隐藏资源仅管理员可见（见类注释） */
  @Index('idx_resources_public')
  @Column({ type: 'boolean', nullable: false, default: true })
  isPublic: boolean;

  @Column({ type: 'int', nullable: false, default: 0 })
  downloadCount: number;

  /** 评分聚合，由 [[ResourceRating]] 写入时事务内更新 */
  @Column({ type: 'numeric', precision: 3, scale: 2, nullable: false, default: 0 })
  ratingAvg: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  ratingCount: number;

  @Column({ type: 'text', nullable: false, default: '' })
  overview: string;

  /** 主要特性，一行一条 */
  @Column({ type: 'text', nullable: true })
  keyFeatures: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  supportedArch: string | null;

  @Column({ type: 'text', nullable: true })
  quickStart: string | null;

  @Column({ type: 'text', nullable: true })
  systemRequirements: string | null;

  @Index('idx_resources_slug', { unique: true })
  @Column({ type: 'varchar', length: 200, nullable: true })
  slug: string | null;

  @Column({ type: 'varchar', length: 20, nullable: false, default: 'draft' })
  status: ResourceStatus;

  @Column({ type: 'timestamp with time zone', nullable: true })
  publishedAt: Date | null;

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
