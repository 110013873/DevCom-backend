import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ResourceVersion } from './resourceversion';

/**
 * 版本的单个可下载文件（按操作系统 / 架构区分）。前台「文件列表」表格即由此渲染。
 *
 * `checksum` 供下载后校验完整性；`storageKey` 是 OSS object key 或本地相对路径，
 * 下载走鉴权接口，不直接暴露存储地址。
 */
@Entity('resource_files')
@Index('idx_resource_files_version', ['versionId'])
export class ResourceFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ResourceVersion, { nullable: false, onDelete: 'CASCADE' })
  version: ResourceVersion;

  @Column({ type: 'uuid', nullable: false })
  versionId: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  fileName: string;

  /** 目标平台，如 linux-x86_64 / windows-amd64 */
  @Column({ type: 'varchar', length: 60, nullable: true })
  osArch: string | null;

  @Column({ type: 'bigint', nullable: false, default: 0 })
  size: number;

  /** 校验和，如 sha256 摘要；未提供时为空 */
  @Column({ type: 'varchar', length: 128, nullable: true })
  checksum: string | null;

  @Column({ type: 'text', nullable: false })
  storageKey: string;

  @Column({ type: 'text', nullable: false })
  url: string;

  @UpdateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  updateTime: Date;
}
