"use strict";

import { Router } from "express";
import { getLiquidityRoutes } from "../engine/liquidityRouter.js";
import { getLiquiditySnapshots, insertLiquiditySnapshot } from "../db/schema.js";

const router = Router();

router.get("/liquidity/routes", async (req, res) => {
    const inputMint = String(req.query.inputMint ?? "So11111111111111111111111111111111111111112");
    const outputMint = String(req.query.outputMint ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    const amountIn = String(req.query.amountIn ?? "100000000");
    const maxSlippageBps = req.query.maxSlippageBps ? Number(req.query.maxSlippageBps) : undefined;

    try {
        const routes = await getLiquidityRoutes({ inputMint, outputMint, amountIn, maxSlippageBps });
        routes.forEach(route => insertLiquiditySnapshot(route));

        res.json({
            inputMint,
            outputMint,
            amountIn,
            routes,
            providers: ["jupiter", "raydium"]
        });
    } catch (error) {
        res.status(502).json({
            error: "Live liquidity route lookup failed",
            details: error instanceof Error ? error.message : String(error)
        });
    }
});

router.get("/liquidity/snapshots", (req, res) => {
    const inputMint = typeof req.query.inputMint === "string" ? req.query.inputMint : undefined;
    const outputMint = typeof req.query.outputMint === "string" ? req.query.outputMint : undefined;
    getLiquiditySnapshots(inputMint, outputMint, (snapshots) => res.json(snapshots));
});

export default router;
