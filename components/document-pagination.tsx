import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@hangnguyen1902/theme";

interface DocumentPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function DocumentPagination({ page, pageSize, total, onPageChange }: DocumentPaginationProps) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  const pages = totalPages <= 7
    ? Array.from({ length: totalPages }, (_, index) => index + 1)
    : [...new Set([1, page - 1, page, page + 1, totalPages])].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b);

  return <nav className="document-pagination" aria-label="Document pagination">
    <p role="status">Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} documents</p>
    <div className="document-pagination-controls">
      <Button type="button" size="sm" variant="outline" aria-label="Previous page" disabled={page === 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={16} aria-hidden="true" /></Button>
      {pages.map((value, index) => <span className="document-pagination-item" key={value}>
        {index > 0 && value - pages[index - 1] > 1 && <span className="document-pagination-gap" aria-hidden="true">…</span>}
        <Button type="button" size="sm" variant={value === page ? "soft" : "ghost"} aria-label={`Page ${value}`} aria-current={value === page ? "page" : undefined} onClick={() => onPageChange(value)}>{value}</Button>
      </span>)}
      <Button type="button" size="sm" variant="outline" aria-label="Next page" disabled={page === totalPages} onClick={() => onPageChange(page + 1)}><ChevronRight size={16} aria-hidden="true" /></Button>
    </div>
  </nav>;
}
