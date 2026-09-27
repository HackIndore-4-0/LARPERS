import { describe, expect, it } from "vitest";
import {
  interiorLabelPoint,
  isFallbackBuildingName,
  isPointInPolygon,
  splitBuildingLabel,
} from "./mapLabels";

describe("campus building labels", () => {
  it("keeps the anchor inside a concave footprint", () => {
    const concave: Array<[number, number]> = [
      [0, 0],
      [8, 0],
      [8, 2],
      [2, 2],
      [2, 8],
      [0, 8],
      [0, 0],
    ];
    const anchor = interiorLabelPoint(concave);
    expect(isPointInPolygon(anchor, concave.slice(0, -1))).toBe(true);
  });

  it("distinguishes generated building IDs from actual OSM names", () => {
    expect(isFallbackBuildingName("Building 201234567")).toBe(true);
    expect(isFallbackBuildingName("Central Library")).toBe(false);
  });

  it("uses no more than two balanced lines", () => {
    expect(splitBuildingLabel("Central Library")).toEqual(["Central Library"]);
    expect(splitBuildingLabel("DEPT OF ELECTRICAL ENGG")).toEqual([
      "DEPT OF",
      "ELECTRICAL ENGG",
    ]);
  });
});
