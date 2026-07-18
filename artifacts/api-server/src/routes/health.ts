import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/", (_req, res) => {
  res.json({ status: "ok", message: "API is healthy" });
});

router.get("/healthz", (_req, res) => {
  try {
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch {
    res.status(500).json({ status: "error" });
  }
});

export default router;
