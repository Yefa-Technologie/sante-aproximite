import { startIncidentNotificationWorker } from "./services/incidentNotifications.js";
import { app } from "./app.js";
import { connectDb } from "./config/db.js";
import { env } from "./config/env.js";
import { ensureRbacTables } from "./controllers/rbacController.js";

async function bootstrap() {
  await connectDb();
  await ensureRbacTables();
  startIncidentNotificationWorker();
  app.listen(env.port, env.host, () => {
    console.log(`API running on http://${env.host}:${env.port}`);
  });
}

bootstrap().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
