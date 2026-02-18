import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { CueExecutor } from "./services/executor.js";

const app = createApp();

app.listen(config.port, () => {
  logger.info({ port: config.port }, "API listening");
});

const executor = new CueExecutor();
executor.startPolling();
