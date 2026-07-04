"use strict";

import fs from "fs";
import path from "path";

export type RuntimeConfig = {
    jupiterApiBaseUrl: string;
    jupiterApiKey: string;
    raydiumApiBaseUrl: string;
    raydiumSwapApiBaseUrl: string;
    integrationRequestTimeoutMs: number;
};

function stripQuotes(value: string): string {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

export function loadDotEnv(filePath = path.resolve(process.cwd(), ".env")): void {
    if (!fs.existsSync(filePath)) {
        return;
    }

    const content = fs.readFileSync(filePath, "utf8");
    content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            return;
        }

        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex === -1) {
            return;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = stripQuotes(trimmed.slice(separatorIndex + 1));
        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    });
}

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value || value.trim().length === 0) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value.trim();
}

export function getRuntimeConfig(): RuntimeConfig {
    return {
        jupiterApiBaseUrl: process.env.JUPITER_API_BASE_URL?.trim() || "https://api.jup.ag/swap/v1",
        jupiterApiKey: process.env.JUPITER_API_KEY?.trim() || requiredEnv("JUPITER_API_KEY"),
        raydiumApiBaseUrl: process.env.RAYDIUM_API_BASE_URL?.trim() || "https://api-v3.raydium.io",
        raydiumSwapApiBaseUrl: process.env.RAYDIUM_SWAP_API_BASE_URL?.trim() || "https://transaction-v1.raydium.io",
        integrationRequestTimeoutMs: Number(process.env.INTEGRATION_REQUEST_TIMEOUT_MS || 10000)
    };
}

export function validateRuntimeConfig(): void {
    loadDotEnv();
    const config = getRuntimeConfig();
    if (!Number.isFinite(config.integrationRequestTimeoutMs) || config.integrationRequestTimeoutMs <= 0) {
        throw new Error("INTEGRATION_REQUEST_TIMEOUT_MS must be a positive number");
    }
}
