import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const server = createApp();

server.listen(config.port, () => {
  console.log(`GiftBot server listening on port ${config.port} (${config.nodeEnv})`);
});
