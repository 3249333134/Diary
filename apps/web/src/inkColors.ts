import type { PlaceRegion } from "./graphData";

export const INK_COLOR_KEY = "diary.ink-colors.v2";
export type InkColors = { sea: string; places: Record<string, string> };
export const defaultInkColors = (): InkColors => ({ sea: "#f8f7fa", places: {} });
export function readInkColors(): InkColors {
  try {
    const saved=localStorage.getItem(INK_COLOR_KEY);
    const value = JSON.parse(saved || localStorage.getItem("diary.ink-colors.v1") || "null");
    const valid = (color: unknown): color is string => typeof color === "string" && /^#[\da-f]{6}$/i.test(color);
    return { sea: saved && valid(value?.sea) ? value.sea : defaultInkColors().sea, places: Object.fromEntries(Object.entries(value?.places || {}).filter(([, color]) => valid(color))) as Record<string, string> };
  } catch { return defaultInkColors(); }
}
export function regionInkColor(region: PlaceRegion, regions: PlaceRegion[], colors: InkColors): string {
  if (colors.places[region.id]) return colors.places[region.id];
  // A custom ancestor color remains a family base unless a child overrides it.
  const ancestor = [...(region.ancestorIds || [])].reverse().find(id => colors.places[id]);
  if (ancestor) {
    const base = colors.places[ancestor];
    const amount = [0, .12, -.12, .24, -.24][region.tone || 0];
    return "#" + [1,3,5].map(i => {
      const channel = parseInt(base.slice(i,i+2),16);
      return Math.round(channel + ((amount > 0 ? 255 : 0) - channel) * Math.abs(amount)).toString(16).padStart(2,"0");
    }).join("");
  }
  if (region.neutral) return "#8e86b5";
  const root = regions.find(item => item.id === region.ancestorIds?.[0]) || region;
  const palette = root.hue < 70 ? ["#f79435", "#fc5170", "#ffd05c", "#e97039", "#ffad6c"]
    : root.hue < 185 ? ["#15c8a3", "#34dfba", "#219ca6", "#78e3b0", "#3ebad8"]
    : root.hue < 240 ? ["#369bfa", "#6655f0", "#24c1d9", "#7087fc", "#ad5bf1"]
    : ["#a548e9", "#ee4cac", "#6d56e7", "#f575b8", "#c546d6"];
  return palette[region.tone || 0];
}
