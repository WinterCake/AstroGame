import { useMemo, useState } from "react";

type UsePaginatedQueryOptions = {
  pageSize?: number;
  sortKey: string;
  sortDir: "asc" | "desc";
  filters: Record<string, string | boolean | undefined>;
};

export function usePaginatedQuery({
  pageSize = 100,
  sortKey,
  sortDir,
  filters,
}: UsePaginatedQueryOptions) {
  const [page, setPage] = useState(1);

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    for (const [key, value] of Object.entries(filters)) {
      if (value === true) p.set(key, "true");
      else if (value === false || value === "" || value == null) continue;
      else p.set(key, String(value));
    }
    p.set("sortBy", sortKey);
    p.set("sortDir", sortDir);
    return p;
  }, [page, pageSize, filters, sortKey, sortDir]);

  return { page, setPage, params };
}
