import mammoth from "mammoth";

export type ParsedDocument = {
  pages: number[]; // Store page boundary offsets
  text: string;
  pageCount: number | null;
};

export async function parseDOCX(buffer: Buffer): Promise<ParsedDocument> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const fullText = result.value;
    
    // DOCX doesn't provide reliable page information, treat as single page
    // Store offsets: page 1 starts at 0, ends at text length
    const pages = [0, fullText.length];
    
    return {
      pages,
      text: fullText,
      pageCount: null, // DOCX page count is not reliable
    };
  } catch (error) {
    throw new Error(`Failed to parse DOCX: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

