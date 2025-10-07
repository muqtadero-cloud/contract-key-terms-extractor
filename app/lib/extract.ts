import OpenAI from "openai";
import { ContractSchema, Extraction } from "./schema";
import { chunkText, estimateTokens } from "./chunk";

const SYSTEM_PROMPT = `You are a contracts extraction agent. Your only job is to find and return EXACT QUOTES for specific legal terms from the provided contract text. 
Rules:
- Return ONLY text that appears verbatim in the contract (matching punctuation, capitalization, and spacing).
- Do NOT summarize, paraphrase, or "clean up" language.
- If a term is not present in the provided text, return status "not_found" with an empty quote.
- Prefer the most specific clause that fully answers the field.
- If multiple candidates exist, choose the one with the clearest obligations and least ambiguity.
- Provide a 0..1 confidence score based on how directly the clause answers the field.
- Never invent page numbers; if page markers are not present in the input, set page to null.`;

function buildUserPrompt(chunkText: string, fields?: string[]): string {
  const fieldList = fields || [
    "Sales tax",
    "Shipping",
    "Cancellation policy",
    "Renewal terms",
    "Discounts",
    "Ramp up",
    "Payment"
  ];
  
  return `Extract the following fields from the CONTRACT EXCERPT. 
Return JSON matching the provided schema for only these fields: 
${fieldList.map(f => `- ${f}`).join('\n')}

CONTRACT EXCERPT (may be partial):
<<<BEGIN_CONTRACT_TEXT>>>
${chunkText}
<<<END_CONTRACT_TEXT>>>

Notes:
- Return EXACT verbatim quotes from the contract text.
- Set page to null if you cannot determine the page number.
- Output must be strict JSON matching the schema; do not include any commentary.`;
}

export async function extractFromChunk({
  client,
  model,
  chunkText,
  fields,
}: {
  client: OpenAI;
  model: string;
  chunkText: string;
  fields?: string[];
}): Promise<{ extractions: Extraction[]; inputTokens: number; outputTokens: number }> {
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(chunkText, fields) }
      ],
      response_format: {
        type: "json_schema",
        json_schema: ContractSchema
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response content from OpenAI");
    }

    const parsed = JSON.parse(content) as { extractions: Extraction[] };
    
    return {
      extractions: parsed.extractions || [],
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
    };
  } catch (error) {
    console.error("Error in extractFromChunk:", error);
    throw new Error(`OpenAI extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function extractFromDocument({
  client,
  model,
  documentText,
  fields,
}: {
  client: OpenAI;
  model: string;
  documentText: string;
  fields?: string[];
}): Promise<{ extractions: Extraction[][]; totalInputTokens: number; totalOutputTokens: number }> {
  const chunks = chunkText(documentText);
  
  console.log(`Processing ${chunks.length} chunks...`);
  
  const results: Extraction[][] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  
  for (let i = 0; i < chunks.length; i++) {
    console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
    
    const result = await extractFromChunk({
      client,
      model,
      chunkText: chunks[i].text,
      fields,
    });
    
    results.push(result.extractions);
    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;
  }
  
  return {
    extractions: results,
    totalInputTokens,
    totalOutputTokens,
  };
}

