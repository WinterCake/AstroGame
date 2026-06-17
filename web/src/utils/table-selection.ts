import type { Dispatch, SetStateAction } from "react";

export type TableSelectMouse = Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">;

/**
 * Sélection tableau — conventions habituelles (Explorateur, Gmail, etc.) :
 * - Clic simple : une seule ligne sélectionnée
 * - Ctrl/Cmd + clic : ajoute ou retire une ligne
 * - Shift + clic : plage depuis l'ancre jusqu'à la ligne cliquée
 * - Ctrl + Shift + clic : ajoute la plage à la sélection existante
 */
export function applyTableRowSelect<T>(
  key: string,
  event: TableSelectMouse,
  items: T[],
  getKey: (item: T) => string,
  anchorKey: string | null,
  setSelected: Dispatch<SetStateAction<Set<string>>>
): string {
  const ctrl = event.ctrlKey || event.metaKey;

  if (event.shiftKey && anchorKey) {
    const fromIdx = items.findIndex((item) => getKey(item) === anchorKey);
    const toIdx = items.findIndex((item) => getKey(item) === key);
    if (fromIdx >= 0 && toIdx >= 0) {
      const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
      setSelected((prev) => {
        const next = ctrl ? new Set(prev) : new Set<string>();
        for (let i = lo; i <= hi; i++) next.add(getKey(items[i]));
        return next;
      });
      return key;
    }
  }

  if (ctrl) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    return key;
  }

  setSelected(new Set([key]));
  return key;
}

export function toggleTableRow(
  key: string,
  setSelected: Dispatch<SetStateAction<Set<string>>>
) {
  setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

export function toggleAllTableRows<T>(
  items: T[],
  getKey: (item: T) => string,
  selected: Set<string>,
  setSelected: Dispatch<SetStateAction<Set<string>>>
) {
  const keys = items.map(getKey);
  const allSelected = keys.length > 0 && keys.every((k) => selected.has(k));
  setSelected((prev) => {
    const next = new Set(prev);
    for (const k of keys) {
      if (allSelected) next.delete(k);
      else next.add(k);
    }
    return next;
  });
}

export function selectAllTableRows<T>(
  items: T[],
  getKey: (item: T) => string,
  setSelected: Dispatch<SetStateAction<Set<string>>>
) {
  setSelected(new Set(items.map(getKey)));
}
