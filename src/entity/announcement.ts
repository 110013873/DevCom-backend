import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 首页公告条。`position` 决定展示位置（如 home_top / home_side），
 * `startAt` / `endAt` 控制有效期 —— 前台只取当前时间落在区间内且 isActive 的记录。
 */
@Entity('announcements')
@Index('idx_announcements_position_active', ['position', 'isActive'])
export class Announcement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200, nullable: false })
  title: string;

  @Column({ type: 'text', nullable: false, default: '' })
  content: string;

  @Column({ type: 'varchar', length: 40, nullable: false, default: 'home_top' })
  position: string;

  @Column({ type: 'timestamp with time zone', nullable: true })
  startAt: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  endAt: Date | null;

  @Index('idx_announcements_active')
  @Column({ type: 'boolean', nullable: false, default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  createTime: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  updateTime: Date;
}
