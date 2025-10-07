# Contract Key Terms Extractor

A production-ready, local-first web app that extracts key terms from contracts (PDF/DOCX) using OpenAI's reasoning models. Returns **verbatim quotes** with page numbers and character offsets—no paraphrasing.

## Features

- ✅ Upload PDF or DOCX contracts (up to 20MB)
- ✅ Extract 7 key terms: Sales tax, Shipping, Cancellation policy, Renewal terms, Discounts, Ramp up, Payment
- ✅ **Exact quote extraction** with page numbers and character offsets
- ✅ Configurable OpenAI models (o4-mini, o3, gpt-4o-mini)
- ✅ Chunking for large documents with intelligent merging
- ✅ Cost estimation and token usage tracking
- ✅ Beautiful two-column UI with copy-to-clipboard
- ✅ JSON export for debugging

## Tech Stack

- **Next.js 14+** (App Router) with TypeScript
- **React + Tailwind CSS** for UI
- **OpenAI Node SDK** with Responses API + JSON Schema
- **pdf-parse** for PDF extraction
- **mammoth** for DOCX extraction
- **Node runtime** (not Edge) for PDF parsing

## Model Selection

This app defaults to **o4-mini**, OpenAI's cheapest reasoning model ([per OpenAI's pricing page](https://openai.com/api/pricing/)). The mini reasoning model offers fast, cost-effective reasoning capabilities perfect for contract extraction.

You can switch models via environment variable:
- `o4-mini` (default) - Mini reasoning model, lowest cost
- `o3` - Full reasoning model for complex contracts
- `gpt-4o-mini` - Fallback chat model

## Getting Started

### Prerequisites

- Node.js 18+ 
- OpenAI API key

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Add your OpenAI API key to .env
# OPENAI_API_KEY=sk-...
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Building for Production

```bash
npm run build
npm start
```

## Usage

1. **Upload a contract**: Drag & drop or click to select a PDF or DOCX file
2. **Select model** (optional): Choose from o4-mini, o3, or gpt-4o-mini
3. **Run extraction**: Click "Extract Key Terms"
4. **View results**: See extracted terms in the right column with:
   - Verbatim quotes from the contract
   - Page numbers and character offsets
   - Confidence scores
   - Copy-to-clipboard buttons
5. **Export JSON** (optional): Toggle JSON view and download raw results

## Configuration

### Environment Variables

- `OPENAI_API_KEY` (required): Your OpenAI API key
- `NEXT_PUBLIC_MODEL` (optional): Default model to use (`o4-mini`, `o3`, `gpt-4o-mini`)

### File Limits

- **Max file size**: 20MB
- **Supported formats**: PDF, DOCX
- **Chunking**: Large documents are automatically chunked at ~25k characters with intelligent merging

## Deployment

### Vercel

```bash
vercel deploy
```

**Important**: Set environment variables in your Vercel project settings:
- `OPENAI_API_KEY`
- `NEXT_PUBLIC_MODEL` (optional)

The app uses Node runtime (not Edge) to support PDF parsing.

### Render / Railway / etc.

1. Set `OPENAI_API_KEY` environment variable
2. Set build command: `npm run build`
3. Set start command: `npm start`
4. Ensure Node 18+ runtime

## How It Works

### Verbatim Quote Guarantee

1. **Parse**: Extract text from PDF/DOCX with page boundaries (`--- PAGE N ---`)
2. **Chunk**: Split into ~25k character chunks with 1k overlap at page boundaries
3. **Extract**: Call OpenAI with JSON schema forcing structured output
4. **Validate**: Verify returned quotes are **exact substrings** of source text
5. **Merge**: Deduplicate across chunks, preferring longest exact matches
6. **Locate**: Compute page numbers and character offsets by searching full text
7. **Fuzzy snap**: If exact match fails, use Levenshtein distance to find close matches and snap to exact substring

### Cost Estimation

The app provides rough cost estimates based on:
- Character count ÷ 4 ≈ token count
- Model-specific pricing from OpenAI
- Input + output token usage

## Project Structure

```
contract-key-terms/
  app/
    api/extract/route.ts       # API endpoint for extraction
    components/
      UploadCard.tsx           # Upload UI with model selector
      FieldCard.tsx            # Individual field result card
      Spinner.tsx              # Loading spinner
    lib/
      openai.ts                # OpenAI client initialization
      pdf.ts                   # PDF parsing with page tracking
      docx.ts                  # DOCX parsing
      chunk.ts                 # Text chunking with overlap
      schema.ts                # JSON schema for structured output
      extract.ts               # Extraction orchestration
      merge.ts                 # Result merging and validation
      cost.ts                  # Token counting and cost estimation
    layout.tsx                 # Root layout
    page.tsx                   # Main UI
  fixtures/
    sample-contract.txt        # Sample contract for testing
  public/
  styles/
    globals.css                # Global styles
```

## API Contract

### `POST /api/extract`

**Request** (multipart/form-data):
- `file`: PDF or DOCX file
- `fields` (optional): Array of field IDs to extract
- `model` (optional): Model override

**Response** (JSON):
```typescript
{
  fileName: string;
  pageCount: number | null;
  model: string;
  extractions: Array<{
    field: "sales_tax" | "shipping" | "cancellation_policy" | 
           "renewal_terms" | "discounts" | "ramp_up" | "payment";
    status: "found" | "not_found";
    quote: string;           // Exact substring from source
    page: number | null;     // 1-based page index
    start: number | null;    // Character offset in full doc
    end: number | null;      // Character offset in full doc
    confidence: number;      // 0..1 from model
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedUSD: number;
  };
  notes?: string[];
}
```

## Testing

A sample contract is provided in `fixtures/sample-contract.txt` for immediate testing.

## License

MIT

## References

- [OpenAI Pricing](https://openai.com/api/pricing/) - Model selection and pricing
- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) - Structured output with JSON schema

