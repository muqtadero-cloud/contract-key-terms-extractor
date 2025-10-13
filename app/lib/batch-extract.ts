import OpenAI from "openai";
import { Extraction } from "./schema";

type KeyTermField = { name: string; description: string };

const BASE_SYSTEM_PROMPT = `You are a contract analysis expert. Your job is to extract specific key terms from contracts and return the EXACT VERBATIM text as it appears in the document.

CRITICAL RULES:
1. Copy text EXACTLY as written - do not paraphrase, summarize, or rewrite
2. Include ALL relevant sentences and clauses for each term
3. If a term spans multiple sentences or paragraphs, include the complete section
4. If a term is not found, mark status as "not_found"
5. Be thorough - err on the side of including more context rather than less
6. Search the ENTIRE document for each field - don't give up early
7. For fields related to specific sections (like "Software Terms" or "Fund Administration"), look for those section headers`;

// Create a dynamic schema for a batch of fields
function createBatchSchema(fields: KeyTermField[]) {
  const properties: Record<string, any> = {};
  
  fields.forEach((field) => {
    const fieldKey = field.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    properties[fieldKey] = {
      type: "object",
      properties: {
        field: { 
          type: "string",
          description: `Must be exactly: "${field.name}"`
        },
        status: {
          type: "string",
          enum: ["found", "not_found"],
          description: "found if the information exists in the document, not_found if it doesn't"
        },
        quote: {
          type: "string",
          description: `The exact verbatim text from the document for "${field.name}". Empty string if not_found.`
        },
        page: {
          type: "integer",
          description: "Page number where this was found (if available), or 0 if not_found"
        },
        relevance: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "Confidence that this is the correct information"
        }
      },
      required: ["field", "status", "quote", "page", "relevance"]
    };
  });

  return {
    name: "extract_contract_fields_batch",
    strict: true,
    schema: {
      type: "object",
      properties: {
        extractions: {
          type: "object",
          properties,
          required: fields.map(f => f.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')),
          additionalProperties: false
        }
      },
      required: ["extractions"],
      additionalProperties: false
    }
  };
}

// Extract a single batch of fields
async function extractBatch(
  client: OpenAI,
  model: string,
  docText: string,
  fields: KeyTermField[],
  batchNum: number,
  totalBatches: number
): Promise<Extraction[]> {
  const termsPrompt = fields.map((f, idx) => 
    `${idx + 1}. **${f.name}**: ${f.description}`
  ).join('\n');
  
  const systemPrompt = `${BASE_SYSTEM_PROMPT}

You are processing batch ${batchNum} of ${totalBatches}.
Focus on finding these ${fields.length} specific fields:

${termsPrompt}

IMPORTANT: Search the entire document carefully for each field. If you find relevant information, extract the complete, verbatim text.`;

  const schema = createBatchSchema(fields);
  
  console.log(`  Batch ${batchNum}/${totalBatches}: Extracting ${fields.length} fields (${fields.map(f => f.name).join(', ')})`);
  
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { 
        role: "user", 
        content: `Extract the following key terms from this contract. Return the exact verbatim text for each field.

Contract text:
${docText}` 
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: schema
    },
    temperature: 0.1,
  });
  
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error(`No response from OpenAI for batch ${batchNum}`);
  }
  
  const parsed = JSON.parse(content);
  const extractions: Extraction[] = [];
  
  // Convert the batch response to our Extraction format
  fields.forEach((field) => {
    const fieldKey = field.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const result = parsed.extractions[fieldKey];
    
    if (result) {
      extractions.push({
        field: field.name, // Use original field name
        status: result.status,
        quote: result.quote || "",
        page: result.page || 0,
        relevance: result.relevance || "medium"
      });
    } else {
      // Fallback if field is missing from response
      extractions.push({
        field: field.name,
        status: "not_found",
        quote: "",
        page: 0,
        relevance: "low"
      });
    }
  });
  
  const foundCount = extractions.filter(e => e.status === "found").length;
  console.log(`  ✓ Batch ${batchNum}: Found ${foundCount}/${fields.length} fields`);
  
  return extractions;
}

// Main batched extraction function
export async function batchedExtract(
  client: OpenAI,
  model: string,
  docText: string,
  fields: KeyTermField[],
  batchSize: number = 8
): Promise<{ extractions: Extraction[], totalTokens: number, inputTokens: number, outputTokens: number }> {
  
  console.log(`Starting batched extraction: ${fields.length} fields in batches of ${batchSize}`);
  
  // Split fields into batches
  const batches: KeyTermField[][] = [];
  for (let i = 0; i < fields.length; i += batchSize) {
    batches.push(fields.slice(i, i + batchSize));
  }
  
  console.log(`Processing ${batches.length} batch(es)...`);
  
  // Process batches sequentially (to avoid rate limits)
  const allExtractions: Extraction[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const batchExtractions = await extractBatch(
        client,
        model,
        docText,
        batch,
        i + 1,
        batches.length
      );
      allExtractions.push(...batchExtractions);
      
      // Small delay between batches to avoid rate limits
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`Error in batch ${i + 1}:`, error);
      // Add not_found entries for failed batch
      batch.forEach(field => {
        allExtractions.push({
          field: field.name,
          status: "not_found",
          quote: "",
          page: 0,
          relevance: "low"
        });
      });
    }
  }
  
  console.log(`Batched extraction complete: ${allExtractions.filter(e => e.status === "found").length}/${fields.length} fields found`);
  
  return {
    extractions: allExtractions,
    totalTokens: totalInputTokens + totalOutputTokens,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens
  };
}

