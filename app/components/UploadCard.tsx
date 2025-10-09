"use client";

import { useState, useRef, DragEvent } from "react";
import Spinner from "./Spinner";
import { formatCost } from "../lib/cost";

type KeyTermField = {
  name: string;
  description: string;
};

type UploadCardProps = {
  onExtract: (file: File, model: string, customFields?: KeyTermField[]) => Promise<void>;
  onBulkExtract: (files: File[], model: string, customFields?: KeyTermField[]) => Promise<void>;
  isProcessing: boolean;
  fileName?: string;
  pageCount?: number | null;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedUSD: number;
  };
  logs: string[];
};

const MODELS = [
  { value: "o3-mini", label: "o3-mini (best quality, reasoning)" },
  { value: "gpt-4o-mini", label: "gpt-4o-mini (fast, cheap)" },
];

const DEFAULT_FIELDS: KeyTermField[] = [
  { name: "Sales tax", description: "Any clauses about tax responsibilities, exemptions, or obligations" },
  { name: "Shipping", description: "Delivery terms, shipping responsibilities, freight costs" },
  { name: "Cancellation policy", description: "Termination clauses, cancellation procedures, notice periods" },
  { name: "Renewal terms", description: "Auto-renewal clauses, renewal processes, term extensions" },
  { name: "Discounts", description: "Price reductions, promotional terms, volume discounts" },
  { name: "Ramp up", description: "Implementation schedules, onboarding timelines, phase-in periods" },
  { name: "Payment", description: "Payment terms, schedules, amounts, invoicing procedures" },
];

export default function UploadCard({
  onExtract,
  onBulkExtract,
  isProcessing,
  fileName,
  pageCount,
  usage,
  logs,
}: UploadCardProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [model, setModel] = useState("o3-mini");
  const [isDragging, setIsDragging] = useState(false);
  const [customFields, setCustomFields] = useState<KeyTermField[]>(DEFAULT_FIELDS);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldDescription, setNewFieldDescription] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter(file => 
      file.type === "application/pdf" || file.name.endsWith(".pdf") ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.name.endsWith(".docx")
    );

    if (validFiles.length > 0) {
      setSelectedFiles(validFiles);
    } else {
      alert("Please upload PDF or DOCX files");
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFiles(Array.from(files));
    }
  };

  const handleExtract = async () => {
    if (selectedFiles.length === 0) {
      alert("Please select at least one file");
      return;
    }

    if (selectedFiles.length === 1) {
      await onExtract(selectedFiles[0], model, customFields);
    } else {
      await onBulkExtract(selectedFiles, model, customFields);
    }
  };

  const handleAddField = () => {
    if (newFieldName.trim()) {
      setCustomFields([...customFields, { 
        name: newFieldName.trim(), 
        description: newFieldDescription.trim() || "Extract relevant information about this term"
      }]);
      setNewFieldName("");
      setNewFieldDescription("");
    }
  };

  const handleRemoveField = (index: number) => {
    setCustomFields(customFields.filter((_, i) => i !== index));
  };

  const handleResetFields = () => {
    setCustomFields(DEFAULT_FIELDS);
  };

  const handleClear = () => {
    setSelectedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles(selectedFiles.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragging
            ? "border-blue-500 bg-blue-50"
            : selectedFiles.length > 0
            ? "border-green-500 bg-green-50"
            : "border-gray-300 bg-white hover:border-gray-400"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          id="file-upload"
        />

        {selectedFiles.length > 0 ? (
          <div className="space-y-3">
            <svg className="w-12 h-12 mx-auto text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-medium text-gray-900">
              {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected
            </p>
            <div className="max-h-32 overflow-y-auto space-y-2">
              {selectedFiles.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm bg-white px-3 py-2 rounded border border-gray-200">
                  <span className="text-gray-700 truncate">{file.name}</span>
                  <button
                    onClick={() => handleRemoveFile(idx)}
                    className="text-red-500 hover:text-red-700 ml-2"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={handleClear}
              className="text-sm text-red-600 hover:text-red-700"
            >
              Clear All
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <svg className="w-12 h-12 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-gray-700">
              <label htmlFor="file-upload" className="text-blue-600 hover:text-blue-700 cursor-pointer font-medium">
                Click to upload
              </label>
              {" "}or drag and drop
            </p>
            <p className="text-sm text-gray-500">PDF or DOCX up to 20MB each</p>
            <p className="text-xs text-gray-400">Select multiple files for bulk processing</p>
          </div>
        )}
      </div>

      {/* Model Selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Model
        </label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={isProcessing}
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* Advanced Options Toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="w-full text-left text-sm font-medium text-gray-700 hover:text-gray-900 flex items-center justify-between p-2 hover:bg-gray-50 rounded"
      >
        <span>⚙️ Customize Key Terms</span>
        <svg 
          className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Advanced Options */}
      {showAdvanced && (
        <div className="space-y-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
          {/* Custom Fields */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">
                Key Terms to Extract
              </label>
              <button
                onClick={handleResetFields}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                Reset to defaults
              </button>
            </div>
            
            {/* Current Fields */}
            <div className="space-y-3 mb-4">
              {customFields.map((field, index) => (
                <div key={index} className="bg-white p-3 rounded border border-gray-200">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-medium text-sm text-gray-900">{field.name}</span>
                    <button
                      onClick={() => handleRemoveField(index)}
                      className="text-red-500 hover:text-red-700 flex-shrink-0"
                      title="Remove field"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-xs text-gray-600 italic">{field.description}</p>
                </div>
              ))}
            </div>

            {/* Add New Field */}
            <div className="space-y-2 p-3 bg-blue-50 rounded border border-blue-200">
              <p className="text-xs font-medium text-blue-900 mb-2">Add New Key Term</p>
              <input
                type="text"
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                placeholder="Key term name (e.g., 'Updates')"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
              <textarea
                value={newFieldDescription}
                onChange={(e) => setNewFieldDescription(e.target.value)}
                placeholder="Description: What to look for (e.g., 'Software update schedules, update obligations, or version maintenance clauses')"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
              <button
                onClick={handleAddField}
                disabled={!newFieldName.trim()}
                className="w-full px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Add Key Term
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extract Button */}
      <button
        onClick={handleExtract}
        disabled={selectedFiles.length === 0 || isProcessing}
        className={`w-full py-3 px-4 rounded-md font-medium transition-colors flex items-center justify-center gap-2 ${
          selectedFiles.length === 0 || isProcessing
            ? "bg-gray-300 text-gray-500 cursor-not-allowed"
            : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
      >
        {isProcessing ? (
          <>
            <Spinner size="sm" />
            Processing...
          </>
        ) : selectedFiles.length > 1 ? (
          `Extract from ${selectedFiles.length} Files`
        ) : (
          "Extract Key Terms"
        )}
      </button>

      {/* File Info */}
      {fileName && (
        <div className="p-4 bg-gray-50 rounded-lg space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">File:</span>
            <span className="font-medium text-gray-900">{fileName}</span>
          </div>
          {pageCount !== null && pageCount !== undefined && (
            <div className="flex justify-between">
              <span className="text-gray-600">Pages:</span>
              <span className="font-medium text-gray-900">{pageCount}</span>
            </div>
          )}
          {usage && (
            <>
              <div className="flex justify-between">
                <span className="text-gray-600">Tokens:</span>
                <span className="font-medium text-gray-900">
                  {usage.totalTokens.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Estimated Cost:</span>
                <span className="font-medium text-gray-900">
                  {formatCost(usage.estimatedUSD)}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Progress Logs */}
      {logs.length > 0 && (
        <div className="p-4 bg-gray-900 rounded-lg">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Progress</h3>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {logs.map((log, idx) => (
              <div key={idx} className="text-xs text-gray-400 font-mono">
                {log}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

