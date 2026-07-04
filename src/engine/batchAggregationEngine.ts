"use strict";

import { ExecutionBatch, TradeIntent } from "../models.js";
import { createCommitmentRoot } from "../privacy/commitments.js";

type BatchPlan = {
    batch: ExecutionBatch;
    intents: TradeIntent[];
};

function groupingKey(intent: TradeIntent): string {
    return [
        intent.inputMint,
        intent.outputMint,
        intent.side,
        intent.maxSlippageBps
    ].join(":");
}

export function buildBatchPlans(intents: TradeIntent[]): BatchPlan[] {
    const groups = new Map<string, TradeIntent[]>();

    intents.forEach(intent => {
        const key = groupingKey(intent);
        const current = groups.get(key) ?? [];
        current.push(intent);
        groups.set(key, current);
    });

    return Array.from(groups.values()).map(group => {
        const sorted = group.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const totalAmount = sorted.reduce((sum, intent) => sum + BigInt(intent.amountIn), 0n);
        const commitments = sorted.map(intent => intent.intentCommitment ?? "");

        return {
            intents: sorted,
            batch: {
                inputMint: sorted[0].inputMint,
                outputMint: sorted[0].outputMint,
                totalAmountIn: totalAmount.toString(),
                intentCount: sorted.length,
                aggregationWindowStartedAt: sorted[0].createdAt,
                aggregationWindowClosedAt: new Date().toISOString(),
                status: "forming",
                commitmentRoot: createCommitmentRoot(commitments)
            }
        };
    });
}
