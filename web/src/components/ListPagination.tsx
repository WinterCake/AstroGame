type ListPaginationProps = {
  page: number;
  onPageChange: (page: number) => void;
  total?: number;
  pageSize?: number;
};

export function ListPagination({ page, onPageChange, total, pageSize = 100 }: ListPaginationProps) {
  const totalPages = total ? Math.max(1, Math.ceil(total / pageSize)) : null;

  return (
    <div className="pagination">
      <button type="button" className="btn" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Précédent
      </button>
      <span>
        Page {page}
        {totalPages != null ? ` / ${totalPages}` : ""}
        {total != null ? ` (${total} entrées)` : ""}
      </span>
      <button
        type="button"
        className="btn"
        data-testid="list-pagination-next"
        disabled={totalPages != null ? page >= totalPages : total == null}
        onClick={() => onPageChange(page + 1)}
      >
        Suivant
      </button>
    </div>
  );
}
