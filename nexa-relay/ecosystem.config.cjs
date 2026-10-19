/** PM2 进程配置：pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: "nexa-relay",
      script: "src/index.js",
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
