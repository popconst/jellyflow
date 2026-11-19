// pm2 start ecosystem.config.cjs: the built app (npm run build first) as a
// local web service on http://127.0.0.1:4173. Node runs server.ts as it is.
module.exports = {
  apps: [
    {
      name: 'jellyflow',
      script: 'server.ts',
      interpreter: 'node',
      cwd: __dirname,
      env: { HOST: '127.0.0.1', PORT: 4173 },
    },
  ],
}
