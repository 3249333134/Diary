import type { EntityRecord } from "@diary/contracts";
import { deriveGraphData } from "./graphData";
import type { GraphModel } from "./graphModel";
import type { InkPoint, InkRegion } from "./memberInk";

export function memberInkScene(entities: EntityRecord[], model: GraphModel): InkRegion[] {
  const data = deriveGraphData(entities);
  const positions = new Map(model.nodes.map(node => [node.id, node]));
  const regions = new Map(model.regions.map(region => [region.id, region]));
  return model.regions.map(region => {
    const points: InkPoint[] = [];
    const anchor = positions.get(region.id);
    points.push({ id: region.id, x: anchor?.x ?? region.x, y: anchor?.y ?? region.y, weight: Math.max(1, region.count) });
    for (const entity of data.entities) {
      if (entity.type === "place") continue;
      const membership = data.memberships.get(entity.key);
      const weight = membership?.get(region.id);
      if (!weight) continue;
      const node = positions.get(entity.key);
      const x = node?.x ?? region.x, y = node?.y ?? region.y;
      const shared = [...membership!.keys()].filter(id => regions.has(id));
      let shareX = 0, shareY = 0;
      if (shared.length > 1) {
        const dx = region.x - x, dy = region.y - y, distance = Math.hypot(dx, dy);
        const angle = shared.indexOf(region.id) / shared.length * Math.PI * 2;
        shareX = (distance > 1 ? dx / distance : Math.cos(angle)) * 14;
        shareY = (distance > 1 ? dy / distance : Math.sin(angle)) * 14;
      }
      points.push({ id: entity.key, x, y, weight, shareX, shareY });
    }
    // Existing painted paths are normalized around each region's center/radius.
    // Their control polygon supplies the filled initial territory to the worker.
    const coordinates = (region.path.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const footprint = [];
    for (let i = 0; i + 1 < coordinates.length; i += 2) footprint.push({ x: region.x + coordinates[i] * region.radius, y: region.y + coordinates[i + 1] * region.radius });
    return { id: region.id, parentId: region.parentId, count: region.count, points, footprint };
  });
}
