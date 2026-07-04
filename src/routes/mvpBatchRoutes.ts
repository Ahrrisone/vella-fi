"use strict";

import { Router } from "express";
import { buildBatchPlans } from "../engine/batchAggregationEngine.js";
import { allocateBatchFills, simulateBatchExecution } from "../engine/executionEngine.js";
import { getLiquidityRoutes, selectBestRoute } from "../engine/liquidityRouter.js";
import { createRouteHash } from "../privacy/commitments.js";
import {
    createExecutionBatch,
    getBatchAllocations,
    getBatchIntents,
    getExecutionBatch,
    getExecutionBatches,
    getPendingTradeIntents,
    insertBatchAllocation,
    insertLiquiditySnapshot,
    settleExecutionBatch,
    updateExecutionBatchAfterQuote
} from "../db/schema.js";

const router = Router();

router.post("/batches/aggregate", (req, res) => {
    getPendingTradeIntents((intents) => {
        const plans = buildBatchPlans(intents);

        if (plans.length === 0) {
            return res.json({ created: [], message: "No pending intents available for aggregation" });
        }

        const created: any[] = [];
        let processed = 0;

        plans.forEach(plan => {
            createExecutionBatch(plan.batch, plan.intents, (batchId) => {
                created.push({
                    batchId,
                    inputMint: plan.batch.inputMint,
                    outputMint: plan.batch.outputMint,
                    totalAmountIn: plan.batch.totalAmountIn,
                    intentCount: plan.batch.intentCount,
                    commitmentRoot: plan.batch.commitmentRoot
                });
                processed++;
                if (processed === plans.length) {
                    res.status(201).json({ created });
                }
            });
        });
    });
});

router.get("/execution-batches", (_req, res) => {
    getExecutionBatches((batches) => res.json(batches));
});

router.get("/execution-batches/:id", (req, res) => {
    const batchId = Number(req.params.id);
    if (!Number.isInteger(batchId)) {
        return res.status(400).json({ error: "Invalid batch ID" });
    }

    getExecutionBatch(batchId, (batch) => {
        if (!batch) return res.status(404).json({ error: "Batch not found" });
        getBatchAllocations(batchId, typeof req.query.ownerWallet === "string" ? req.query.ownerWallet : undefined, (allocations) => {
            res.json({
                ...batch,
                allocations,
                privacy: {
                    publicCommitment: batch.commitmentRoot,
                    publicFieldsOnly: !req.query.ownerWallet
                }
            });
        });
    });
});

router.post("/execution-batches/:id/quote", (req, res) => {
    const batchId = Number(req.params.id);
    if (!Number.isInteger(batchId)) {
        return res.status(400).json({ error: "Invalid batch ID" });
    }

    getExecutionBatch(batchId, async (batch) => {
        if (!batch) return res.status(404).json({ error: "Batch not found" });

        try {
            const routes = await getLiquidityRoutes({
                inputMint: batch.inputMint,
                outputMint: batch.outputMint,
                amountIn: batch.totalAmountIn,
                maxSlippageBps: req.body?.maxSlippageBps
            });
            routes.forEach(route => insertLiquiditySnapshot(route));

            const selected = selectBestRoute(routes);
            if (!selected) {
                return res.status(422).json({ error: "No live route satisfies batch constraints" });
            }

            const routeHash = createRouteHash(selected);
            updateExecutionBatchAfterQuote(batchId, selected, routeHash, () => {
                res.json({ batchId, selectedRoute: selected, routeHash, alternatives: routes });
            });
        } catch (error) {
            res.status(502).json({
                error: "Live batch quote failed",
                details: error instanceof Error ? error.message : String(error)
            });
        }
    });
});

router.post("/execution-batches/:id/execute", (req, res) => {
    const batchId = Number(req.params.id);
    if (!Number.isInteger(batchId)) {
        return res.status(400).json({ error: "Invalid batch ID" });
    }

    getExecutionBatch(batchId, async (batch) => {
        if (!batch) return res.status(404).json({ error: "Batch not found" });

        try {
            const routes = await getLiquidityRoutes({
                inputMint: batch.inputMint,
                outputMint: batch.outputMint,
                amountIn: batch.totalAmountIn,
                maxSlippageBps: req.body?.maxSlippageBps
            });
            const selected = routes.find(route => route.poolOrRouteId === batch.selectedRouteId) ?? selectBestRoute(routes);
            if (!selected) {
                return res.status(422).json({ error: "No executable live route available" });
            }

            const routeHash = createRouteHash(selected);
            const quotedBatch = { ...batch, routeHash };
            const result = simulateBatchExecution(quotedBatch, selected);

            getBatchIntents(batchId, (intents) => {
                const allocations = allocateBatchFills(batchId, intents, selected.quotedAmountOut, result.actualAmountOut);
                allocations.forEach(allocation => insertBatchAllocation(allocation));
                updateExecutionBatchAfterQuote(batchId, selected, routeHash, () => {
                    settleExecutionBatch(
                        batchId,
                        result.actualAmountOut,
                        result.actualSlippageBps,
                        result.txSignature,
                        result.executionResultHash,
                        () => {
                            res.json({
                                batchId,
                                mode: "quote-backed-settlement-preview",
                                selectedRoute: selected,
                                routeHash,
                                ...result,
                                allocations,
                                privacy: {
                                    commitmentRoot: batch.commitmentRoot,
                                    note: "Day 1/2 executes allocation against live quote data only; signed swap submission is a later milestone."
                                }
                            });
                        }
                    );
                });
            });
        } catch (error) {
            res.status(502).json({
                error: "Live execution preview failed",
                details: error instanceof Error ? error.message : String(error)
            });
        }
    });
});

export default router;
