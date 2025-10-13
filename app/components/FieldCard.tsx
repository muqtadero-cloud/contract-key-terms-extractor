"use client";

import { Extraction } from "../lib/schema";
import { useState } from "react";

// Format field name for display (e.g., "sales_tax" -> "Sales Tax", "SLA Terms" -> "SLA Terms")
function formatFieldName(field: string): string {
  // If it's already nicely formatted (has capitals), use as-is
  if (field.match(/[A-Z]/)) {
    return field;
  }
  
  // Otherwise, convert snake_case or lowercase to Title Case
  return field
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export default function FieldCard({ extraction }: { extraction: Extraction }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (extraction.quote) {
      navigator.clipboard.writeText(extraction.quote);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isFound = extraction.status === "found" && extraction.quote.trim().length > 0;
  const isInferred = extraction.status === "inferred";
  const hasReasoning = extraction.reasoning && extraction.reasoning.trim().length > 0;

  return (
    <div
      className={`rounded-lg border p-4 ${
        isFound || isInferred
          ? "bg-white border-gray-200"
          : "bg-gray-50 border-gray-200"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-gray-900">
            {formatFieldName(extraction.field)}
          </h3>
          {isInferred && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              Inferred
            </span>
          )}
        </div>
        {(isFound || isInferred) && extraction.quote.trim().length > 0 && (
          <button
            onClick={handleCopy}
            className="text-xs px-2 py-1 rounded bg-blue-100 hover:bg-blue-200 text-blue-700 transition-colors"
            title="Copy quote"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        )}
      </div>

      {isFound || isInferred ? (
        <>
          {extraction.quote.trim().length > 0 && (
            <div className={`mb-3 p-3 rounded border ${
              isInferred ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'
            }`}>
              <p className="text-sm font-mono text-gray-800 whitespace-pre-wrap break-words">
                {extraction.quote}
              </p>
            </div>
          )}

          {hasReasoning && (
            <div className="mb-3 p-3 bg-blue-50 rounded border border-blue-200">
              <p className="text-xs font-medium text-blue-900 mb-1">💡 AI Reasoning:</p>
              <p className="text-sm text-blue-800 whitespace-pre-wrap">
                {extraction.reasoning}
              </p>
            </div>
          )}

          <div className="flex items-center gap-4 text-xs text-gray-600">
            {extraction.page !== null && (
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Page {extraction.page}
              </span>
            )}
            {extraction.start !== null && extraction.end !== null && (
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
                Chars {extraction.start}–{extraction.end}
              </span>
            )}
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {Math.round(extraction.confidence * 100)}% confident
            </span>
          </div>
        </>
      ) : (
        <div className="py-4">
          <div className="flex items-start gap-3 mb-3">
            <svg className="w-6 h-6 text-gray-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-700 mb-1">Not found in contract</p>
              {hasReasoning && (
                <p className="text-sm text-gray-600 whitespace-pre-wrap">
                  {extraction.reasoning}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

