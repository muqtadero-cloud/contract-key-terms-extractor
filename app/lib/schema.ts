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
            status: { type: "string", enum: ["found", "not_found"] },
            quote: { type: "string" },
            page: { type: ["integer", "null"], minimum: 1 },
            start: { type: ["integer", "null"], minimum: 0 },
            end: { type: ["integer", "null"], minimum: 0 },
            confidence: { type: "number", minimum: 0, maximum: 1 }
          },
          required: ["field", "status", "quote", "page", "start", "end", "confidence"]
        }
      }
    },
    required: ["extractions"]
  },
  strict: true
} as const;

export type Extraction = {
  field: string; // Now accepts any field name
  status: "found" | "not_found";
  quote: string;
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

