"use strict";

import { Router } from "express";
import { createIntentCommitment } from "../privacy/commitments.js";
import { insertTradeIntent, getTradeIntents, getTradeIntent } from "../db/schema.js";
import { RouteConstraints, TradeIntent } from "../models.js";

const router = Router();

function defaultRouteConstraints(input?: Partial<RouteConstraints>): RouteConstraints {
    return {
        allowJupiter: input?.allowJupiter ?? true,
        allowRaydium: input?.allowRaydium ?? true,
        maxRouteHops: input?.maxRouteHops,
        excludedPools: input?.excludedPools ?? []
    };
}

function isSolanaAddress(value: string): boolean {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

router.post("/intents", (req, res) => {
    const {
        ownerWallet,
        agentId,
        inputMint,
        outputMint,
        side = "swap",
        amountIn,
        minAmountOut,
        maxSlippageBps,
        executionWindowMs = 30000,
        routeConstraints,
        signature
    } = req.body;

    if (!ownerWallet || !inputMint || !outputMint || !amountIn || !signature) {
        return res.status(400).json({
            error: "ownerWallet, inputMint, outputMint, amountIn, and signature are required"
        });
    }

    if (!["buy", "sell", "swap"].includes(side)) {
        return res.status(400).json({ error: "side must be buy, sell, or swap" });
    }

    if (!isSolanaAddress(inputMint) || !isSolanaAddress(outputMint)) {
        return res.status(400).json({ error: "inputMint and outputMint must be Solana mint addresses, not token symbols" });
    }

    if (!/^\d+$/.test(String(amountIn)) || BigInt(String(amountIn)) <= 0n) {
        return res.status(400).json({ error: "amountIn must be a positive raw integer amount in atomic token units" });
    }

    const normalizedIntent = {
        ownerWallet,
        agentId,
        inputMint,
        outputMint,
        side,
        amountIn: String(amountIn),
        minAmountOut: minAmountOut ? String(minAmountOut) : undefined,
        maxSlippageBps: Number(maxSlippageBps ?? 100),
        executionWindowMs: Number(executionWindowMs),
        routeConstraints: defaultRouteConstraints(routeConstraints),
        signature
    };

    const intent: TradeIntent = {
        ...normalizedIntent,
        status: "pending",
        intentCommitment: createIntentCommitment(normalizedIntent),
        createdAt: new Date().toISOString()
    };

    insertTradeIntent(intent, (id) => {
        getTradeIntent(id, (createdIntent) => {
            res.status(201).json({
                ...createdIntent,
                privacy: {
                    publicCommitment: createdIntent?.intentCommitment,
                    note: "Raw intent details are wallet-scoped; public batch records expose commitments only."
                }
            });
        });
    });
});

router.get("/intents", (req, res) => {
    const ownerWallet = typeof req.query.ownerWallet === "string" ? req.query.ownerWallet : undefined;
    getTradeIntents(ownerWallet, (intents) => {
        res.json(intents);
    });
});

export default router;
