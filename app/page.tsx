"use client";

import { useState } from "react";
import UploadCard from "./components/UploadCard";
import FieldCard from "./components/FieldCard";
import { ApiResponse, Extraction } from "./lib/schema";
import * as XLSX from 'xlsx';

type KeyTermField = {
  name: string;
  description: string;
};

type BulkResult = {
  fileName: string;
  success: boolean;
  result?: ApiResponse;
  error?: string;
};

export default function Home() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [bulkResults, setBulkResults] = useState<BulkResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [showJSON, setShowJSON] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBulkMode, setIsBulkMode] = useState(false);

  const addLog = (message: string) => {
    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  const handleExtract = async (file: File, model: string, customFields?: KeyTermField[]) => {
    setIsProcessing(true);
    setError(null);
    setLogs([]);
    setResult(null);
    setBulkResults([]);
    setIsBulkMode(false);

    addLog("Starting extraction...");

    try {
      addLog(`Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)...`);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("model", model);
      
      if (customFields && customFields.length > 0) {
        formData.append("fields", JSON.stringify(customFields));
        addLog(`Extracting ${customFields.length} custom key terms`);
      }

      addLog(`Sending to API with model ${model}...`);

      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Extraction failed");
      }

      addLog("Processing response...");
      const data: ApiResponse = await response.json();

      addLog(`✓ Extracted ${data.extractions.filter(e => e.status === "found").length} of ${data.extractions.length} terms`);
      addLog(`✓ Used ${data.usage.totalTokens.toLocaleString()} tokens`);

      setResult(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error occurred";
      setError(message);
      addLog(`✗ Error: ${message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkExtract = async (files: File[], model: string, customFields?: KeyTermField[]) => {
    setIsProcessing(true);
    setError(null);
    setLogs([]);
    setResult(null);
    setBulkResults([]);
    setIsBulkMode(true);

    addLog(`Starting bulk extraction for ${files.length} files...`);

    const results: BulkResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      addLog(`\n[${i + 1}/${files.length}] Processing ${file.name}...`);

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("model", model);
        
        if (customFields && customFields.length > 0) {
          formData.append("fields", JSON.stringify(customFields));
        }

        const response = await fetch("/api/extract", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Extraction failed");
        }

        const data: ApiResponse = await response.json();
        
        results.push({
          fileName: file.name,
          success: true,
          result: data
        });

        addLog(`✓ ${file.name}: Extracted ${data.extractions.filter(e => e.status === "found").length} of ${data.extractions.length} terms`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error occurred";
        results.push({
          fileName: file.name,
          success: false,
          error: message
        });
        addLog(`✗ ${file.name}: ${message}`);
      }
    }

    setBulkResults(results);
    
    const successCount = results.filter(r => r.success).length;
    addLog(`\n✓ Completed: ${successCount}/${files.length} files processed successfully`);
    
    if (successCount < files.length) {
      setError(`${files.length - successCount} file(s) failed to process`);
    }

    setIsProcessing(false);
  };

  const handleClear = () => {
    setResult(null);
    setBulkResults([]);
    setLogs([]);
    setError(null);
    setShowJSON(false);
    setIsBulkMode(false);
  };

  const handleDownloadJSON = () => {
    if (!result) return;

    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.fileName.replace(/\.[^/.]+$/, "")}-extraction.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportToCSV = () => {
    if (bulkResults.length === 0) return;

    // Get all unique field names across all contracts
    const allFields = new Set<string>();
    bulkResults.forEach(result => {
      if (result.success && result.result) {
        result.result.extractions.forEach(ext => allFields.add(ext.field));
      }
    });

    const fieldNames = Array.from(allFields);

    // Build CSV
    let csv = '"Contract",' + fieldNames.map(f => `"${f}"`).join(',') + '\n';

    bulkResults.forEach(result => {
      if (result.success && result.result) {
        const row = [result.fileName];
        
        fieldNames.forEach(fieldName => {
          const extraction = result.result!.extractions.find(e => e.field === fieldName);
          const quote = extraction?.status === 'found' ? extraction.quote : '';
          // Escape quotes in CSV
          row.push(`"${quote.replace(/"/g, '""')}"`);
        });
        
        csv += row.join(',') + '\n';
      }
    });

    // Download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contract-extractions-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportToExcel = () => {
    if (bulkResults.length === 0) return;

    // Get all unique field names
    const allFields = new Set<string>();
    bulkResults.forEach(result => {
      if (result.success && result.result) {
        result.result.extractions.forEach(ext => allFields.add(ext.field));
      }
    });

    const fieldNames = Array.from(allFields);

    // Build data array
    const data = [
      ['Contract', ...fieldNames] // Header row
    ];

    bulkResults.forEach(result => {
      if (result.success && result.result) {
        const row = [result.fileName];
        
        fieldNames.forEach(fieldName => {
          const extraction = result.result!.extractions.find(e => e.field === fieldName);
          const quote = extraction?.status === 'found' ? extraction.quote : '';
          row.push(quote);
        });
        
        data.push(row);
      }
    });

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    const colWidths = [{ wch: 30 }]; // First column (contract name)
    fieldNames.forEach(() => colWidths.push({ wch: 50 })); // Field columns
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Extractions');

    // Download
    XLSX.writeFile(wb, `contract-extractions-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <main className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Contract Key Terms Extractor
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Extract verbatim quotes with page numbers and offsets
              </p>
            </div>
            {result && (
              <button
                onClick={handleClear}
                className="px-4 py-2 text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-md transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-red-500 mt-0.5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <p className="mt-1 text-sm text-red-700">{error}</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Upload */}
          <div>
            <UploadCard
              onExtract={handleExtract}
              onBulkExtract={handleBulkExtract}
              isProcessing={isProcessing}
              fileName={result?.fileName}
              pageCount={result?.pageCount}
              usage={result?.usage}
              logs={logs}
            />
          </div>

          {/* Right Column - Results */}
          <div>
            {isBulkMode && bulkResults.length > 0 ? (
              <div className="space-y-4">
                {/* Bulk Export Options */}
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Bulk Results ({bulkResults.filter(r => r.success).length}/{bulkResults.length} successful)
                  </h2>
                  <div className="flex gap-2">
                    <button
                      onClick={exportToCSV}
                      className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      CSV
                    </button>
                    <button
                      onClick={exportToExcel}
                      className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Excel
                    </button>
                  </div>
                </div>

                {/* Bulk Results List */}
                <div className="bg-white rounded-lg border border-gray-200 divide-y">
                  {bulkResults.map((result, idx) => (
                    <div key={idx} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            ) : (
                              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                            <span className="font-medium text-gray-900">{result.fileName}</span>
                          </div>
                          {result.success && result.result && (
                            <p className="text-sm text-gray-600 mt-1">
                              Extracted {result.result.extractions.filter(e => e.status === "found").length} of {result.result.extractions.length} terms
                            </p>
                          )}
                          {!result.success && result.error && (
                            <p className="text-sm text-red-600 mt-1">{result.error}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : result ? (
              <div className="space-y-4">
                {/* Toggle JSON View */}
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Extracted Terms
                  </h2>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowJSON(!showJSON)}
                      className="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-md transition-colors"
                    >
                      {showJSON ? "Show Cards" : "Show JSON"}
                    </button>
                    {showJSON && (
                      <button
                        onClick={handleDownloadJSON}
                        className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                      >
                        Download JSON
                      </button>
                    )}
                  </div>
                </div>

                {showJSON ? (
                  <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
                    <pre className="text-xs text-gray-100 font-mono">
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {result.extractions.map((extraction) => (
                      <FieldCard key={extraction.field} extraction={extraction} />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
                <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-gray-500">
                  Upload a contract to see extracted terms here
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-gray-600">
            Powered by OpenAI • All quotes are extracted verbatim • Default model: gpt-4o
          </p>
        </div>
      </footer>
    </main>
  );
}

