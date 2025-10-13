import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/app/lib/openai";
import { ApiResponse, Extraction, ContractSchema, validateExtractions, generateValidationReport } from "@/app/lib/schema";
import { parsePDF } from "@/app/lib/pdf";
import { parseDOCX } from "@/app/lib/docx";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes (max for Vercel Pro)

const BASE_SYSTEM_PROMPT = `You are extracting key terms from a contract document.

For each field:
1. Search the entire document thoroughly
2. If found: Extract the exact verbatim text
3. If you can infer it from context: Explain your reasoning
4. If not found: Explain why (e.g., "N/A - not applicable to this contract type")

In the "reasoning" field, briefly explain:
- Where you found it (section, page, table)
- Why it's inferred (if applicable)
- Why it's N/A or not found (if applicable)

Be thorough. Check all sections, tables, headers, and signature blocks.`;

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
    
    // Truncate if too long (128k context for most models, ~100k chars to be safe)
    const maxChars = 100000;
    const textToSend = fullText.length > maxChars 
      ? fullText.substring(0, maxChars) + "\n\n[Document truncated due to length]"
      : fullText;
    
    const client = getOpenAIClient();
    let model = modelParam || "gpt-5";
    let usedFallback = false;
    
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
    
    // Pre-populate fields that can be automatically determined
    const autoExtractions: Extraction[] = [];
    const fieldsNeedingExtraction: KeyTermField[] = [];
    
    fieldsToExtract.forEach(field => {
      const fieldNameLower = field.name.toLowerCase();
      
      // Auto-populate Source File from filename
      if (fieldNameLower.includes('source file') || fieldNameLower.includes('file name')) {
        autoExtractions.push({
          field: field.name,
          status: "found",
          quote: file.name,
          reasoning: "Automatically extracted from uploaded filename",
          page: null,
          start: null,
          end: null,
          confidence: 1.0
        });
      }
      // Auto-default Currency to USD if field asks for it and mentions default
      else if (fieldNameLower.includes('currency') && field.description.toLowerCase().includes('default') && field.description.toLowerCase().includes('usd')) {
        // Don't auto-populate currency, let the model find it or infer it
        fieldsNeedingExtraction.push(field);
      }
      else {
        fieldsNeedingExtraction.push(field);
      }
    });
    
    // Log what's being auto-populated
    if (autoExtractions.length > 0) {
      console.log(`Auto-populated fields: ${autoExtractions.map(e => e.field).join(', ')}`);
    }
    console.log(`Sending ${fieldsNeedingExtraction.length} fields to ${model} for extraction`);
    
    // Build field list with FULL descriptions (no truncation)
    const fieldsList = fieldsNeedingExtraction.map((f, idx) => {
      return `${idx + 1}. Field Name: "${f.name}"
   What to extract: ${f.description}`;
    }).join('\n\n');
    
    // Build the complete user message
    const userMessage = `I need you to extract these ${fieldsNeedingExtraction.length} fields from a contract document.

FIELDS TO EXTRACT:

${fieldsList}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CONTRACT DOCUMENT TEXT:

${textToSend}`;
    
    console.log(`Prompt length: ${userMessage.length} characters`);
    
    let response;
    let content: string | null = null;
    let modelExtractions: Extraction[] = [];
    
    try {
      response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: BASE_SYSTEM_PROMPT },
          { role: "user", content: userMessage }
        ],
        response_format: {
          type: "json_schema",
          json_schema: ContractSchema
        },
      });
      
      content = response.choices[0]?.message?.content;
      
      if (!content) {
        throw new Error("No response content from OpenAI");
      }
      
      // Try to parse the JSON response
      try {
        const parsed = JSON.parse(content) as { extractions: Extraction[] };
        modelExtractions = parsed.extractions;
      } catch (parseError) {
        console.error("JSON parsing error:", parseError);
        console.error("Response content:", content?.substring(0, 500));
        
        // If JSON parsing fails, create empty extractions for all fields
        console.log("Falling back to empty extractions due to JSON parse error");
        modelExtractions = fieldsNeedingExtraction.map(field => ({
          field: field.name,
          status: "not_found" as const,
          quote: "",
          reasoning: "AI extraction error - unable to parse response. Please try again.",
          page: null,
          start: null,
          end: null,
          confidence: 0
        }));
      }
    } catch (apiError: any) {
      console.error("API error:", apiError);
      
      // If GPT-5 fails, try falling back to gpt-4o
      if (model === "gpt-5" && apiError?.message?.includes("model")) {
        console.log("GPT-5 failed, falling back to gpt-4o...");
        model = "gpt-4o";
        usedFallback = true;
        
        try {
          response = await client.chat.completions.create({
            model,
            messages: [
              { role: "system", content: BASE_SYSTEM_PROMPT },
              { role: "user", content: userMessage }
            ],
            response_format: {
              type: "json_schema",
              json_schema: ContractSchema
            },
          });
          
          content = response.choices[0]?.message?.content;
          if (content) {
            const parsed = JSON.parse(content) as { extractions: Extraction[] };
            modelExtractions = parsed.extractions;
            console.log("Successfully extracted with gpt-4o fallback");
          }
        } catch (fallbackError) {
          console.error("Fallback to gpt-4o also failed:", fallbackError);
          // Create empty extractions
          modelExtractions = fieldsNeedingExtraction.map(field => ({
            field: field.name,
            status: "not_found" as const,
            quote: "",
            reasoning: "Both GPT-5 and gpt-4o fallback failed. Please try again.",
            page: null,
            start: null,
            end: null,
            confidence: 0
          }));
        }
      } else {
        // If not a model error or already using fallback, create empty extractions
        console.log("Falling back to empty extractions due to API error");
        modelExtractions = fieldsNeedingExtraction.map(field => ({
          field: field.name,
          status: "not_found" as const,
          quote: "",
          reasoning: "API error occurred during extraction. Please try again.",
          page: null,
          start: null,
          end: null,
          confidence: 0
        }));
      }
    }
    
    const inputTokens = response?.usage?.prompt_tokens || 0;
    const outputTokens = response?.usage?.completion_tokens || 0;
    
    // Combine auto-populated fields with model extractions
    const allExtractions = [...autoExtractions, ...modelExtractions];
    
    console.log(`Received ${modelExtractions.length} extractions from AI`);
    console.log(`Total extractions (including auto-populated): ${allExtractions.length}`);
    console.log(`Found: ${allExtractions.filter(e => e.status === 'found').length}, Inferred: ${allExtractions.filter(e => e.status === 'inferred').length}, Not found: ${allExtractions.filter(e => e.status === 'not_found').length}`);

    // Validate extractions against the source text
    console.log("Validating extractions against source text...");
    const validatedExtractions = validateExtractions(allExtractions, fullText);
    
    // Sort extractions to match original field order
    const fieldOrder = fieldsToExtract.map(f => f.name);
    validatedExtractions.sort((a, b) => {
      const indexA = fieldOrder.indexOf(a.field);
      const indexB = fieldOrder.indexOf(b.field);
      return indexA - indexB;
    });

    // Generate validation report
    const validationReport = generateValidationReport(allExtractions, validatedExtractions);

    if (validationReport.invalidCount > 0) {
      console.log(`Validation: ${validationReport.invalidCount} extraction(s) failed validation and were marked as not_found`);
      console.log(`Invalid fields: ${validationReport.invalidFields.join(', ')}`);
    } else {
      console.log(`Validation: All ${validationReport.validCount} extraction(s) passed validation`);
    }

    // Calculate usage and cost
    const totalTokens = inputTokens + outputTokens;

    // Pricing (adjust based on model): GPT-4o: $2.50 per 1M input, $10 per 1M output
    // Using GPT-4o pricing as baseline estimate for now
    const estimatedUSD = (inputTokens * 2.5 / 1000000) + (outputTokens * 10 / 1000000);

    const usage = {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedUSD
    };

    // Build notes
    const notes: string[] = [];
    if (fullText.length > maxChars) {
      notes.push("Document was truncated to fit context window");
    }
    if (validationReport.invalidCount > 0) {
      notes.push(`${validationReport.invalidCount} extraction(s) failed validation and were marked as not_found`);
    }
    if (modelExtractions.length > 0 && modelExtractions.every(e => e.status === "not_found")) {
      notes.push("AI extraction encountered an error - please try again or check server logs");
    }
    if (usedFallback) {
      notes.push("Used gpt-4o model (GPT-5 not yet available)");
    }

    const result: ApiResponse = {
      fileName: file.name,
      pageCount: parsedDoc.pageCount,
      model,
      extractions: validatedExtractions,
      usage,
      notes: notes.length > 0 ? notes : undefined
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

