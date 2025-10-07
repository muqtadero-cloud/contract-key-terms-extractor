import OpenAI from "openai";

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  return new OpenAI({
    apiKey,
  });
}

export function getDefaultModel(): string {
  return process.env.NEXT_PUBLIC_MODEL || "o4-mini";
}

export const SUPPORTED_MODELS = ["o4-mini", "o3", "gpt-4o-mini"] as const;

export function validateModel(model: string): boolean {
  return SUPPORTED_MODELS.includes(model as any);
}

