import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/app/lib/openai";
import { ApiResponse, Extraction, ContractSchema } from "@/app/lib/schema";
import { parsePDF } from "@/app/lib/pdf";
import { parseDOCX } from "@/app/lib/docx";
import { validateExtractions, generateValidationReport } from "@/app/lib/validate";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes (max for Vercel Pro)

const BASE_SYSTEM_PROMPT = `You are a contract analysis expert. Your job is to extract specific key terms from contracts and provide detailed reasoning about your findings.

EXTRACTION APPROACH:
1. **THINK FIRST**: Before extracting, analyze where information might be located
2. **EXPLAIN YOUR REASONING**: Always provide context about:
   - WHERE you found the information (which section, page, table)
   - WHY you marked it as found/inferred/not_found
   - If N/A, explain WHY it doesn't apply to this contract type
   - If inferred, explain your reasoning process
   - Provide recommendations when helpful

STATUS TYPES:
- **found**: Information is explicitly stated in the document (quote it verbatim)
- **inferred**: Information can be deduced from context (explain your logic)
- **not_found**: Thoroughly searched everywhere and truly doesn't exist (explain what you checked)

CRITICAL RULES:
1. For "found" status: Copy text EXACTLY as written - do not paraphrase
2. For "inferred" status: Explain your reasoning (e.g., "Not explicitly stated; based on the term 'Subscription Services' and one-year term, likely annual in advance")
3. For "not_found" status: Explain why (e.g., "N/A - this is not a Fund Admin agreement" or "Searched all sections, no termination clause found")
4. Include ALL relevant context in your reasoning
5. Be conversational and helpful in reasoning - imagine explaining to a colleague
6. For N/A fields, state clearly "N/A" in the quote and explain why in reasoning
7. Provide recommendations when appropriate (e.g., "Recommended entry: 'Addendum to MSA dated March 10, 2022'")

SEARCH STRATEGY:
- Read the ENTIRE document before deciding anything is "not_found"
- Check tables, headers, signature blocks, and all sections carefully
- For pricing: Look in pricing tables, fee schedules (often in structured tables)
- For dates: Check signature pages (DocuSign dates), effective date clauses, term sections
- For entity names: Check headers, signature blocks, "parties" sections
- For editions/tiers: Check product names, discount descriptions
- Look for synonyms: "Customer"→"Client", "Billing"→"Invoicing", etc.

EXAMPLES OF GOOD REASONING:
✓ "Found in signature section on page 2. DocuSign signature by Chris Robinson dated August 13, 2025 (countersign date)"
✓ "Not explicitly stated; based on 'one (1) year term: August 1, 2025 – July 31, 2026' and subscription model, likely annual in advance"
✓ "N/A - This is a Professional edition agreement. Enterprise modules only apply to Enterprise edition."
✓ "Searched pricing table, legal terms, and all sections. No termination clause found. Contract appears to expire automatically at term end per renewal terms."

BE THOROUGH AND HELPFUL: Think like ChatGPT - provide context, reasoning, and recommendations.`;

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
    
    console.log(`Auto-populated ${autoExtractions.length} fields, extracting ${fieldsNeedingExtraction.length} fields with ${model}`);
    
    // Single-pass extraction for all fields
    const termsPrompt = fieldsNeedingExtraction.map((f, idx) => 
      `${idx + 1}. **${f.name}**: ${f.description}`
    ).join('\n');
    
    const dynamicPrompt = `${BASE_SYSTEM_PROMPT}\n\nExtract these ${fieldsNeedingExtraction.length} fields:\n\n${termsPrompt}`;
    
    let response;
    let content: string | null = null;
    let modelExtractions: Extraction[] = [];
    
    try {
      response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: dynamicPrompt },
          { 
            role: "user", 
            content: `Extract the key terms from this contract document:\n\n${textToSend}` 
          }
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
              { role: "system", content: dynamicPrompt },
              { 
                role: "user", 
                content: `Extract the key terms from this contract document:\n\n${textToSend}` 
              }
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
    
    console.log("Received response from OpenAI");

    // Validate extractions against the source text
    console.log("Validating extractions against source text...");
    const validatedExtractions = validateExtractions(allExtractions, fullText);

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

