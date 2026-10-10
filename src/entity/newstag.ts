import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { News } from './news';
import { Tag } from './tag';

/**
 * 新闻 ↔ 标签关联表。
 *
 * 用关联表而非 portal 的 `simple-array`：只有独立成行，标签才能被重命名、
 * 统计使用量、以及做「同标签推荐」的反查。
 */
@Entity('news_tags')
@Index('idx_news_tags_news', ['newsId'])
@Index('idx_news_tags_tag', ['tagId'])
@Index('idx_news_tags_unique', ['newsId', 'tagId'], { unique: true })
export class NewsTag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => News, { nullable: false, onDelete: 'CASCADE' })
  news: News;

  @Column({ type: 'uuid', nullable: false })
  newsId: string;

  @ManyToOne(() => Tag, { nullable: false, onDelete: 'CASCADE' })
  tag: Tag;

  @Column({ type: 'uuid', nullable: false })
  tagId: string;
}
