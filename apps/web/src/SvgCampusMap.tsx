import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import type { LonLat, MapPayload } from "@campus-access/shared";
import { clientPointToSvg, createSvgProjection } from "./projection";
import {
  buildingLabelPriority,
  interiorLabelPoint,
  isFallbackBuildingName,
  splitBuildingLabel,
} from "./mapLabels";

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Props {
  data: MapPayload;
  selectedId?: string | null;
  highlightedId?: string | null;
  routeCoordinates?: LonLat[] | undefined;
  gps?: LonLat | null;
  picked?: LonLat | null;
  startMarker?: LonLat | null;
  destinationMarker?: LonLat | null;
  draftMarker?: LonLat | null;
  draftMarkerKind?: "start" | "destination" | undefined;
  onRoute?: ((id: string) => void) | undefined;
  onBuilding?: ((id: string) => void) | undefined;
  onPoint?: ((id: string) => void) | undefined;
  onMap?: ((coordinate: LonLat) => void) | undefined;
}

const defaultView: ViewBox = { x: 0, y: 0, width: 1000, height: 720 };
const path = (
  coordinates: LonLat[],
  project: (point: LonLat) => [number, number],
  close = false,
): string =>
  coordinates
    .map((point, index) => `${index ? "L" : "M"}${project(point).join(" ")}`)
    .join(" ") + (close ? " Z" : "");

export const SvgCampusMap = memo(function SvgCampusMap({
  data,
  selectedId,
  highlightedId,
  routeCoordinates,
  gps,
  picked,
  startMarker,
  destinationMarker,
  draftMarker,
  draftMarkerKind,
  onRoute,
  onBuilding,
  onPoint,
  onMap,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const captures = useRef(new Map<number, Element>());
  const gesture = useRef<{
    view: ViewBox;
    distance: number;
    anchor: [number, number];
    inverse: DOMMatrix;
  } | null>(null);
  const drag = useRef<{
    view: ViewBox;
    start: { x: number; y: number };
    inverse: DOMMatrix;
  } | null>(null);
  const moved = useRef(false);
  const pendingMapClick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [view, setView] = useState(defaultView);
  const viewRef = useRef(defaultView);
  const [isDragging, setIsDragging] = useState(false);
  const [mapSize, setMapSize] = useState({ width: 1000, height: 720 });
  const allCoordinates = useMemo(
    () => [
      ...data.routes.flatMap((item) => item.geometry.coordinates as LonLat[]),
      ...data.buildings.flatMap(
        (item) => item.footprint.coordinates.flat() as LonLat[],
      ),
      ...data.points.map((item) => item.coordinates),
    ],
    [data],
  );
  const projection = useMemo(
    () => createSvgProjection(allCoordinates),
    [allCoordinates],
  );
  const staticShapes = useMemo(
    () => ({
      routes: data.routes.map((item) => ({
        ...item,
        d: path(item.geometry.coordinates as LonLat[], projection.project),
      })),
      buildings: data.buildings.map((item) => {
        const ring = item.footprint.coordinates[0] as LonLat[];
        const projected = ring.map(projection.project);
        const shapeWidth = Math.max(
          8,
          Math.max(...projected.map((point) => point[0])) -
            Math.min(...projected.map((point) => point[0])),
        );
        const shapeHeight = Math.max(
          8,
          Math.max(...projected.map((point) => point[1])) -
            Math.min(...projected.map((point) => point[1])),
        );
        const area = shapeWidth * shapeHeight;
        return {
          ...item,
          d: path(ring, projection.project, true),
          label: interiorLabelPoint(projected),
          shapeWidth,
          shapeHeight,
          area,
          labelLines: splitBuildingLabel(item.name),
        };
      }),
    }),
    [data.buildings, data.routes, projection],
  );

  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setMapSize({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (pendingMapClick.current) clearTimeout(pendingMapClick.current);
    },
    [],
  );

  const clamp = (candidate: ViewBox): ViewBox => {
    const width = Math.max(150, Math.min(1400, candidate.width));
    const height = width * 0.72;
    return {
      width,
      height,
      x: Math.max(-200, Math.min(1200 - width, candidate.x)),
      y: Math.max(-144, Math.min(864 - height, candidate.y)),
    };
  };
  const commitView = (candidate: ViewBox): void => {
    const next = clamp(candidate);
    viewRef.current = next;
    setView(next);
  };
  const screenInverse = (): DOMMatrix | null => {
    const matrix = worldRef.current?.getScreenCTM();
    if (!matrix) return null;
    try {
      return matrix.inverse();
    } catch {
      return null;
    }
  };
  const transformClient = (
    inverse: DOMMatrix,
    clientX: number,
    clientY: number,
  ): [number, number] => {
    const point = new DOMPoint(clientX, clientY).matrixTransform(inverse);
    return [point.x, point.y];
  };
  const zoomAt = (clientX: number, clientY: number, factor: number): void => {
    const world = worldRef.current;
    const anchor = world && clientPointToSvg(world, clientX, clientY);
    if (!anchor) return;
    const current = viewRef.current;
    commitView({
      x: anchor[0] - (anchor[0] - current.x) * factor,
      y: anchor[1] - (anchor[1] - current.y) * factor,
      width: current.width * factor,
      height: current.height * factor,
    });
  };
  const wheel = (event: WheelEvent<SVGSVGElement>): void => {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY > 0 ? 1.13 : 0.885);
  };
  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (pendingMapClick.current) {
      clearTimeout(pendingMapClick.current);
      pendingMapClick.current = null;
    }
    // Capture on the original hit element so a stationary gesture retains its
    // semantic click target (building/route/point), while moves still bubble
    // to this shared SVG gesture handler.
    const captureTarget = event.target as Element;
    captureTarget.setPointerCapture(event.pointerId);
    captures.current.set(event.pointerId, captureTarget);
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointers.current.size === 1) {
      moved.current = false;
      setIsDragging(false);
      const inverse = screenInverse();
      drag.current = inverse
        ? {
            view: viewRef.current,
            start: { x: event.clientX, y: event.clientY },
            inverse,
          }
        : null;
    }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      const inverse = screenInverse();
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (inverse)
        gesture.current = {
          view: viewRef.current,
          distance: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
          anchor: transformClient(inverse, center.x, center.y),
          inverse,
        };
      drag.current = null;
      moved.current = true;
      setIsDragging(true);
    }
  };
  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointers.current.size === 1 && drag.current) {
      const session = drag.current;
      if (
        Math.hypot(
          event.clientX - session.start.x,
          event.clientY - session.start.y,
        ) <= 5 &&
        !moved.current
      )
        return;
      moved.current = true;
      setIsDragging(true);
      const start = transformClient(
        session.inverse,
        session.start.x,
        session.start.y,
      );
      const current = transformClient(
        session.inverse,
        event.clientX,
        event.clientY,
      );
      commitView({
        ...session.view,
        x: session.view.x - (current[0] - start[0]),
        y: session.view.y - (current[1] - start[1]),
      });
    } else if (pointers.current.size === 2 && gesture.current) {
      moved.current = true;
      const [a, b] = [...pointers.current.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      const currentDistance = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      const factor = gesture.current.distance / currentDistance;
      const original = gesture.current.view;
      const midpoint = transformClient(
        gesture.current.inverse,
        (a.x + b.x) / 2,
        (a.y + b.y) / 2,
      );
      commitView({
        x: gesture.current.anchor[0] - (midpoint[0] - original.x) * factor,
        y: gesture.current.anchor[1] - (midpoint[1] - original.y) * factor,
        width: original.width * factor,
        height: original.height * factor,
      });
    }
  };
  const pointerUp = (event: ReactPointerEvent<SVGSVGElement>): void => {
    pointers.current.delete(event.pointerId);
    const captureTarget = captures.current.get(event.pointerId);
    captures.current.delete(event.pointerId);
    if (captureTarget?.hasPointerCapture(event.pointerId))
      captureTarget.releasePointerCapture(event.pointerId);
    if (pointers.current.size < 2) {
      gesture.current = null;
      drag.current = null;
    }
    if (pointers.current.size === 0) setIsDragging(false);
  };
  const choose = (
    callback: (() => void) | undefined,
    event: ReactMouseEvent,
  ): void => {
    if (callback) {
      event.stopPropagation();
      if (!moved.current) callback();
    }
  };
  const mapClick = (event: ReactMouseEvent<SVGSVGElement>): void => {
    if (moved.current || !onMap) return;
    if (event.detail > 1) {
      if (pendingMapClick.current) clearTimeout(pendingMapClick.current);
      pendingMapClick.current = null;
      return;
    }
    const world = worldRef.current;
    const point =
      world && clientPointToSvg(world, event.clientX, event.clientY);
    if (!point) return;
    pendingMapClick.current = setTimeout(() => {
      onMap(projection.unproject(point));
      pendingMapClick.current = null;
    }, 220);
  };
  const marker = (point: LonLat | null | undefined) =>
    point ? projection.project(point) : null;
  const keyboardChoose = (
    callback: (() => void) | undefined,
    event: ReactKeyboardEvent<SVGGElement>,
  ): void => {
    if (callback && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      callback();
    }
  };
  const zoomFromCenter = (factor: number): void => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };
  const routePath = routeCoordinates?.length
    ? path(routeCoordinates, projection.project)
    : null;
  const gpsPoint = marker(gps);
  const pickedPoint = marker(picked);
  const confirmedStartPoint = marker(startMarker);
  const confirmedDestinationPoint = marker(destinationMarker);
  const draftPoint = marker(draftMarker);
  const routeStart = routeCoordinates?.[0]
    ? projection.project(routeCoordinates[0])
    : null;
  const routeEnd = routeCoordinates?.at(-1)
    ? projection.project(routeCoordinates.at(-1)!)
    : null;
  const visibleLabels = useMemo(() => {
    const scale = Math.min(
      mapSize.width / view.width,
      mapSize.height / view.height,
    );
    const fontPx = mapSize.width < 620 ? 12 : 13;
    const boxes: Array<{
      left: number;
      top: number;
      right: number;
      bottom: number;
    }> = [];
    return staticShapes.buildings
      .filter((item) => !isFallbackBuildingName(item.name))
      .sort(
        (a, b) =>
          buildingLabelPriority(b.name, b.area) -
          buildingLabelPriority(a.name, a.area),
      )
      .flatMap((item) => {
        const lines = item.labelLines;
        const longest = Math.max(...lines.map((line) => line.length));
        const widthPx = longest * fontPx * 0.58 + 12;
        const heightPx = lines.length * (fontPx + 2) + 8;
        const footprintWidthPx = item.shapeWidth * scale;
        const footprintHeightPx = item.shapeHeight * scale;
        const important = buildingLabelPriority(item.name, 0) > 0;
        if (
          !important &&
          (footprintWidthPx < widthPx * 0.78 ||
            footprintHeightPx < heightPx * 0.75)
        )
          return [];
        const screenX = (item.label[0] - view.x) * scale;
        const screenY = (item.label[1] - view.y) * scale;
        const box = {
          left: screenX - widthPx / 2,
          right: screenX + widthPx / 2,
          top: screenY - heightPx / 2,
          bottom: screenY + heightPx / 2,
        };
        if (
          boxes.some(
            (other) =>
              box.left < other.right + 5 &&
              box.right > other.left - 5 &&
              box.top < other.bottom + 4 &&
              box.bottom > other.top - 4,
          )
        )
          return [];
        boxes.push(box);
        return [
          {
            ...item,
            fontSize: fontPx / scale,
            lineHeight: (fontPx + 2) / scale,
          },
        ];
      });
  }, [mapSize.height, mapSize.width, staticShapes.buildings, view]);

  return (
    <div className="map-shell">
      <svg
        ref={svgRef}
        className={`campus-map${isDragging ? " is-dragging" : ""}`}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        role="application"
        aria-label="Interactive SGSITS campus map"
        onWheel={wheel}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onLostPointerCapture={pointerUp}
        onClick={mapClick}
        onDoubleClick={(event) => {
          event.preventDefault();
          if (pendingMapClick.current) clearTimeout(pendingMapClick.current);
          pendingMapClick.current = null;
          zoomAt(event.clientX, event.clientY, 0.65);
        }}
      >
        <g ref={worldRef} data-testid="map-world">
          <rect width="1000" height="720" className="map-ground" />
          <g className="route-network">
            {staticShapes.routes.map((item) => (
              <g
                key={item.id}
                role={onRoute ? "button" : undefined}
                tabIndex={onRoute ? 0 : undefined}
                aria-label={onRoute ? "Campus path segment" : undefined}
                className={
                  item.id === selectedId || item.id === highlightedId
                    ? "selected"
                    : ""
                }
                onKeyDown={(event) =>
                  keyboardChoose(() => onRoute?.(item.id), event)
                }
              >
                <path
                  d={item.d}
                  className="route-hit"
                  onClick={
                    onRoute
                      ? (event) => choose(() => onRoute(item.id), event)
                      : undefined
                  }
                />
                <path
                  d={item.d}
                  className={`route-visible ${item.blocked ? "blocked" : ""}`}
                  pointerEvents="none"
                />
              </g>
            ))}
          </g>
          <g className="buildings">
            {staticShapes.buildings.map((item) => (
              <g
                key={item.id}
                role={onBuilding ? "button" : undefined}
                tabIndex={onBuilding ? 0 : undefined}
                aria-label={onBuilding ? item.name : undefined}
                className={
                  item.id === selectedId || item.id === highlightedId
                    ? "selected"
                    : ""
                }
                onClick={
                  onBuilding
                    ? (event) => choose(() => onBuilding(item.id), event)
                    : undefined
                }
                onKeyDown={(event) =>
                  keyboardChoose(() => onBuilding?.(item.id), event)
                }
              >
                <title>{item.name}</title>
                <path d={item.d} className="building-shape" />
              </g>
            ))}
            <g className="building-labels" aria-hidden="true">
              {visibleLabels.map((item) => (
                <text
                  key={item.id}
                  x={item.label[0]}
                  y={
                    item.label[1] -
                    ((item.labelLines.length - 1) * item.lineHeight) / 2
                  }
                  className="building-label"
                  style={{ fontSize: item.fontSize }}
                >
                  {item.labelLines.map((line, index) => (
                    <tspan
                      key={line}
                      x={item.label[0]}
                      dy={index === 0 ? 0 : item.lineHeight}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              ))}
            </g>
          </g>
          <g className="public-points">
            {data.points.map((item) => {
              const at = projection.project(item.coordinates);
              return (
                <g
                  key={item.id}
                  role={onPoint ? "button" : undefined}
                  tabIndex={onPoint ? 0 : undefined}
                  aria-label={onPoint ? item.name : undefined}
                  className={
                    item.id === selectedId || item.id === highlightedId
                      ? "selected"
                      : ""
                  }
                  onClick={
                    onPoint
                      ? (event) => choose(() => onPoint(item.id), event)
                      : undefined
                  }
                  onKeyDown={(event) =>
                    keyboardChoose(() => onPoint?.(item.id), event)
                  }
                >
                  <circle cx={at[0]} cy={at[1]} r="8" />
                  <text x={at[0] + 12} y={at[1] - 8}>
                    {item.name}
                  </text>
                </g>
              );
            })}
          </g>
          {routePath && <path d={routePath} className="calculated-route" />}
          {routeStart && !confirmedStartPoint && (
            <g
              className="route-marker route-start-marker"
              aria-label="Route start"
            >
              <circle cx={routeStart[0]} cy={routeStart[1]} r="11" />
              <text x={routeStart[0]} y={routeStart[1]}>
                A
              </text>
            </g>
          )}
          {routeEnd && !confirmedDestinationPoint && (
            <g
              className="route-marker route-end-marker"
              aria-label="Route destination"
            >
              <circle cx={routeEnd[0]} cy={routeEnd[1]} r="11" />
              <text x={routeEnd[0]} y={routeEnd[1]}>
                B
              </text>
            </g>
          )}
          {gpsPoint && (
            <g className="gps-marker">
              <circle cx={gpsPoint[0]} cy={gpsPoint[1]} r="13" />
              <circle cx={gpsPoint[0]} cy={gpsPoint[1]} r="5" />
            </g>
          )}
          {pickedPoint && (
            <g className="picked-marker" data-testid="picked-marker">
              <circle cx={pickedPoint[0]} cy={pickedPoint[1]} r="11" />
              <path
                d={`M${pickedPoint[0] - 5} ${pickedPoint[1]}h10M${pickedPoint[0]} ${pickedPoint[1] - 5}v10`}
              />
            </g>
          )}
          {confirmedStartPoint && (
            <g
              className="route-marker route-start-marker endpoint-marker"
              data-testid="start-marker"
            >
              <circle
                cx={confirmedStartPoint[0]}
                cy={confirmedStartPoint[1]}
                r="11"
              />
              <text x={confirmedStartPoint[0]} y={confirmedStartPoint[1]}>
                A
              </text>
            </g>
          )}
          {confirmedDestinationPoint && (
            <g
              className="route-marker route-end-marker endpoint-marker"
              data-testid="destination-marker"
            >
              <circle
                cx={confirmedDestinationPoint[0]}
                cy={confirmedDestinationPoint[1]}
                r="11"
              />
              <text
                x={confirmedDestinationPoint[0]}
                y={confirmedDestinationPoint[1]}
              >
                B
              </text>
            </g>
          )}
          {draftPoint && (
            <g
              className={`draft-marker ${draftMarkerKind ?? "start"}`}
              data-testid="draft-marker"
            >
              <circle cx={draftPoint[0]} cy={draftPoint[1]} r="13" />
              <circle cx={draftPoint[0]} cy={draftPoint[1]} r="4" />
            </g>
          )}
        </g>
      </svg>
      <div className="map-tools" aria-label="Map controls">
        <button
          type="button"
          onClick={() => zoomFromCenter(0.78)}
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomFromCenter(1.24)}
          aria-label="Zoom out"
          title="Zoom out"
        >
          &minus;
        </button>
        <button
          type="button"
          onClick={() => commitView(defaultView)}
          aria-label="Fit campus map"
          title="Fit campus"
        >
          <span aria-hidden="true">&#9635;</span>
          <span className="map-tool-label">Fit</span>
        </button>
      </div>
      <div className="map-legend" aria-label="Map legend">
        <span>
          <i className="legend-line" aria-hidden="true" /> Path
        </span>
        <span>
          <i className="legend-line blocked" aria-hidden="true" /> Blocked
        </span>
        <span>
          <i className="legend-dot start" aria-hidden="true" /> Start
        </span>
        <span>
          <i className="legend-dot destination" aria-hidden="true" />{" "}
          Destination
        </span>
      </div>
      <a
        className="attribution"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        © OpenStreetMap contributors
      </a>
    </div>
  );
});
