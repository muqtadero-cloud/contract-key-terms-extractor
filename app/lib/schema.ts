// ============================================================================
// TYPES & SCHEMA
// ============================================================================

export type Extraction = {
  field: string;
  status: "found" | "not_found" | "inferred";
  quote: string;
  reasoning: string;
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

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates that an extracted quote actually exists in the source text
 * and returns a validated/corrected version of the extraction
 */
export function validateExtraction(
  extraction: Extraction,
  fullText: string
): Extraction {
  // If not found, no validation needed
  if (extraction.status === "not_found" || !extraction.quote || extraction.quote.trim() === "") {
    return extraction;
  }

  const quote = extraction.quote;

  // Try exact match first
  const exactIndex = fullText.indexOf(quote);
  if (exactIndex !== -1) {
    // Quote exists exactly - update offsets if they're null
    return {
      ...extraction,
      start: extraction.start ?? exactIndex,
      end: extraction.end ?? (exactIndex + quote.length)
    };
  }

  // Try normalized match (handle whitespace differences)
  const normalizedQuote = normalizeWhitespace(quote);
  const normalizedText = normalizeWhitespace(fullText);
  const normalizedIndex = normalizedText.indexOf(normalizedQuote);

  if (normalizedIndex !== -1) {
    // Found with normalized whitespace - find the original text span
    const originalSpan = findOriginalSpan(fullText, normalizedIndex, quote.length);
    if (originalSpan) {
      return {
        ...extraction,
        quote: originalSpan.text,
        start: originalSpan.start,
        end: originalSpan.end,
        confidence: Math.max(0, extraction.confidence - 0.1) // Reduce confidence slightly
      };
    }
  }

  // Try fuzzy match for small quotes (might be truncated)
  if (quote.length < 200) {
    const fuzzyResult = fuzzyFindQuote(quote, fullText);
    if (fuzzyResult) {
      return {
        ...extraction,
        quote: fuzzyResult.text,
        start: fuzzyResult.start,
        end: fuzzyResult.end,
        confidence: Math.max(0, extraction.confidence - 0.2) // Reduce confidence more
      };
    }
  }

  // Quote not found in document - mark as invalid
  console.warn(`Quote validation failed for field "${extraction.field}": "${quote.substring(0, 100)}..."`);

  return {
    ...extraction,
    status: "not_found",
    quote: "",
    reasoning: extraction.reasoning || "Quote could not be verified in the source document",
    start: null,
    end: null,
    confidence: 0
  };
}

/**
 * Validates all extractions in a result set
 */
export function validateExtractions(
  extractions: Extraction[],
  fullText: string
): Extraction[] {
  return extractions.map(extraction => validateExtraction(extraction, fullText));
}

/**
 * Generate a validation report showing which extractions passed/failed validation
 */
export function generateValidationReport(
  originalExtractions: Extraction[],
  validatedExtractions: Extraction[]
): {
  totalExtractions: number;
  validCount: number;
  invalidCount: number;
  invalidFields: string[];
} {
  let invalidCount = 0;
  const invalidFields: string[] = [];

  for (let i = 0; i < originalExtractions.length; i++) {
    const original = originalExtractions[i];
    const validated = validatedExtractions[i];

    // Check if validation changed status from found to not_found
    if (original.status === "found" && validated.status === "not_found") {
      invalidCount++;
      invalidFields.push(original.field);
    }
  }

  return {
    totalExtractions: originalExtractions.length,
    validCount: originalExtractions.length - invalidCount,
    invalidCount,
    invalidFields
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Normalize whitespace for comparison (collapse multiple spaces, normalize newlines)
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
}

/**
 * Find the original text span in the source document given a normalized position
 */
function findOriginalSpan(
  fullText: string,
  normalizedIndex: number,
  approximateLength: number
): { text: string; start: number; end: number } | null {
  // Count non-whitespace characters to map back to original position
  let charCount = 0;
  let originalStart = -1;

  for (let i = 0; i < fullText.length; i++) {
    if (fullText[i].trim() !== '') {
      if (charCount === normalizedIndex) {
        originalStart = i;
        break;
      }
      charCount++;
    }
  }

  if (originalStart === -1) return null;

  // Find approximate end
  let originalEnd = Math.min(originalStart + approximateLength * 2, fullText.length);

  return {
    text: fullText.substring(originalStart, originalEnd),
    start: originalStart,
    end: originalEnd
  };
}

/**
 * Fuzzy find a quote in text - looks for the first 50 chars and last 50 chars
 */
function fuzzyFindQuote(
  quote: string,
  fullText: string
): { text: string; start: number; end: number } | null {
  const minLength = Math.min(50, Math.floor(quote.length * 0.3));

  if (quote.length < minLength * 2) {
    return null; // Quote too short for fuzzy matching
  }

  const quoteStart = quote.substring(0, minLength);
  const quoteEnd = quote.substring(quote.length - minLength);

  // Try to find the start phrase
  const startIndex = fullText.indexOf(quoteStart);
  if (startIndex === -1) return null;

  // Look for the end phrase within a reasonable distance
  const searchEnd = Math.min(startIndex + quote.length * 2, fullText.length);
  const endIndex = fullText.indexOf(quoteEnd, startIndex + minLength);

  if (endIndex === -1 || endIndex > searchEnd) return null;

  // Extract the actual text span
  const actualEnd = endIndex + minLength;
  const actualText = fullText.substring(startIndex, actualEnd);

  return {
    text: actualText,
    start: startIndex,
    end: actualEnd
  };
}
