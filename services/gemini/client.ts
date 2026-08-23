
import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL_PRO, GEMINI_MODEL_FLASH, GEMINI_MODEL_FLASH_LITE } from "../../constants";
import { GeminiSettings } from "../../types";
import { resolveGeminiApiKey } from "./config";
import { usageTracker, normalizeGeminiUsage, geminiUsageCacheKey } from "../common/usage";

/**
 * Wraps the two generate methods so every Gemini call reports its cache accounting
 * (usageMetadata.cachedContentTokenCount) without each call site having to opt in.
 * Purely observational: the request object is passed through untouched.
 */
const withUsageTracking = (client: GoogleGenAI, label: string): GoogleGenAI => {
  const models = client.models as any;
  const originalGenerate = models.generateContent.bind(models);
  const originalStream = models.generateContentStream.bind(models);

  models.generateContent = async (request: any) => {
    const response = await originalGenerate(request);
    const model = request?.model ?? '';
    usageTracker.record(label, model, normalizeGeminiUsage(response?.usageMetadata), geminiUsageCacheKey(model));
    return response;
  };

  models.generateContentStream = async (request: any) => {
    const stream = await originalStream(request);
    return (async function* () {
      let usageMetadata: any = null;
      try {
        for await (const chunk of stream) {
          // Gemini repeats usageMetadata on chunks; the last one is authoritative.
          if (chunk?.usageMetadata) usageMetadata = chunk.usageMetadata;
          yield chunk;
        }
      } finally {
        const model = request?.model ?? '';
        usageTracker.record(label, model, normalizeGeminiUsage(usageMetadata), geminiUsageCacheKey(model));
      }
    })();
  };

  return client;
};

/**
 * Initialize a fresh Gemini client instance.
 * Per guidelines, we create this right before calls to ensure the latest API key is used.
 */
export const getGeminiClient = (settings?: Partial<GeminiSettings> | null, usageLabel: string = 'gemini') => {
  const apiKey = resolveGeminiApiKey(settings);
  if (!apiKey) {
    throw new Error("Gemini API key is not set");
  }
  return withUsageTracking(new GoogleGenAI({ apiKey }), usageLabel);
};

/**
 * Strictly maps selection keys to the latest model IDs.
 * Ensures 'pro' always maps to the high-reasoning preview model.
 */
export const getModelName = (modelSelection: string): string => {
  const selection = String(modelSelection).trim().toLowerCase().replace(/^models\//, '');
  if (selection === "pro" || selection === GEMINI_MODEL_PRO) {
    return GEMINI_MODEL_PRO;
  }
  if (selection === "flash-lite" || selection === GEMINI_MODEL_FLASH_LITE) {
    return GEMINI_MODEL_FLASH_LITE;
  }
  if (selection === "flash" || selection === GEMINI_MODEL_FLASH) {
    return GEMINI_MODEL_FLASH;
  }
  if (selection.startsWith("gemini-") || selection.startsWith("gemma-")) {
    return selection;
  }
  return GEMINI_MODEL_PRO; // Default to Pro Preview
};
