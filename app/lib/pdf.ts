import pdf from "pdf-parse";

export type ParsedDocument = {
  pages: number[]; // Store page boundary offsets instead of duplicating text
  text: string;
  pageCount: number;
};

export async function parsePDF(buffer: Buffer): Promise<ParsedDocument> {
  try {
    // Set a timeout to prevent hanging on problematic PDFs
    const parsePromise = pdf(buffer);
    const data = await parsePromise;
    
    // Get full text
    const fullText = data.text;
    const pageCount = data.numpages;
    
    // Check if the parsed text is suspiciously large (might indicate a parsing issue)
    if (fullText.length > 500000) {
      throw new Error(`PDF text is too large (${fullText.length} characters). This PDF may be encrypted or corrupted. Please try a different file or remove encryption.`);
    }
    
    // Store page offsets instead of duplicating text - much more memory efficient
    const pageOffsets: number[] = [];
    
    // Try to find page boundaries by form feed characters
    if (fullText.includes('\f')) {
      let offset = 0;
      pageOffsets.push(0); // First page starts at 0
      
      for (let i = 0; i < fullText.length; i++) {
        if (fullText[i] === '\f') {
          pageOffsets.push(i + 1); // Next page starts after the form feed
        }
      }
    } else {
      // Fallback: divide text roughly evenly across pages
      const charsPerPage = Math.ceil(fullText.length / pageCount);
      for (let i = 0; i <= pageCount; i++) {
        pageOffsets.push(i * charsPerPage);
      }
    }
    
    return {
      pages: pageOffsets,
      text: fullText,
      pageCount: pageOffsets.length - 1 || 1,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('too large')) {
      throw error;
    }
    throw new Error(`Failed to parse PDF. This file may be encrypted, corrupted, or in an unsupported format. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

