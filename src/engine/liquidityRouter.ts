"use strict";

import { getRuntimeConfig } from "../config.js";
import { LiquiditySnapshot, RouteConstraints } from "../models.js";

type RouteInput = {
    inputMint: string;
    outputMint: string;
    amountIn: string;
    maxSlippageBps?: number;
    routeConstraints?: RouteConstraints;
};

type JupiterQuoteResponse = {
    inputMint: string;
    inAmount: string;
    outputMint: string;
    outAmount: string;
    priceImpactPct?: string;
    slippageBps?: number;
    routePlan?: Array<{
        percent?: number;
        swapInfo?: {
            ammKey?: string;
            label?: string;
            feeAmount?: string;
            feeMint?: string;
        };
    }>;
};

type RaydiumSwapComputeResponse = {
    id?: string;
    success?: boolean;
    data?: {
        inputMint?: string;
        outputMint?: string;
        inputAmount?: string;
        outputAmount?: string;
        amountOut?: string;
        minAmountOut?: string;
        priceImpactPct?: number;
        priceImpact?: number;
        feeBps?: number;
        routePlan?: unknown[];
        routes?: unknown[];
    };
    msg?: string;
};

function assertMint(value: string, fieldName: string): void {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
        throw new Error(`${fieldName} must be a Solana mint address, not a token symbol`);
    }
}

function withTimeout(ms: number): AbortSignal {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms).unref();
    return controller.signal;
}

function asArray(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.data)) return value.data;
    if (Array.isArray(value?.data?.data)) return value.data.data;
    if (Array.isArray(value?.pools)) return value.pools;
    return [];
}

function routeIdFromQuote(quote: JupiterQuoteResponse): string {
    const labels = quote.routePlan
        ?.map(step => step.swapInfo?.label || step.swapInfo?.ammKey)
        .filter(Boolean)
        .join(">");
    return labels || "jupiter-best-route";
}

function routeHopsFromQuote(quote: JupiterQuoteResponse): number {
    return quote.routePlan?.length ?? 0;
}

function feeBpsFromQuote(quote: JupiterQuoteResponse): number | undefined {
    const feeSteps = quote.routePlan?.filter(step => step.swapInfo?.feeAmount && Number(step.swapInfo.feeAmount) > 0).length ?? 0;
    return feeSteps > 0 ? undefined : 0;
}

async function fetchJson(url: URL, headers: Record<string, string> = {}): Promise<any> {
    const config = getRuntimeConfig();
    let response: Response;
    try {
        response = await fetch(url, {
            headers,
            signal: withTimeout(config.integrationRequestTimeoutMs)
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const cause = error instanceof Error && (error as any).cause ? `; cause=${String((error as any).cause.message ?? (error as any).cause)}` : "";
        throw new Error(`Provider request failed before response for ${url.hostname}: ${reason}${cause}`);
    }

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Provider request failed ${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
    }

    return response.json();
}

async function getJupiterRoute(input: RouteInput): Promise<LiquiditySnapshot | null> {
    const config = getRuntimeConfig();
    const url = new URL(`${config.jupiterApiBaseUrl.replace(/\/$/, "")}/quote`);
    url.searchParams.set("inputMint", input.inputMint);
    url.searchParams.set("outputMint", input.outputMint);
    url.searchParams.set("amount", input.amountIn);
    url.searchParams.set("slippageBps", String(input.maxSlippageBps ?? 50));
    url.searchParams.set("restrictIntermediateTokens", "true");
    url.searchParams.set("instructionVersion", "V2");

    const quote = await fetchJson(url, { "x-api-key": config.jupiterApiKey }) as JupiterQuoteResponse;
    if (!quote?.outAmount) return null;

    return {
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        source: "jupiter",
        poolOrRouteId: routeIdFromQuote(quote),
        quotedAmountOut: quote.outAmount,
        priceImpactPct: Number(quote.priceImpactPct ?? 0),
        feeBps: feeBpsFromQuote(quote),
        routeHops: routeHopsFromQuote(quote),
        observedAt: new Date().toISOString()
    };
}

async function getRaydiumPoolLiquidity(input: RouteInput): Promise<{ poolId?: string; availableLiquidity?: string }> {
    const config = getRuntimeConfig();
    const url = new URL(`${config.raydiumApiBaseUrl.replace(/\/$/, "")}/pools/info/mint`);
    url.searchParams.set("mint1", input.inputMint);
    url.searchParams.set("mint2", input.outputMint);
    url.searchParams.set("poolType", "all");
    url.searchParams.set("poolSortField", "liquidity");
    url.searchParams.set("sortType", "desc");
    url.searchParams.set("pageSize", "10");
    url.searchParams.set("page", "1");

    const payload = await fetchJson(url);
    const [pool] = asArray(payload);
    if (!pool) return {};

    const liquidity = pool.tvl ?? pool.liquidity ?? pool.day?.volume ?? pool.week?.volume;
    return {
        poolId: String(pool.id ?? pool.ammId ?? pool.poolId ?? pool.programId ?? "raydium-route"),
        availableLiquidity: liquidity !== undefined ? String(liquidity) : undefined
    };
}

async function getRaydiumRoute(input: RouteInput): Promise<LiquiditySnapshot | null> {
    const config = getRuntimeConfig();
    const url = new URL(`${config.raydiumSwapApiBaseUrl.replace(/\/$/, "")}/compute/swap-base-in`);
    url.searchParams.set("inputMint", input.inputMint);
    url.searchParams.set("outputMint", input.outputMint);
    url.searchParams.set("amount", input.amountIn);
    url.searchParams.set("slippageBps", String(input.maxSlippageBps ?? 50));
    url.searchParams.set("txVersion", "V0");

    const [quote, liquidity] = await Promise.all([
        fetchJson(url) as Promise<RaydiumSwapComputeResponse>,
        getRaydiumPoolLiquidity(input)
    ]);

    if (quote.success === false) {
        throw new Error(`Raydium swap compute failed: ${quote.msg ?? "unknown error"}`);
    }

    const data = quote.data;
    const outAmount = data?.outputAmount ?? data?.amountOut;
    if (!outAmount) return null;

    return {
        inputMint: data?.inputMint ?? input.inputMint,
        outputMint: data?.outputMint ?? input.outputMint,
        source: "raydium",
        poolOrRouteId: liquidity.poolId ?? quote.id ?? "raydium-swap-route",
        availableLiquidity: liquidity.availableLiquidity,
        quotedAmountOut: outAmount,
        priceImpactPct: Number(data?.priceImpactPct ?? data?.priceImpact ?? 0),
        feeBps: data?.feeBps,
        routeHops: data?.routePlan?.length ?? data?.routes?.length ?? 1,
        observedAt: new Date().toISOString()
    };
}

export async function getLiquidityRoutes(input: RouteInput): Promise<LiquiditySnapshot[]> {
    assertMint(input.inputMint, "inputMint");
    assertMint(input.outputMint, "outputMint");
    if (!/^\d+$/.test(input.amountIn)) {
        throw new Error("amountIn must be a raw integer token amount in atomic units");
    }

    const constraints = input.routeConstraints ?? { allowJupiter: true, allowRaydium: true };
    const calls: Array<Promise<LiquiditySnapshot | LiquiditySnapshot[] | null>> = [];

    if (constraints.allowJupiter !== false) {
        calls.push(getJupiterRoute(input));
    }

    if (constraints.allowRaydium !== false) {
        calls.push(getRaydiumRoute(input));
    }

    if (calls.length === 0) {
        throw new Error("At least one live liquidity provider must be enabled");
    }

    const results = await Promise.all(calls);
    const routes = results.flatMap(result => Array.isArray(result) ? result : result ? [result] : []);
    if (routes.length === 0) {
        throw new Error("Live liquidity providers returned no executable routes");
    }

    return routes
        .filter(route => !constraints.excludedPools?.includes(route.poolOrRouteId))
        .filter(route => Math.round(route.priceImpactPct * 100) <= (input.maxSlippageBps ?? 10_000))
        .sort((a, b) => Number(b.quotedAmountOut) - Number(a.quotedAmountOut));
}

export function selectBestRoute(routes: LiquiditySnapshot[]): LiquiditySnapshot | null {
    return routes[0] ?? null;
}
