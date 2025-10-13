export const ContractSchema = {
  name: "ContractKeyTerms",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      extractions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: {
              type: "string",
              description: "The name of the key term being extracted"
            },
            status: { type: "string", enum: ["found", "not_found", "inferred"] },
            quote: { type: "string", description: "The exact verbatim text from the document, or the inferred/calculated value" },
            reasoning: { 
              type: "string", 
              description: "Explain your thinking: Where you found it, why you marked it as inferred/N/A, context about the extraction, recommendations, or why it's not_found. Be detailed and helpful." 
            },
            page: { type: ["integer", "null"], minimum: 1 },
            start: { type: ["integer", "null"], minimum: 0 },
            end: { type: ["integer", "null"], minimum: 0 },
            confidence: { type: "number", minimum: 0, maximum: 1 }
          },
          required: ["field", "status", "quote", "reasoning", "page", "start", "end", "confidence"]
        }
      }
    },
    required: ["extractions"]
  },
  strict: true
} as const;

export type Extraction = {
  field: string;
  status: "found" | "not_found" | "inferred";
  quote: string;
  reasoning: string; // Explanation of where/how it was found, or why N/A
  page: number | null;
  start: number | null;
  end: number | null;
  confidence: number;
};

export type ApiResponse = {
  fileName: string;
  pageCount: number | null;
  model: string;
  extractions: Extraction[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedUSD: number;
  };
  notes?: string[];
};

