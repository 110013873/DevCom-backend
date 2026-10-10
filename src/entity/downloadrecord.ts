import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Resource } from './resource';
import { User } from './user';

/**
 * 下载记录。既用于「我的下载」列表，也是下载量统计与风控的依据。
 *
 * 不做唯一约束 —— 同一用户重复下载同一文件应各记一条（便于分析真实使用频度）；
 * 下载量计数在 [[Resource]] 上做冗余累加，不靠本表 count。
 */
@Entity('download_records')
@Index('idx_download_records_user', ['userId', 'createTime'])
@Index('idx_download_records_resource', ['resourceId'])
export class DownloadRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  user: User | null;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => Resource, { nullable: false, onDelete: 'CASCADE' })
  resource: Resource;

  @Column({ type: 'uuid', nullable: false })
  resourceId: string;

  @Column({ type: 'uuid', nullable: true })
  versionId: string | null;

  @Column({ type: 'uuid', nullable: true })
  fileId: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  ip: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;
}
