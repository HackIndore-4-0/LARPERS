import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import type {
  LonLat,
  MapPayload,
  RouteDetails,
  RouteRequest,
  RouteResponse,
  RouteTarget,
  SavedFloor,
  TravelProfile,
} from "@campus-access/shared";
import { ApiClientError, api } from "./api";
import { FloorLayoutView } from "./FloorLayout";
import { interiorLabelPoint, isFallbackBuildingName } from "./mapLabels";
import { SvgCampusMap } from "./SvgCampusMap";

type Mode = "view" | "routing" | "note";
type Endpoint = "start" | "destination";
type PickerMethod = "search" | "point" | "building";
type MessageTone = "success" | "warning" | "error";

const profileOptions: Array<{
  value: TravelProfile;
  label: string;
  description: string;
}> = [
  { value: "healthy", label: "Healthy", description: "Standard walking route" },
  {
    value: "wheelchair",
    label: "Wheelchair",
    description: "Prioritises accessible paths",
  },
  {
    value: "heavy_luggage",
    label: "Heavy luggage",
    description: "Avoids difficult passages",
  },
];

function floorLabel(number: number): string {
  if (number === 0) return "Ground";
  if (number < 0) return `Basement ${Math.abs(number)}`;
  return `Floor ${number}`;
}

export function PublicPage() {
  const panelRef = useRef<HTMLElement>(null);
  const [data, setData] = useState<MapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<RouteDetails | null>(null);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [floors, setFloors] = useState<number[]>([]);
  const [floor, setFloor] = useState<SavedFloor | null>(null);
  const [floorMessage, setFloorMessage] = useState("");
  const [activeEndpoint, setActiveEndpoint] = useState<Endpoint | null>(null);
  const [pickerMethod, setPickerMethod] = useState<PickerMethod | null>(null);
  const [draftSelection, setDraftSelection] = useState<RouteTarget | null>(
    null,
  );
  const [buildingQuery, setBuildingQuery] = useState("");
  const [start, setStart] = useState<RouteTarget | null>(null);
  const [destination, setDestination] = useState<RouteTarget | null>(null);
  const [profile, setProfile] = useState<TravelProfile>("healthy");
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [gps, setGps] = useState<LonLat | null>(null);
  const [noteLocation, setNoteLocation] = useState<LonLat | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<MessageTone>("warning");
  const [busy, setBusy] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const routeRequest = useRef(0);

  const showNotice = (text: string, tone: MessageTone = "warning"): void => {
    setNotice(text);
    setNoticeTone(tone);
  };

  const invalidateRouteRequest = (): void => {
    routeRequest.current += 1;
    setBusy(false);
  };

  const loadMap = useCallback(async () => {
    setError(null);
    try {
      setData(await api.map());
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Campus map is unavailable.",
      );
    }
  }, []);

  useEffect(() => {
    void loadMap();
  }, [loadMap]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (panelRef.current) panelRef.current.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  useEffect(() => {
    setActiveEndpoint(null);
    setPickerMethod(null);
    setDraftSelection(null);
    setBuildingQuery("");
  }, [mode]);

  useEffect(() => {
    const cancel = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !activeEndpoint) return;
      setActiveEndpoint(null);
      setPickerMethod(null);
      setDraftSelection(null);
      setBuildingQuery("");
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [activeEndpoint]);

  useEffect(
    () => () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    },
    [imagePreview],
  );

  const chooseRoute = async (id: string): Promise<void> => {
    setSelectedId(id);
    setBuildingId(null);
    setFloor(null);
    setNotice(null);
    try {
      setDetails(await api.routeDetails(id));
    } catch (caught) {
      showNotice(
        caught instanceof Error
          ? caught.message
          : "Could not load route details.",
        "error",
      );
    }
  };

  const loadFloor = async (id: string, number: number): Promise<void> => {
    setFloor(null);
    setFloorMessage("Loading floor…");
    try {
      setFloor(await api.floor(id, number));
      setFloorMessage("");
    } catch (caught) {
      setFloorMessage(
        caught instanceof ApiClientError && caught.status === 404
          ? "No data available."
          : "Floor data could not be loaded.",
      );
    }
  };

  const chooseBuilding = async (id: string): Promise<void> => {
    setSelectedId(id);
    setBuildingId(id);
    setDetails(null);
    setFloor(null);
    setFloorMessage("Loading floors…");
    try {
      const list = await api.floors(id);
      const numbers = list.map((item) => item.number).sort((a, b) => a - b);
      setFloors(numbers);
      if (numbers[0] !== undefined) await loadFloor(id, numbers[0]);
      else setFloorMessage("No data available.");
    } catch {
      setFloors([]);
      setFloorMessage("Floor data could not be loaded.");
    }
  };

  const calculate = useCallback(
    async (request?: RouteRequest) => {
      const body =
        request ??
        (start && destination ? { start, destination, profile } : null);
      if (!body) {
        showNotice("Choose both a starting point and destination.");
        return;
      }
      setBusy(true);
      setNotice(null);
      const requestId = ++routeRequest.current;
      try {
        const result = await api.route(body);
        if (requestId !== routeRequest.current) return;
        setRoute(result);
        if (result.status === "no_route") showNotice(result.message);
      } catch (caught) {
        if (requestId !== routeRequest.current) return;
        setRoute(null);
        showNotice(
          caught instanceof Error
            ? caught.message
            : "Routing is temporarily unavailable.",
          "error",
        );
      } finally {
        if (requestId === routeRequest.current) setBusy(false);
      }
    },
    [destination, profile, start],
  );

  useEffect(() => {
    if (!route || route.status !== "ok" || !start || !destination) return;
    const refresh = async (): Promise<void> => {
      try {
        const revision = await api.revision();
        if (revision.revision !== route.revision) {
          await calculate({ start, destination, profile });
          await loadMap();
        }
      } catch {
        /* Preserve the route during a transient revision check failure. */
      }
    };
    const timer = window.setInterval(() => void refresh(), 15_000);
    const focus = (): void => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [calculate, destination, loadMap, profile, route, start]);

  const mapPick = (coordinates: LonLat): void => {
    if (mode === "routing" && activeEndpoint && pickerMethod === "point") {
      setDraftSelection({ kind: "coordinate", coordinates });
      setNotice(null);
    } else if (mode === "note") {
      setNoteLocation(coordinates);
      setNotice(null);
    }
  };

  const locate = (): void => {
    if (!navigator.geolocation) {
      showNotice("Location is not available in this browser.", "error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinates: LonLat = [
          position.coords.longitude,
          position.coords.latitude,
        ];
        setGps(coordinates);
        setStart({ kind: "coordinate", coordinates });
        invalidateRouteRequest();
        setActiveEndpoint(null);
        setPickerMethod(null);
        setDraftSelection(null);
        setRoute(null);
        setNotice(null);
      },
      () =>
        showNotice(
          "Location permission was not granted. Choose the start on the map instead.",
        ),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const beginPicker = (endpoint: Endpoint, method: PickerMethod): void => {
    setActiveEndpoint(endpoint);
    setPickerMethod(method);
    setDraftSelection(null);
    setBuildingQuery("");
    setNotice(null);
  };

  const cancelPicker = (): void => {
    setActiveEndpoint(null);
    setPickerMethod(null);
    setDraftSelection(null);
    setBuildingQuery("");
  };

  const confirmDraft = (): void => {
    if (!activeEndpoint || !draftSelection) return;
    if (activeEndpoint === "start") setStart(draftSelection);
    else setDestination(draftSelection);
    invalidateRouteRequest();
    if (draftSelection.kind === "building")
      setSelectedId(draftSelection.buildingId);
    setActiveEndpoint(null);
    setPickerMethod(null);
    setDraftSelection(null);
    setBuildingQuery("");
    setRoute(null);
    setNotice(null);
  };

  const clearRoute = (): void => {
    setStart(null);
    setDestination(null);
    setRoute(null);
    setGps(null);
    invalidateRouteRequest();
    cancelPicker();
    setNotice(null);
  };

  const handleImage = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    setImagePreview(file ? URL.createObjectURL(file) : null);
  };

  const removeImage = (): void => {
    if (imageInputRef.current) imageInputRef.current.value = "";
    setImagePreview(null);
  };

  const submitNote = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (!noteLocation) {
      showNotice("Select a location on the map first.");
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.set("longitude", String(noteLocation[0]));
    form.set("latitude", String(noteLocation[1]));
    setBusy(true);
    setNotice(null);
    try {
      await api.sendMessage(form);
      formElement.reset();
      setImagePreview(null);
      setNoteLocation(null);
      showNotice(
        "Thanks — your note was received for editor review.",
        "success",
      );
    } catch (caught) {
      showNotice(
        caught instanceof Error
          ? caught.message
          : "Your note could not be sent. Your draft is still here.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const selectedBuilding = data?.buildings.find(
    (item) => item.id === buildingId,
  );
  const selectedPoint = data?.points.find((item) => item.id === selectedId);
  const endpointLabel = (target: RouteTarget | null): string => {
    if (!target) return "Not selected";
    if (target.kind === "coordinate") return "Selected point";
    const building = data?.buildings.find(
      (item) => item.id === target.buildingId,
    );
    if (!building) return "Selected building";
    return isFallbackBuildingName(building.name)
      ? `Unnamed building (${building.id})`
      : building.name;
  };
  const targetCoordinate = (target: RouteTarget | null): LonLat | null => {
    if (!target) return null;
    if (target.kind === "coordinate") return target.coordinates;
    const building = data?.buildings.find(
      (item) => item.id === target.buildingId,
    );
    const ring = building?.footprint.coordinates[0] as LonLat[] | undefined;
    return ring?.length ? (interiorLabelPoint(ring) as LonLat) : null;
  };
  const filteredBuildings = (data?.buildings ?? [])
    .filter((item) => {
      const query = buildingQuery.trim().toLocaleLowerCase();
      return (
        !query ||
        item.name.toLocaleLowerCase().includes(query) ||
        item.id.toLocaleLowerCase().includes(query)
      );
    })
    .slice(0, 8);

  if (error)
    return (
      <main className="center-state">
        <section className="state-message error" role="alert">
          <h1>Campus map unavailable</h1>
          <p>{error}</p>
          <button className="button primary" onClick={() => void loadMap()}>
            Retry
          </button>
        </section>
      </main>
    );
  if (!data)
    return (
      <main className="center-state">
        <p className="state-message" role="status">
          Loading the SGSITS campus map…
        </p>
      </main>
    );

  const renderEndpointPicker = (
    endpoint: Endpoint,
    label: string,
    confirmed: RouteTarget | null,
  ) => {
    const active = activeEndpoint === endpoint;
    return (
      <article className={`endpoint-card ${endpoint}`}>
        <div className="endpoint-title">
          <span className={`endpoint-dot ${endpoint}`} aria-hidden="true" />
          <div>
            <p className="panel-eyebrow">{label}</p>
            <strong>{endpointLabel(confirmed)}</strong>
          </div>
          {confirmed && !active && (
            <button
              type="button"
              className="link-button endpoint-edit"
              onClick={() => beginPicker(endpoint, "search")}
            >
              Edit
            </button>
          )}
        </div>
        <div
          className="endpoint-methods"
          aria-label={`${label} selection method`}
        >
          <button
            type="button"
            className={active && pickerMethod === "search" ? "active" : ""}
            onClick={() => beginPicker(endpoint, "search")}
          >
            Search building
          </button>
          <button
            type="button"
            className={active && pickerMethod === "point" ? "active" : ""}
            onClick={() => beginPicker(endpoint, "point")}
          >
            Pick point on map
          </button>
          <button
            type="button"
            className={active && pickerMethod === "building" ? "active" : ""}
            onClick={() => beginPicker(endpoint, "building")}
          >
            Pick building on map
          </button>
        </div>
        {active && (
          <div className="endpoint-draft" aria-live="polite">
            {pickerMethod === "search" && (
              <>
                <label className="field">
                  <span>Search buildings</span>
                  <input
                    value={buildingQuery}
                    autoFocus
                    placeholder="Central Library"
                    onChange={(event) => {
                      setBuildingQuery(event.target.value);
                      setDraftSelection(null);
                    }}
                  />
                </label>
                <div
                  className="building-search-results"
                  role="listbox"
                  aria-label="Building search results"
                >
                  {filteredBuildings.map((item) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={
                        draftSelection?.kind === "building" &&
                        draftSelection.buildingId === item.id
                      }
                      className={
                        draftSelection?.kind === "building" &&
                        draftSelection.buildingId === item.id
                          ? "active"
                          : ""
                      }
                      key={item.id}
                      onClick={() =>
                        setDraftSelection({
                          kind: "building",
                          buildingId: item.id,
                        })
                      }
                    >
                      {isFallbackBuildingName(item.name)
                        ? `Unnamed building (${item.id})`
                        : item.name}
                    </button>
                  ))}
                </div>
              </>
            )}
            {pickerMethod === "point" && !draftSelection && (
              <p className="picker-guidance">
                Tap the exact point on the map. You can still drag to pan.
              </p>
            )}
            {pickerMethod === "building" && !draftSelection && (
              <p className="picker-guidance">
                Tap a building footprint on the map.
              </p>
            )}
            {draftSelection && (
              <p className="endpoint-summary">
                <strong>Draft:</strong> {endpointLabel(draftSelection)}
              </p>
            )}
            <div className="action-row compact-actions">
              <button
                type="button"
                className="button ghost"
                onClick={cancelPicker}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button primary"
                disabled={!draftSelection}
                onClick={confirmDraft}
              >
                {pickerMethod === "point" ? "Use this point" : "Use selection"}
              </button>
            </div>
          </div>
        )}
        {endpoint === "start" && !active && (
          <button
            type="button"
            className="button ghost gps-action"
            onClick={locate}
          >
            Use my location
          </button>
        )}
      </article>
    );
  };

  return (
    <div className="app-shell public-shell">
      <header>
        <a className="brand" href="/">
          SGSITS <span>Campus Map</span>
        </a>
        <a href="/editor">Editor</a>
      </header>
      <main className="workspace public-workspace">
        <SvgCampusMap
          data={data}
          selectedId={selectedId}
          highlightedId={
            draftSelection?.kind === "building"
              ? draftSelection.buildingId
              : null
          }
          routeCoordinates={
            route?.status === "ok"
              ? (route.geometry.coordinates as LonLat[])
              : undefined
          }
          gps={gps}
          picked={mode === "note" ? noteLocation : null}
          startMarker={mode === "routing" ? targetCoordinate(start) : null}
          destinationMarker={
            mode === "routing" ? targetCoordinate(destination) : null
          }
          draftMarker={
            mode === "routing" ? targetCoordinate(draftSelection) : null
          }
          draftMarkerKind={activeEndpoint ?? undefined}
          onRoute={mode === "view" ? (id) => void chooseRoute(id) : undefined}
          onBuilding={
            mode === "note" ||
            (mode === "routing" && activeEndpoint && pickerMethod === "point")
              ? undefined
              : mode === "routing" &&
                  activeEndpoint &&
                  pickerMethod === "building"
                ? (id) =>
                    setDraftSelection({ kind: "building", buildingId: id })
                : (id) => {
                    if (mode === "routing") setMode("view");
                    void chooseBuilding(id);
                  }
          }
          onPoint={
            mode === "view"
              ? (id) => {
                  setSelectedId(id);
                  setBuildingId(null);
                  setDetails(null);
                }
              : undefined
          }
          onMap={
            mode === "note" ||
            (mode === "routing" && activeEndpoint && pickerMethod === "point")
              ? mapPick
              : undefined
          }
        />
        <aside
          key={mode}
          ref={panelRef}
          className={`side-panel task-panel public-panel mode-${mode} ${panelCollapsed ? "is-collapsed" : ""}`}
          aria-label="Campus map tools"
        >
          <button
            type="button"
            className="panel-handle"
            aria-expanded={!panelCollapsed}
            onClick={() => setPanelCollapsed((current) => !current)}
          >
            {panelCollapsed ? "Open panel" : "Collapse panel"}
          </button>
          <div className="panel-content">
            <div className="panel-heading">
              <p className="panel-eyebrow">SGSITS campus</p>
              <h1>Campus Map</h1>
              <p className="panel-copy">
                Explore, plan a route, or send a note.
              </p>
            </div>
            <nav className="mode-tabs" aria-label="Map mode">
              {(
                [
                  ["view", "View"],
                  ["routing", "Routing"],
                  ["note", "Send Note"],
                ] as Array<[Mode, string]>
              ).map(([item, label]) => (
                <button
                  key={item}
                  type="button"
                  className={mode === item ? "active" : ""}
                  aria-current={mode === item ? "page" : undefined}
                  onClick={() => {
                    setMode(item);
                    setNotice(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
            {notice && (
              <p className={`state-message ${noticeTone}`} role="status">
                {notice}
              </p>
            )}

            {mode === "view" && (
              <section aria-labelledby="view-heading">
                <div className="panel-heading">
                  <p className="panel-eyebrow">Explore campus</p>
                  <h2 id="view-heading">What would you like to see?</h2>
                  <p className="panel-copy">
                    Select a building, path, or named point on the map.
                  </p>
                </div>
                <label className="field">
                  <span>Search buildings</span>
                  <select
                    value={buildingId ?? ""}
                    onChange={(event) => {
                      if (event.target.value)
                        void chooseBuilding(event.target.value);
                    }}
                  >
                    <option value="">Choose a building…</option>
                    {data.buildings.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                {details && (
                  <article className="selection-card" aria-live="polite">
                    <div className="selection-card-heading">
                      <div>
                        <p className="panel-eyebrow">Selected path</p>
                        <h2>Campus path</h2>
                      </div>
                      <span
                        className={`status-badge ${details.blocked ? "error" : "success"}`}
                      >
                        {details.blocked ? "Blocked" : "Open"}
                      </span>
                    </div>
                    <p>
                      {details.publicNote || "No public note for this path."}
                    </p>
                    {details.blocked && (
                      <p className="state-message error">
                        <strong>Why it is blocked:</strong>{" "}
                        {details.blockReason ||
                          "This path is currently unavailable."}
                      </p>
                    )}
                  </article>
                )}
                {selectedBuilding && (
                  <article className="selection-card building-details">
                    <div className="selection-card-heading">
                      <div>
                        <p className="panel-eyebrow">Selected building</p>
                        <h2>{selectedBuilding.name}</h2>
                      </div>
                      <span className="status-badge success">Building</span>
                    </div>
                    <dl className="building-facts">
                      {selectedBuilding.levels !== null && (
                        <div>
                          <dt>Levels</dt>
                          <dd>{selectedBuilding.levels}</dd>
                        </div>
                      )}
                      {selectedBuilding.groundFloorLiftAvailable !== null && (
                        <div>
                          <dt>Ground-floor lift</dt>
                          <dd>
                            {selectedBuilding.groundFloorLiftAvailable
                              ? "Available"
                              : "Not listed"}
                          </dd>
                        </div>
                      )}
                    </dl>
                    <section aria-labelledby="interior-heading">
                      <div className="panel-heading compact">
                        <h3 id="interior-heading">Interior layout</h3>
                        <p className="panel-copy">
                          Choose a floor to view its saved layout.
                        </p>
                      </div>
                      {floors.length > 0 && (
                        <div
                          className="floor-tabs"
                          role="tablist"
                          aria-label="Floors"
                        >
                          {floors.map((number) => (
                            <button
                              key={number}
                              type="button"
                              role="tab"
                              className={`floor-tab ${floor?.number === number ? "active" : ""}`}
                              aria-selected={floor?.number === number}
                              onClick={() =>
                                void loadFloor(selectedBuilding.id, number)
                              }
                            >
                              {floorLabel(number)}
                            </button>
                          ))}
                        </div>
                      )}
                      {floor ? (
                        <FloorLayoutView floor={floor} />
                      ) : (
                        <p className="state-message">{floorMessage}</p>
                      )}
                    </section>
                  </article>
                )}
                {selectedPoint && (
                  <article className="selection-card">
                    <p className="panel-eyebrow">Selected place</p>
                    <h2>{selectedPoint.name}</h2>
                    <p>{selectedPoint.note || "No additional details."}</p>
                  </article>
                )}
              </section>
            )}

            {mode === "routing" && (
              <section aria-labelledby="routing-heading">
                <div className="panel-heading">
                  <p className="panel-eyebrow">Outdoor directions</p>
                  <h2 id="routing-heading">Plan a route</h2>
                  <p className="panel-copy">
                    Choose buildings below or pick each location on the map.
                  </p>
                </div>
                <div className="endpoint-grid">
                  {renderEndpointPicker("start", "Starting point", start)}
                  {renderEndpointPicker(
                    "destination",
                    "Destination",
                    destination,
                  )}
                </div>
                {selectedBuilding && !activeEndpoint && (
                  <article className="selection-card compact-building-details">
                    <p className="panel-eyebrow">Selected building</p>
                    <h2>
                      {isFallbackBuildingName(selectedBuilding.name)
                        ? `Unnamed building (${selectedBuilding.id})`
                        : selectedBuilding.name}
                    </h2>
                    <p>Select an endpoint method above to use this building.</p>
                  </article>
                )}
                <fieldset className="profile-options">
                  <legend>Travel profile</legend>
                  {profileOptions.map((option) => (
                    <label
                      className={`profile-option ${profile === option.value ? "active" : ""}`}
                      key={option.value}
                    >
                      <input
                        type="radio"
                        name="travel-profile"
                        value={option.value}
                        checked={profile === option.value}
                        onChange={() => {
                          invalidateRouteRequest();
                          setProfile(option.value);
                          setRoute(null);
                        }}
                      />
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.description}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="action-row route-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy || !start || !destination}
                    onClick={() => void calculate()}
                  >
                    {busy ? "Finding route…" : "Show route"}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!start && !destination && !route}
                    onClick={clearRoute}
                  >
                    Clear route
                  </button>
                </div>
                {route?.status === "ok" && (
                  <article className="selection-card route-summary">
                    <div className="selection-card-heading">
                      <div>
                        <p className="panel-eyebrow">Route ready</p>
                        <h2>Directions</h2>
                      </div>
                      <span className="status-badge success">Available</span>
                    </div>
                    <ol>
                      {route.directions.map((item, index) => (
                        <li key={`${index}-${item}`}>{item}</li>
                      ))}
                    </ol>
                    {route.warnings.map((item) => (
                      <p className="state-message warning" key={item}>
                        {item}
                      </p>
                    ))}
                  </article>
                )}
              </section>
            )}

            {mode === "note" && (
              <section aria-labelledby="note-heading">
                <div className="panel-heading">
                  <p className="panel-eyebrow">Help improve access</p>
                  <h2 id="note-heading">Send a campus note</h2>
                  <p className="panel-copy">
                    Select the location, describe what you noticed, and add a
                    photo if it helps.
                  </p>
                </div>
                <form onSubmit={(event) => void submitNote(event)}>
                  <div className="selection-card location-selection">
                    <div>
                      <p className="panel-eyebrow">Selected location</p>
                      <strong>
                        {noteLocation
                          ? "Location ready"
                          : "No location selected"}
                      </strong>
                    </div>
                    <span
                      className={`status-badge ${noteLocation ? "success" : "warning"}`}
                    >
                      {noteLocation ? "Selected" : "Required"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="button secondary location-action"
                    onClick={() =>
                      showNotice("Tap the place you want to note on the map.")
                    }
                  >
                    {noteLocation
                      ? "Change map location"
                      : "Select location on map"}
                  </button>
                  <label className="field">
                    <span>Your note</span>
                    <textarea
                      name="text"
                      required
                      maxLength={2000}
                      rows={5}
                      placeholder="Describe the access issue or useful update."
                    />
                  </label>
                  <label className="field">
                    <span>
                      Evidence image <small>(optional)</small>
                    </span>
                    <input
                      ref={imageInputRef}
                      name="image"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleImage}
                    />
                  </label>
                  {imagePreview && (
                    <div className="image-preview">
                      <img src={imagePreview} alt="Selected evidence preview" />
                      <button
                        type="button"
                        className="button ghost"
                        onClick={removeImage}
                      >
                        Remove image
                      </button>
                    </div>
                  )}
                  <div className="action-row">
                    <button
                      className="button primary"
                      disabled={busy || !noteLocation}
                    >
                      {busy ? "Sending note…" : "Send note"}
                    </button>
                  </div>
                </form>
              </section>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
