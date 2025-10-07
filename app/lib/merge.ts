import { Extraction } from "./schema";

export function mergeExtractions(
  allExtractions: Extraction[][],
  fullText: string,
  pages: number[] // Now offsets instead of text
): Extraction[] {
  // Group by field
  const byField = new Map<string, Extraction[]>();
  
  for (const extractionSet of allExtractions) {
    for (const extraction of extractionSet) {
      const existing = byField.get(extraction.field) || [];
      existing.push(extraction);
      byField.set(extraction.field, existing);
    }
  }
  
  const result: Extraction[] = [];
  
  // Get all unique field names from the extractions
  const allFields = Array.from(byField.keys());
  
  for (const field of allFields) {
    const candidates = byField.get(field) || [];
    
    // Filter to only "found" candidates and sort by quote length (prefer longer, more detailed quotes)
    const foundCandidates = candidates
      .filter(c => c.status === "found" && c.quote.trim().length > 0)
      .sort((a, b) => b.quote.length - a.quote.length);
    
    if (foundCandidates.length === 0) {
      // No matches found
      result.push({
        field,
        status: "not_found",
        quote: "",
        page: null,
        start: null,
        end: null,
        confidence: 0,
      });
      continue;
    }
    
    // Take the longest quote
    const best = foundCandidates[0];
    
    // Verify it's an exact substring and locate it
    const located = locateQuote(best.quote, fullText, pages);
    
    if (!located) {
      // Could not find exact match, mark as not found
      result.push({
        field,
        status: "not_found",
        quote: "",
        page: null,
        start: null,
        end: null,
        confidence: 0,
      });
    } else {
      result.push({
        field,
        status: "found",
        quote: located.exactQuote,
        page: located.page,
        start: located.start,
        end: located.end,
        confidence: best.confidence,
      });
    }
  }
  
  return result;
}

function locateQuote(
  quote: string,
  fullText: string,
  pages: number[] // Now offsets instead of text
): { exactQuote: string; page: number; start: number; end: number } | null {
  // Try exact match first
  let start = fullText.indexOf(quote);
  
  if (start !== -1) {
    // Found exact match
    const end = start + quote.length;
    const page = findPageNumber(start, pages, fullText);
    
    return {
      exactQuote: quote,
      page,
      start,
      end,
    };
  }
  
  // Fuzzy matching disabled to prevent memory issues with large documents
  // If exact match fails, we skip the quote to avoid crashes
  // Most AI-extracted quotes should match exactly anyway
  console.log(`Could not find exact match for quote: "${quote.substring(0, 50)}..."`);
  return null;
}

function findPageNumber(offset: number, pages: number[], fullText: string): number {
  // Find which page this offset belongs to using page boundary offsets
  // pages array contains: [0, offset1, offset2, ..., textLength]
  
  for (let i = 0; i < pages.length - 1; i++) {
    if (offset >= pages[i] && offset < pages[i + 1]) {
      return i + 1; // 1-based page numbers
    }
  }
  
  // If not found, return last page
  return Math.max(1, pages.length - 1);
}

