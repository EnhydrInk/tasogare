module.exports = {
  apps: [{
    name: "tasogare",
    script: "server.mjs",
    interpreter: "node",
    env: { NODE_ENV: "production" }
  }]
};
