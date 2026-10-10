import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ClipCategory, ClipType } from '../component/common/types';
import { User } from './user';

/**
 * 上传附件。OSS / 本地存储的位置、原始文件名与类型一并留档，
 * 业务实体只引用 attachmentId，避免同一文件被重复上传。
 */
@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  originalName: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  filename: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  mimeType: string | null;

  @Column({ type: 'bigint', nullable: false, default: 0 })
  size: number;

  /** 存储 key（OSS object key 或本地相对路径） */
  @Column({ type: 'text', nullable: false })
  storageKey: string;

  @Column({ type: 'text', nullable: false })
  url: string;

  @Column({ type: 'varchar', length: 20, nullable: false })
  type: ClipType;

  @Column({ type: 'varchar', length: 20, nullable: false, default: 'custom' })
  category: ClipCategory;

  /** 业务用途：avatar / cover / news / resource / course ... */
  @Index('idx_attachments_purpose')
  @Column({ type: 'varchar', length: 40, nullable: false, default: 'generic' })
  purpose: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  uploader: User | null;

  @Column({ type: 'uuid', nullable: true })
  uploaderId: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;
}
