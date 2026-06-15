"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="ml-4 text-xs text-amber-600 hover:text-amber-800 font-semibold transition-colors"
    >
      Print / Save PDF
    </button>
  );
}
