import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "../utils/format";
export type SortDir = "asc" | "desc";

export function useSortState<T extends string>(defaultKey: T, defaultDir: SortDir = "asc") {
  const [sortKey, setSortKey] = useState<T>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  function toggle(key: T, defaultDir: SortDir = "asc") {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(defaultDir);
    }
  }

  return { sortKey, sortDir, toggle };
}

export function SortableTh({
  label,
  active,
  dir,
  onClick,
  children,
}: {
  label?: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <th className="col-sort">
      <button type="button" className={cn("sort-btn", active && "active")} onClick={onClick}>
        <span className="sort-label">{children ?? label}</span>
        <span className={cn("sort-arrow", !active && "sort-arrow--idle")}>
          {active ? (
            dir === "asc" ? <ChevronUp size={12} strokeWidth={2.5} /> : <ChevronDown size={12} strokeWidth={2.5} />
          ) : (
            <ArrowUpDown size={12} strokeWidth={2} />
          )}
        </span>
      </button>
    </th>
  );
}
