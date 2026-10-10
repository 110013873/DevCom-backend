import 'reflect-metadata';
import { initializeDb } from 'common-db-node/dist/db';
import { initializeHttpServer } from './component/common/http';
import { config, dbOptions, httpOptions } from './component/config';
import { createCacheDir } from './component/common/util';
import { bootstrap } from './component/bootstrap';
import { Execution } from './component/execution';

(async () => {
  await initializeDb(dbOptions);

  // 幂等初始化：内置角色 / 初始管理员 / 协议文档 / 默认配置
  await bootstrap();

  // 本地存储模式下确保缓存目录存在；OSS 模式同样无害
  createCacheDir(config.cache.videoClipPath);
  createCacheDir(config.cache.audioClipPath);
  createCacheDir(config.cache.imageClipPath);
  createCacheDir(config.cache.docPath);
  createCacheDir(config.cache.uploadTmpPath);

  await initializeHttpServer(await httpOptions());

  const execution = new Execution();
  execution.scheduleTask();
})().catch(error => {
  console.error(`Failed to start application`, error);
  process.exit(1);
});
