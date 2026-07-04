"use strict";

import express from "express";
import bodyParser from "body-parser";
import agentRoutes from "./routes/agentRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import batchRoutes from "./routes/batchRoutes.js";
import intentRoutes from "./routes/intentRoutes.js";
import liquidityRoutes from "./routes/liquidityRoutes.js";
import mvpBatchRoutes from "./routes/mvpBatchRoutes.js";
import proofRoutes from "./routes/proofRoutes.js";
import settlementRoutes from "./routes/settlementRoutes.js";
import { validateRuntimeConfig } from "./config.js";
import { initializeDatabase } from "./db/schema.js";

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

try {
    validateRuntimeConfig();
} catch (error) {
    console.error("Fatal configuration error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
}

// Middleware
app.use(bodyParser.json());

// Initialize database
initializeDatabase();

// Routes
app.use("/api", batchRoutes);
app.use("/api", intentRoutes);
app.use("/api", mvpBatchRoutes);
app.use("/api", liquidityRoutes);
app.use("/api", agentRoutes);
app.use("/api", analyticsRoutes);
app.use("/api", proofRoutes);
app.use("/api", settlementRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
});

// Start server
app.listen(PORT, () => {
    console.log(`Vella Finance API running on port ${PORT}`);
});

// Graceful shutdown
export default app;
