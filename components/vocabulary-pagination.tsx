import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@hangnguyen1902/theme";
import "./vocabulary-pagination.css";

interface VocabularyPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export function VocabularyPagination({ page, pageSize, total, onPageChange, onPageSizeChange }: VocabularyPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pages = totalPages <= 7
    ? Array.from({ length: totalPages }, (_, index) => index + 1)
    : [...new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages])]
      .filter((value) => value >= 1 && value <= totalPages)
      .sort((a, b) => a - b);

  return <nav className="vocabulary-pagination" aria-label="Vocabulary pagination">
    <div className="vocabulary-pagination-settings">
      <p role="status" aria-live="polite">{total === 0
        ? "No vocabulary to display."
        : `Showing ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, total)} of ${total} ${total === 1 ? "word" : "words"}. Page ${currentPage} of ${totalPages}.`}</p>
      <label>Words per page
        <select aria-label="Words per page" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {[12, 24, 48].map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
    </div>
    {totalPages > 1 && <div className="vocabulary-pagination-controls">
      <Button type="button" size="sm" variant="outline" aria-label="Previous page" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)}><ChevronLeft size={16} aria-hidden="true" /></Button>
      {pages.map((value, index) => <span className="vocabulary-pagination-item" key={value}>
        {index > 0 && value - pages[index - 1] > 1 && <span className="vocabulary-pagination-gap" aria-hidden="true">…</span>}
        <Button type="button" size="sm" variant={value === currentPage ? "soft" : "ghost"} aria-label={`Page ${value}`} aria-current={value === currentPage ? "page" : undefined} onClick={() => onPageChange(value)}>{value}</Button>
      </span>)}
      <Button type="button" size="sm" variant="outline" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => onPageChange(currentPage + 1)}><ChevronRight size={16} aria-hidden="true" /></Button>
    </div>}
    {totalPages > 7 && <label className="vocabulary-pagination-jump">Go to page
      <select aria-label="Go to vocabulary page" value={currentPage} onChange={(event) => onPageChange(Number(event.target.value))}>
        {Array.from({ length: totalPages }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
      </select>
    </label>}
  </nav>;
}
