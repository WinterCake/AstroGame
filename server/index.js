import "dotenv/config";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { ensureDataDirs } from "../src/paths.js";
import { registerRoutes } from "./register-routes.js";

const PORT = Number(process.env.ASTROGAME_UI_PORT) || 3847;
const HOST = process.env.ASTROGAME_UI_HOST || "127.0.0.1";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

ensureDataDirs();

const app = Fastify({ logger: false });

await app.register(cors, { origin: true });
registerRoutes(app);

const webDist = join(ROOT, "web", "dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: "/" });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api")) {
      reply.code(404).send({ error: "Not found" });
    } else {
      reply.sendFile("index.html");
    }
  });
}

export { app };

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  await app.listen({ port: PORT, host: HOST });
  console.log(`AstroGame UI → http://${HOST}:${PORT}`);
}
