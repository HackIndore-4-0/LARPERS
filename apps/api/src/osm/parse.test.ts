import { describe, expect, it } from "vitest";
import { parseOsmImportModel } from "./parse.js";

const fixture = `<?xml version="1.0"?><osm><node id="1" lat="22" lon="75"/><node id="2" lat="22" lon="75.001"/><node id="3" lat="22.001" lon="75.001"/><node id="4" lat="22.001" lon="75"/><way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/></way><way id="20"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="building" v="yes"/><tag k="name" v="Library"/></way></osm>`;

describe("OSM parser", () => {
  it("extracts stable route and building IDs in longitude/latitude order", () => {
    const model = parseOsmImportModel(fixture);
    expect(model.routes[0]?.id).toBe("osm-route-10");
    expect(model.routes[0]?.geometry.coordinates[0]).toEqual([75, 22]);
    expect(model.buildings[0]?.id).toBe("osm-building-20");
    expect(model.buildings[0]?.approach).toEqual([75, 22]);
  });

  it("keeps controlled campus paths but honors explicit pedestrian prohibition", () => {
    expect(
      parseOsmImportModel(
        fixture.replace(
          '</way><way id="20"',
          '<tag k="access" v="private"/></way><way id="20"',
        ),
      ).routes,
    ).toHaveLength(1);
    expect(
      parseOsmImportModel(
        fixture.replace(
          '</way><way id="20"',
          '<tag k="foot" v="no"/></way><way id="20"',
        ),
      ).routes,
    ).toHaveLength(0);
  });
});
