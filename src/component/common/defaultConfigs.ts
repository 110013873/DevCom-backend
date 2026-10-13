import { SystemConfig } from '../../entity/systemconfig';

/**
 * 新闻分类：前台筛选器与后台编辑器共用的一份词表。
 *
 * `value` 入库（写进 `News.category`），`label` 用于展示。放在后端下发而不是
 * 前端硬编码，是因为它同时决定两件事 —— 前台能筛什么、后台能选什么。
 * 两处各维护一份，迟早出现「后台选得到、前台筛不出」的漂移。
 */
export const DEFAULT_NEWS_CATEGORIES = [
  { value: 'industry-news', label: '行业资讯' },
  { value: 'tech-frontier', label: '技术前沿' },
  { value: 'company-news', label: '企业动态' },
  { value: 'academic-research', label: '学术研究' },
  { value: 'product-case', label: '产品案例' },
];

/**
 * 默认运营配置。仅在键不存在时写入，后续由后台「系统 → 配置」维护，
 * 不会因为重新部署而被覆盖。
 *
 * 这份种子同时也是 `configService` 的**兜底默认值来源**：配置表是稀疏的，
 * 某个键若在库中不存在（或值被写坏），读取方回落到这里，而不是各自写一份
 * `?? {}`。因此改这里就等于改全站的默认表现，改动前想清楚。
 */
export const DEFAULT_SYSTEM_CONFIGS: Array<Pick<SystemConfig, 'key' | 'value' | 'description'>> = [
  {
    key: 'site_brand',
    value: {
      name: 'TileLang for RISC-V 社区',
      shortName: 'TileLang AI 社区',
      slogan: '开放协作，共建 TileLang for RISC-V 的开源生态',
      // 页头是深蓝实底，这份 logo 图形为白色，放上去正合适
      logoUrl: '/logo.svg',
    },
    description: '站点品牌信息（名称、标语、Logo）',
  },
  {
    key: 'site_footer',
    value: {
      contactEmail: 'contact@tlaic.ac.cn',
      icp: '',
      publicSecurity: '',
      links: [
        { label: '通明湖信息技术应用创新中心', url: 'https://www.tlaic.ac.cn' },
      ],
    },
    description: '页脚联系信息与备案号',
  },
  {
    key: 'feature_flags',
    value: {
      allowRegister: true,
      allowComment: true,
      allowResourceDownloadWithoutLogin: false,
    },
    description: '功能开关',
  },
  {
    key: 'news_categories',
    value: DEFAULT_NEWS_CATEGORIES,
    description: '新闻分类词表（前台筛选与后台编辑器共用）',
  },
];
