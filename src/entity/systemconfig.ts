import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 运营配置（品牌名、页脚、功能开关）。value 为 jsonb，键值由后台维护，
 * 无需为每个开关新增列。
 */
@Entity('system_configs')
export class SystemConfig {
  @PrimaryColumn({ type: 'varchar', length: 80 })
  key: string;

  @Column({ type: 'jsonb', nullable: true })
  value: unknown;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @UpdateDateColumn({ type: 'timestamp with time zone', nullable: false, default: () => 'now()' })
  updateTime: Date;
}
