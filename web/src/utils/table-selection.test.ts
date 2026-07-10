import { describe, expect, it } from "vitest";
import {
  applyTableRowSelect,
  selectAllTableRows,
  toggleAllTableRows,
  toggleTableRow,
} from "./table-selection";

type Item = { id: string };

function applySetState(
  value: Set<string> | ((prev: Set<string>) => Set<string>),
  prev: Set<string>
): Set<string> {
  return typeof value === "function" ? value(prev) : value;
}

describe("table-selection", () => {
  const items: Item[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const getKey = (item: Item) => item.id;

  it("clic simple remplace la sélection", () => {
    let selected = new Set(["b"]);
    const anchor = applyTableRowSelect("a", { ctrlKey: false, metaKey: false, shiftKey: false }, items, getKey, "b", (fn) => {
      selected = applySetState(fn, selected);
    });
    expect(anchor).toBe("a");
    expect(selected).toEqual(new Set(["a"]));
  });

  it("ctrl+clic toggle une ligne", () => {
    let selected = new Set(["a"]);
    applyTableRowSelect("b", { ctrlKey: true, metaKey: false, shiftKey: false }, items, getKey, "a", (fn) => {
      selected = applySetState(fn, selected);
    });
    expect(selected).toEqual(new Set(["a", "b"]));

    applyTableRowSelect("a", { ctrlKey: true, metaKey: false, shiftKey: false }, items, getKey, "b", (fn) => {
      selected = applySetState(fn, selected);
    });
    expect(selected).toEqual(new Set(["b"]));
  });

  it("shift+clic sélectionne une plage", () => {
    let selected = new Set<string>();
    applyTableRowSelect("c", { ctrlKey: false, metaKey: false, shiftKey: true }, items, getKey, "a", (fn) => {
      selected = applySetState(fn, selected);
    });
    expect(selected).toEqual(new Set(["a", "b", "c"]));
  });

  it("toggleTableRow ajoute ou retire", () => {
    let selected = new Set<string>();
    toggleTableRow("x", (fn) => {
      selected = applySetState(fn, selected);
    });
    expect(selected.has("x")).toBe(true);
    toggleTableRow("x", (fn) => {
      selected = applySetState(fn, selected);
    });
    expect(selected.has("x")).toBe(false);
  });

  it("toggleAllTableRows sélectionne ou désélectionne tout", () => {
    let selected = new Set<string>();
    toggleAllTableRows(items, getKey, selected, (fn) => {
      selected = applySetState(fn, selected);
    });
    expect(selected).toEqual(new Set(["a", "b", "c"]));

    toggleAllTableRows(items, getKey, selected, (fn) => {
      selected = applySetState(fn, selected);
    });
    expect(selected.size).toBe(0);
  });

  it("selectAllTableRows sélectionne toutes les lignes", () => {
    let selected = new Set<string>();
    selectAllTableRows(items, getKey, (fn) => {
      selected = applySetState(fn, selected);
    });
    expect(selected).toEqual(new Set(["a", "b", "c"]));
  });
});
