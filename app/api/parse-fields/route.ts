import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/app/lib/openai";
import { parseDOCX } from "@/app/lib/docx";
import * as XLSX from 'xlsx';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const runtime = 'nodejs';
export const maxDuration = 60;

type KeyTermField = {
  name: string;
  description: string;
};

const PARSE_SYSTEM_PROMPT = `You are an expert at parsing structured documents. Your task is to extract key terms and their descriptions from a document.

The document may contain:
- Numbered lists with term names and descriptions
- Headers followed by descriptions
- Excel-like tables with terms and definitions

Extract each term as a JSON object with:
- name: The title/name of the key term (e.g., "Source File", "Customer Name", "Order ID")
- description: The description/instructions for what to extract (can be multiple lines)

Return ONLY a JSON array of these objects. Be thorough and capture all terms mentioned.`;

async function parseExcelFile(buffer: Buffer): Promise<KeyTermField[]> {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as string[][];
    
    const fields: KeyTermField[] = [];
    
    // Try to find columns that look like "name/title" and "description"
    const headers = data[0] as string[];
    const nameColIdx = headers.findIndex(h => 
      h && h.toLowerCase().match(/name|title|term|field/)
    );
    const descColIdx = headers.findIndex(h => 
      h && h.toLowerCase().match(/desc|description|instruction|definition/)
    );
    
    if (nameColIdx >= 0 && descColIdx >= 0) {
      // Standard table format with headers
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const name = row[nameColIdx]?.toString().trim();
        const description = row[descColIdx]?.toString().trim();
        
        if (name) {
          fields.push({
            name,
            description: description || `Extract information about ${name}`
          });
        }
      }
    } else if (data.length > 0 && data[0].length >= 2) {
      // Assume first column is name, second is description (no headers or headers not recognized)
      const startIdx = headers[0]?.toLowerCase().match(/name|title|term|field/) ? 1 : 0;
      
      for (let i = startIdx; i < data.length; i++) {
        const row = data[i];
        const name = row[0]?.toString().trim();
        const description = row[1]?.toString().trim();
        
        if (name) {
          fields.push({
            name,
            description: description || `Extract information about ${name}`
          });
        }
      }
    }
    
    return fields;
  } catch (error) {
    console.error("Error parsing Excel:", error);
    throw new Error("Failed to parse Excel file. Please ensure it has a 'name' and 'description' column.");
  }
}

async function parseWithLLM(text: string): Promise<KeyTermField[]> {
  const client = getOpenAIClient();
  
  const response = await client.chat.completions.create({
    model: "o3-mini",
    messages: [
      { role: "system", content: PARSE_SYSTEM_PROMPT },
      { 
        role: "user", 
        content: `Parse this document and extract all key terms with their descriptions:\n\n${text}` 
      }
    ],
    response_format: { type: "json_object" },
  });
  
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from OpenAI");
  }
  
  const parsed = JSON.parse(content);
  
  // Handle different response formats
  if (Array.isArray(parsed)) {
    return parsed as KeyTermField[];
  } else if (parsed.fields || parsed.terms || parsed.keyTerms) {
    return (parsed.fields || parsed.terms || parsed.keyTerms) as KeyTermField[];
  } else if (typeof parsed === 'object') {
    // Try to extract any array from the object
    const values = Object.values(parsed);
    const arrayValue = values.find(v => Array.isArray(v));
    if (arrayValue) {
      return arrayValue as KeyTermField[];
    }
  }
  
  throw new Error("Unexpected response format from LLM");
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` },
        { status: 400 }
      );
    }
    
    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
    const isDOCX = fileName.endsWith('.docx');
    const isText = fileName.endsWith('.txt');
    
    if (!isExcel && !isDOCX && !isText) {
      return NextResponse.json(
        { error: 'Only Excel (.xlsx, .xls), Word (.docx), or text (.txt) files are supported' },
        { status: 400 }
      );
    }
    
    console.log(`Parsing key terms from ${file.name}...`);
    
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    let fields: KeyTermField[] = [];
    
    if (isExcel) {
      // Parse Excel directly
      fields = await parseExcelFile(buffer);
      console.log(`Extracted ${fields.length} fields from Excel`);
    } else {
      // Parse text-based files with LLM
      let text: string;
      
      if (isDOCX) {
        const parsed = await parseDOCX(buffer);
        text = parsed.text;
      } else {
        text = buffer.toString('utf-8');
      }
      
      console.log(`Parsing text with LLM (${text.length} characters)...`);
      fields = await parseWithLLM(text.substring(0, 50000)); // Limit to 50k chars
      console.log(`Extracted ${fields.length} fields via LLM`);
    }
    
    if (fields.length === 0) {
      return NextResponse.json(
        { error: 'No key terms found in the document. Please check the format.' },
        { status: 400 }
      );
    }
    
    // Validate and clean fields
    const validFields = fields
      .filter(f => f.name && f.name.trim().length > 0)
      .map(f => ({
        name: f.name.trim(),
        description: (f.description || `Extract information about ${f.name}`).trim()
      }))
      .slice(0, 50); // Limit to 50 fields max
    
    return NextResponse.json({ 
      fields: validFields,
      count: validFields.length 
    });
    
  } catch (error) {
    console.error("Error parsing fields:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to parse key terms file' },
      { status: 500 }
    );
  }
}

