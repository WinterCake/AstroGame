export type AttacksRouteState = {
  coords: string[];
  minLoot?: string;
};

export function isAttacksRouteState(value: unknown): value is AttacksRouteState {
  if (!value || typeof value !== "object") return false;
  const coords = (value as AttacksRouteState).coords;
  return Array.isArray(coords) && coords.length > 0 && coords.every((c) => typeof c === "string");
}
