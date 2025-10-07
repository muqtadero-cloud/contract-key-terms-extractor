export type Chunk = {
  text: string;
  startOffset: number;
  endOffset: number;
};

const CHUNK_SIZE = 25000; // ~6k tokens
const OVERLAP_SIZE = 1000; // ~250 tokens overlap

export function chunkText(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  
  if (text.length <= CHUNK_SIZE) {
    return [{
      text,
      startOffset: 0,
      endOffset: text.length,
    }];
  }
  
  let offset = 0;
  
  while (offset < text.length) {
    let chunkEnd = Math.min(offset + CHUNK_SIZE, text.length);
    
    // Try to break at a page boundary if possible
    if (chunkEnd < text.length) {
      const pageMarkerPos = text.lastIndexOf('--- PAGE', chunkEnd);
      if (pageMarkerPos > offset && pageMarkerPos > chunkEnd - CHUNK_SIZE * 0.3) {
        // Found a page marker in the last 30% of the chunk
        chunkEnd = pageMarkerPos;
      } else {
        // Otherwise, try to break at paragraph boundary
        const lastNewline = text.lastIndexOf('\n\n', chunkEnd);
        if (lastNewline > offset && lastNewline > chunkEnd - 500) {
          chunkEnd = lastNewline + 2;
        }
      }
    }
    
    chunks.push({
      text: text.slice(offset, chunkEnd),
      startOffset: offset,
      endOffset: chunkEnd,
    });
    
    // Move offset forward, with overlap
    offset = chunkEnd - OVERLAP_SIZE;
    if (offset >= text.length) break;
  }
  
  return chunks;
}

export function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

