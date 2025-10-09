import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/app/lib/openai";
import { ApiResponse, Extraction, ContractSchema } from "@/app/lib/schema";
import { parsePDF } from "@/app/lib/pdf";
import { parseDOCX } from "@/app/lib/docx";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export const runtime = 'nodejs';
export const maxDuration = 60;

const BASE_SYSTEM_PROMPT = `You are a contract analysis expert. Your job is to extract specific key terms from contracts and return the EXACT VERBATIM text as it appears in the document.

CRITICAL RULES:
1. Copy text EXACTLY as written - do not paraphrase, summarize, or rewrite
2. Include ALL relevant sentences and clauses for each term
3. If a term spans multiple sentences or paragraphs, include the complete section
4. If a term is not found, mark status as "not_found"
5. Be thorough - err on the side of including more context rather than less`;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const modelParam = formData.get('model') as string | null;
    const fieldsParam = formData.get('fields') as string | null;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` },
        { status: 400 }
      );
    }
    
    const isPDF = file.name.toLowerCase().endsWith('.pdf');
    const isDOCX = file.name.toLowerCase().endsWith('.docx');
    
    if (!isPDF && !isDOCX) {
      return NextResponse.json(
        { error: 'Only PDF and DOCX files are supported' },
        { status: 400 }
      );
    }
    
    // Parse custom fields with descriptions
    type KeyTermField = { name: string; description: string };
    let customFields: KeyTermField[] | null = null;
    if (fieldsParam) {
      try {
        customFields = JSON.parse(fieldsParam);
      } catch (e) {
        console.error("Failed to parse custom fields:", e);
      }
    }
    
    console.log(`Processing ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    if (customFields) {
      console.log(`Custom fields: ${customFields.map(f => f.name).join(', ')}`);
    }
    
    // Extract text from document
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    const parsedDoc = isPDF ? await parsePDF(buffer) : await parseDOCX(buffer);
    const fullText = parsedDoc.text;
    
    console.log(`Extracted ${fullText.length} characters from ${parsedDoc.pageCount || 'unknown'} pages`);
    
    // Truncate if too long (GPT-4o has 128k context, ~100k chars to be safe)
    const maxChars = 100000;
    const textToSend = fullText.length > maxChars 
      ? fullText.substring(0, maxChars) + "\n\n[Document truncated due to length]"
      : fullText;
    
    const client = getOpenAIClient();
    const model = modelParam || "o3-mini";
    
    // Build dynamic prompt with field descriptions
    const fieldsToExtract = customFields || [
      { name: "Sales tax", description: "Any clauses about tax responsibilities, exemptions, or obligations" },
      { name: "Shipping", description: "Delivery terms, shipping responsibilities, freight costs" },
      { name: "Cancellation policy", description: "Termination clauses, cancellation procedures, notice periods" },
      { name: "Renewal terms", description: "Auto-renewal clauses, renewal processes, term extensions" },
      { name: "Discounts", description: "Price reductions, promotional terms, volume discounts" },
      { name: "Ramp up", description: "Implementation schedules, onboarding timelines, phase-in periods" },
      { name: "Payment", description: "Payment terms, schedules, amounts, invoicing procedures" }
    ];
    
    const termsPrompt = fieldsToExtract.map(f => `- ${f.name}: ${f.description}`).join('\n');
    const dynamicPrompt = `${BASE_SYSTEM_PROMPT}\n\nTerms to extract:\n${termsPrompt}`;
    
    console.log(`Sending to ${model}...`);
    
    // Call OpenAI with structured output
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: dynamicPrompt },
        { 
          role: "user", 
          content: `Extract the key terms from this contract:\n\n${textToSend}` 
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: ContractSchema
      },
      temperature: 0,
    });
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }
    
    console.log("Received response from OpenAI");
    
    const parsed = JSON.parse(content) as { extractions: Extraction[] };
    
    // Calculate usage and cost
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const totalTokens = response.usage?.total_tokens || 0;
    
    // GPT-4o pricing: $2.50 per 1M input tokens, $10 per 1M output tokens
    const estimatedUSD = (inputTokens * 2.5 / 1000000) + (outputTokens * 10 / 1000000);
    
    const usage = {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedUSD
    };
    
    const result: ApiResponse = {
      fileName: file.name,
      pageCount: parsedDoc.pageCount,
      model,
      extractions: parsed.extractions,
      usage,
      notes: fullText.length > maxChars ? ["Document was truncated to fit context window"] : []
    };
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    );
  }
}

