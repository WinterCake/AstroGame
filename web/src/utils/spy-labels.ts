export {
  SPY_DETAIL_SECTIONS,
  SPY_ELEMENT_LABELS,
} from "@shared/spy-labels.js";

export type SpyDetailSectionDef = {
  key: string;
  title: string;
  mode: "amount" | "count";
  totalKey: "lootFormatted" | "fleetFormatted" | "defenseFormatted";
};
