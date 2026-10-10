import { Get, JsonController } from 'routing-controllers';
import { getPublicConfig } from '../component/service/configService';

/**
 * 公开配置。
 *
 * **匿名可读**：页头品牌名、页脚、新闻分类词表都要在未登录时就能渲染，
 * 因此这里没有 `@Authorized()` —— 也不要加 `@CurrentUser()`，那会在无
 * Bearer 头时抛 401，把公开接口变成必须登录才能访问。
 *
 * 只下发 `PUBLIC_CONFIG_KEYS` 里列出的键（见 `configService`），
 * 后台有哪些配置项是另一回事，不因为存在就对外可见。
 */
@JsonController('/v1/config')
export class ConfigController {
  /** 前台渲染所需的公开配置。返回 `{ key: value }` 的扁平对象。 */
  @Get('/')
  async get(): Promise<Record<string, unknown>> {
    return getPublicConfig();
  }
}
