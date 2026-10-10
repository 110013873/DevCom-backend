/**
 * TypeORM CLI 数据源（仅用于生成/执行迁移，不参与应用运行）。
 * 应用运行时的连接由 common-db-node 的 initializeDb 建立，见 src/component/config.ts。
 */
require('dotenv').config();
const { DataSource } = require('typeorm');

const dbUrl = process.env.DB_URL || 'postgresql://postgres:postgres@localhost:5432/devcom';

const dataSource = new DataSource({
  type: 'postgres',
  url: dbUrl,
  schema: process.env.DB_SCHEMA || 'service',
  // 迁移针对编译产物生成，因此 typeorm 命令一律放在 npm run build 之后执行
  entities: ['dist/entity/*.js'],
  migrations: ['dist/migration/*.js'],
  cli: {
    migrationsDir: 'src/migration',
  },
});

module.exports = { default: dataSource };
