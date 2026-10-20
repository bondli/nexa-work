/** PM2 进程配置：pm2 start ecosystem.config.cjs
 * 部署前先执行 npm run build 把 TS 编译到 dist/
 */
module.exports = {
  apps: [
    {
      name: "nexa-relay",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: "200M",
      env: {
        NODE_ENV: "production",
        PORT: "8787",
      },
    },
  ],
}
