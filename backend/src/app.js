import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import healthCenterRoutes from "./routes/healthCenterRoutes.js";
import complaintRoutes from "./routes/complaintRoutes.js";
import suggestionRoutes from "./routes/suggestionRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import emergencyRoutes from "./routes/emergencyRoutes.js";
import geoRoutes from "./routes/geoRoutes.js";
import securityAlertRoutes from "./routes/securityAlertRoutes.js";
import contactRoutes from "./routes/contactRoutes.js";
import rbacRoutes from "./routes/rbacRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import appSettingsRoutes from "./routes/appSettingsRoutes.js";
import referralRoutes from "./routes/referralRoutes.js";
import pushTokenRoutes from "./routes/pushTokenRoutes.js";
import { errorHandler } from "./middlewares/errorHandler.js";

export const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/version", (req, res) => {
  res.json({ version: "1.0.0", buildNumber: 1 });
});

app.get("/api", (req, res) => {
  res.json({ message: "API Santé Aproximite active" });
});
app.use("/api/auth", authRoutes);
app.use("/api/centers", healthCenterRoutes);
app.use("/api/complaints", complaintRoutes);
app.use("/api/suggestions", suggestionRoutes);
app.use("/api/users", userRoutes);
app.use("/api/emergency-reports", emergencyRoutes);
app.use("/api/geo", geoRoutes);
app.use("/api/security-alerts", securityAlertRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/rbac", rbacRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/settings", appSettingsRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/push-tokens", pushTokenRoutes);

app.use(errorHandler);
