import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  FloorLayout,
  LonLat,
  MapPayload,
  RouteDetails,
  VisitorMessage,
} from "@campus-access/shared";
import { api } from "./api";
import { FloorDesigner } from "./FloorLayout";
import { SvgCampusMap } from "./SvgCampusMap";

type Tool = "route" | "floor" | "point" | "inbox";
type MessageFilter = VisitorMessage["status"];
type FloorSaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

const blankLayout = (): FloorLayout => ({
  canvasWidth: 800,
  canvasHeight: 520,
  blocks: [],
});
const toolLabels: Record<Tool, string> = {
  route: "Routes",
  floor: "Floor design",
  point: "Add point",
  inbox: "Notifications",
};
const messageLabels: Record<MessageFilter, string> = {
  incoming: "Incoming",
  saved: "Saved",
  addressed: "Addressed",
};
const floorLabel = (number: number): string => {
  if (number === 0) return "Ground";
  if (number < 0) return `Basement ${Math.abs(number)}`;
  return `Floor ${number}`;
};

function Login({ onToken }: { onToken(value: string): void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      onToken(
        (
          await api.login(
            String(form.get("email")),
            String(form.get("password")),
          )
        ).token,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login-page">
      <form
        className="login-card task-panel"
        onSubmit={(event) => void submit(event)}
      >
        <a className="brand" href="/">
          SGSITS <span>Campus Access</span>
        </a>
        <div className="panel-heading">
          <div>
            <p className="panel-eyebrow">Protected workspace</p>
            <h1>Editor login</h1>
          </div>
        </div>
        <p className="panel-copy">
          Sign in to maintain campus access information.
        </p>
        {error && (
          <p className="state-message error" role="alert">
            {error}
          </p>
        )}
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

export function EditorPage() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<MapPayload | null>(null);
  const [tool, setTool] = useState<Tool>("route");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const [routeDetails, setRouteDetails] = useState<RouteDetails | null>(null);
  const [routeNote, setRouteNote] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [reason, setReason] = useState("");

  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [buildingSearch, setBuildingSearch] = useState("");
  const [floorNumbers, setFloorNumbers] = useState<number[]>([]);
  const [floorNumber, setFloorNumber] = useState<number | null>(null);
  const [layout, setLayout] = useState<FloorLayout>(blankLayout);
  const [floorDirty, setFloorDirty] = useState(false);
  const [floorLoading, setFloorLoading] = useState(false);
  const [floorSaveState, setFloorSaveState] = useState<FloorSaveState>("idle");
  const [floorSaveMessage, setFloorSaveMessage] = useState("");
  const [addingFloor, setAddingFloor] = useState(false);
  const [newFloorNumber, setNewFloorNumber] = useState("");
  const [newFloorError, setNewFloorError] = useState("");
  const floorLoadSequence = useRef(0);

  const [pointLocation, setPointLocation] = useState<LonLat | null>(null);
  const [pointId, setPointId] = useState<string | null>(null);
  const [pointName, setPointName] = useState("");
  const [pointNote, setPointNote] = useState("");

  const [messages, setMessages] = useState<VisitorMessage[]>([]);
  const [messageFilter, setMessageFilter] = useState<MessageFilter>("incoming");
  const [activeMessage, setActiveMessage] = useState<VisitorMessage | null>(
    null,
  );
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null);

  const refreshMap = async (): Promise<void> => {
    try {
      setData(await api.map());
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Map unavailable.");
    }
  };
  const refreshMessages = async (value = token): Promise<void> => {
    if (!value) return;
    try {
      setMessages(await api.messages(value));
    } catch (caught) {
      setNotice(
        caught instanceof Error ? caught.message : "Notifications unavailable.",
      );
    }
  };
  useEffect(() => {
    if (token) {
      void refreshMap();
      void refreshMessages(token);
    }
  }, [token]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (!floorDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [floorDirty]);

  const selectedBuilding =
    data?.buildings.find((building) => building.id === buildingId) ?? null;
  const searchBuilding =
    data?.buildings.find(
      (building) =>
        building.name.localeCompare(buildingSearch.trim(), undefined, {
          sensitivity: "accent",
        }) === 0,
    ) ?? null;
  const displayedFloors = useMemo(() => {
    const values = [...floorNumbers];
    if (floorNumber !== null && !values.includes(floorNumber))
      values.push(floorNumber);
    return values.sort((a, b) => a - b);
  }, [floorNumber, floorNumbers]);
  const messageCounts = useMemo(
    () => ({
      incoming: messages.filter((message) => message.status === "incoming")
        .length,
      saved: messages.filter((message) => message.status === "saved").length,
      addressed: messages.filter((message) => message.status === "addressed")
        .length,
    }),
    [messages],
  );
  const filteredMessages = messages.filter(
    (message) => message.status === messageFilter,
  );

  if (!token) return <Login onToken={setToken} />;
  if (!data)
    return (
      <main className="center-state">
        <p>Loading editor map…</p>
        {notice && <p className="state-message error">{notice}</p>}
      </main>
    );

  const selectTool = (value: Tool): void => {
    setTool(value);
    setPanelCollapsed(false);
    setNotice("");
  };
  const applyRouteDetails = (value: RouteDetails): void => {
    setRouteDetails(value);
    setRouteNote(value.publicNote ?? "");
    setBlocked(value.blocked);
    setReason(value.blockReason ?? "");
  };
  const chooseRoute = async (id: string): Promise<void> => {
    selectTool("route");
    setSelectedId(id);
    try {
      applyRouteDetails(await api.routeDetails(id));
    } catch (caught) {
      setNotice(
        caught instanceof Error ? caught.message : "Route details unavailable.",
      );
    }
  };
  const saveRoute = async (): Promise<void> => {
    if (!selectedId) return;
    try {
      await api.saveRoute(token, selectedId, {
        publicNote: routeNote || null,
        blocked,
        blockReason: blocked ? reason : null,
        expiresAt: null,
      });
      setNotice(
        blocked ? "Route block saved." : "Route is available for routing.",
      );
      await refreshMap();
      applyRouteDetails(await api.routeDetails(selectedId));
    } catch (caught) {
      setNotice(
        caught instanceof Error ? caught.message : "Route could not be saved.",
      );
    }
  };

  const loadFloor = async (
    id: string,
    requestedNumber?: number,
    discardHandled = false,
  ): Promise<void> => {
    const sameSelection =
      id === buildingId &&
      (requestedNumber === undefined || requestedNumber === floorNumber) &&
      tool === "floor";
    if (sameSelection) return;
    if (
      floorDirty &&
      !discardHandled &&
      !window.confirm("Discard your unsaved floor changes?")
    )
      return;
    const sequence = ++floorLoadSequence.current;
    const building = data.buildings.find((item) => item.id === id);
    setTool("floor");
    setPanelCollapsed(false);
    setSelectedId(id);
    setBuildingId(id);
    setBuildingSearch(building?.name ?? "");
    setAddingFloor(false);
    setNewFloorError("");
    setNotice("");
    setFloorLoading(true);
    setFloorDirty(false);
    setFloorSaveState("idle");
    setFloorSaveMessage("");
    setFloorNumber(requestedNumber ?? null);
    setLayout(blankLayout());
    if (id !== buildingId) setFloorNumbers([]);
    try {
      const floors = await api.floors(id);
      if (sequence !== floorLoadSequence.current) return;
      const numbers = floors.map((item) => item.number).sort((a, b) => a - b);
      setFloorNumbers(numbers);
      const nextNumber = requestedNumber ?? numbers[0] ?? null;
      setFloorNumber(nextNumber);
      if (nextNumber === null) {
        setLayout(blankLayout());
        setFloorSaveMessage("No saved floors yet. Use Add floor to begin.");
        return;
      }
      if (!numbers.includes(nextNumber)) {
        setLayout(blankLayout());
        setFloorDirty(true);
        setFloorSaveState("unsaved");
        setFloorSaveMessage(
          "New floor ready. Add blocks, then save when you are ready.",
        );
        return;
      }
      const saved = await api.floor(id, nextNumber);
      if (sequence !== floorLoadSequence.current) return;
      setLayout(saved.layout);
      setFloorSaveState("saved");
      setFloorSaveMessage("Saved floor loaded.");
    } catch (caught) {
      if (sequence !== floorLoadSequence.current) return;
      setFloorSaveState("error");
      setFloorSaveMessage(
        caught instanceof Error ? caught.message : "Floor could not be loaded.",
      );
    } finally {
      if (sequence === floorLoadSequence.current) setFloorLoading(false);
    }
  };
  const addFloor = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!buildingId) return;
    const number = Number(newFloorNumber);
    if (
      newFloorNumber.trim() === "" ||
      !Number.isInteger(number) ||
      number < -10 ||
      number > 200
    ) {
      setNewFloorError("Enter a whole floor number from -10 to 200.");
      return;
    }
    if (
      floorNumbers.includes(number) ||
      (floorNumber === number && floorDirty)
    ) {
      setNewFloorError(
        `${floorLabel(number)} already exists. Select its tab instead.`,
      );
      return;
    }
    if (floorDirty && !window.confirm("Discard your unsaved floor changes?"))
      return;
    setFloorNumber(number);
    setLayout(blankLayout());
    setFloorDirty(true);
    setFloorSaveState("unsaved");
    setFloorSaveMessage("New floor ready. It has not been saved yet.");
    setAddingFloor(false);
    setNewFloorNumber("");
    setNewFloorError("");
  };
  const saveFloor = async (): Promise<void> => {
    if (!buildingId || floorNumber === null) return;
    setFloorSaveState("saving");
    setFloorSaveMessage("Saving…");
    try {
      await api.saveFloor(token, buildingId, floorNumber, layout);
      setFloorNumbers((current) =>
        [...new Set([...current, floorNumber])].sort((a, b) => a - b),
      );
      setFloorDirty(false);
      setFloorSaveState("saved");
      setFloorSaveMessage(`Saved — Floor ${floorNumber} saved.`);
    } catch (caught) {
      setFloorSaveState("error");
      setFloorSaveMessage(
        caught instanceof Error
          ? `${caught.message} Your edits are preserved.`
          : "Save failed. Your edits are preserved.",
      );
    }
  };

  const selectPoint = (id: string): void => {
    const point = data.points.find((item) => item.id === id);
    if (!point) return;
    selectTool("point");
    setSelectedId(id);
    setPointId(id);
    setPointLocation(point.coordinates);
    setPointName(point.name);
    setPointNote(point.note);
  };
  const savePoint = async (): Promise<void> => {
    if (!pointLocation) {
      setNotice("Tap the map to choose a point location.");
      return;
    }
    try {
      const body = {
        name: pointName,
        note: pointNote,
        coordinates: pointLocation,
      };
      if (pointId) await api.updatePoint(token, pointId, body);
      else setPointId((await api.addPoint(token, body)).id);
      setNotice("Public point saved.");
      await refreshMap();
    } catch (caught) {
      setNotice(
        caught instanceof Error ? caught.message : "Point could not be saved.",
      );
    }
  };
  const removePoint = async (): Promise<void> => {
    if (!pointId || !window.confirm("Remove this public point?")) return;
    try {
      await api.deletePoint(token, pointId);
      setPointId(null);
      setPointName("");
      setPointNote("");
      setPointLocation(null);
      setSelectedId(null);
      setNotice("Point removed.");
      await refreshMap();
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "Point could not be removed.",
      );
    }
  };
  const openMessage = async (message: VisitorMessage): Promise<void> => {
    setActiveMessage(message);
    setPointLocation(message.coordinates);
    setEvidenceUrl(null);
    setNotice("");
    if (message.hasEvidence)
      try {
        setEvidenceUrl((await api.evidence(token, message.id)).url);
      } catch (caught) {
        setNotice(
          caught instanceof Error
            ? caught.message
            : "Evidence could not be opened.",
        );
      }
  };
  const patchMessage = async (id: string, body: unknown): Promise<void> => {
    try {
      const updated = await api.patchMessage(token, id, body);
      setActiveMessage(updated);
      await refreshMessages();
      setNotice("Notification updated.");
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "Notification could not be updated.",
      );
    }
  };
  const deleteMessage = async (id: string): Promise<void> => {
    if (!window.confirm("Delete this visitor note and its evidence?")) return;
    try {
      await api.deleteMessage(token, id);
      setActiveMessage(null);
      setEvidenceUrl(null);
      await refreshMessages();
      setNotice("Notification deleted.");
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "Notification could not be deleted.",
      );
    }
  };

  return (
    <div className="app-shell editor-shell" data-tool={tool}>
      <header className="app-header">
        <a className="brand" href="/">
          SGSITS <span>Editor</span>
        </a>
        <button className="button ghost" onClick={() => setToken(null)}>
          Log out
        </button>
      </header>
      <main className="workspace editor-workspace">
        <SvgCampusMap
          data={data}
          selectedId={selectedId}
          picked={pointLocation}
          onRoute={tool === "point" ? undefined : (id) => void chooseRoute(id)}
          onBuilding={tool === "point" ? undefined : (id) => void loadFloor(id)}
          onPoint={tool === "point" ? undefined : selectPoint}
          onMap={(coordinate) => {
            if (tool === "point") {
              setPointLocation(coordinate);
              setPointId(null);
              setSelectedId(null);
              setNotice("Location selected.");
            }
          }}
        />
        <aside
          key={tool}
          className={`side-panel task-panel editor-panel tool-${tool}${panelCollapsed ? " is-collapsed" : ""}`}
        >
          <button
            className="panel-handle"
            type="button"
            aria-expanded={!panelCollapsed}
            onClick={() => setPanelCollapsed((current) => !current)}
          >
            {panelCollapsed ? "Open editor panel" : "Collapse panel"}
          </button>
          <div className="panel-content">
            <nav className="mode-tabs" aria-label="Editor tools">
              {(Object.keys(toolLabels) as Tool[]).map((item) => (
                <button
                  key={item}
                  className={tool === item ? "active" : ""}
                  aria-current={tool === item ? "page" : undefined}
                  onClick={() => selectTool(item)}
                >
                  {toolLabels[item]}
                </button>
              ))}
            </nav>
            {notice && (
              <p className="state-message" role="status">
                {notice}
              </p>
            )}

            {tool === "route" && (
              <section className="editor-section">
                <div className="panel-heading">
                  <div>
                    <p className="panel-eyebrow">Campus paths</p>
                    <h1>Route status</h1>
                  </div>
                </div>
                <p className="panel-copy">
                  Select a path on the map to update its public note or routing
                  status.
                </p>
                {routeDetails ? (
                  <div className="selection-card">
                    <div className="selection-card-heading">
                      <div>
                        <p className="panel-eyebrow">Selected path</p>
                        <h2>
                          {routeDetails.classification === "main"
                            ? "Main campus route"
                            : "Campus shortcut"}
                        </h2>
                      </div>
                      <span
                        className={`status-badge ${blocked ? "blocked" : "available"}`}
                      >
                        {blocked ? "Blocked" : "Available"}
                      </span>
                    </div>
                    <label className="field">
                      <span>Public note</span>
                      <textarea
                        rows={3}
                        maxLength={500}
                        value={routeNote}
                        onChange={(event) => setRouteNote(event.target.value)}
                      />
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={blocked}
                        onChange={(event) => setBlocked(event.target.checked)}
                      />{" "}
                      Block this route
                    </label>
                    {blocked && (
                      <label className="field">
                        <span>Reason for closure</span>
                        <input
                          maxLength={300}
                          required
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        />
                      </label>
                    )}
                    <div className="action-row">
                      <button
                        className="button primary"
                        disabled={blocked && !reason.trim()}
                        onClick={() => void saveRoute()}
                      >
                        {blocked ? "Save block" : "Good for Routing"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="state-message">
                    Select a visible campus route segment.
                  </p>
                )}
              </section>
            )}

            {tool === "floor" && (
              <section className="editor-section floor-design-section">
                <div className="panel-heading">
                  <div>
                    <p className="panel-eyebrow">Interior maps</p>
                    <h1>Interior floor design</h1>
                  </div>
                </div>
                <form
                  className="building-picker"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (searchBuilding) void loadFloor(searchBuilding.id);
                  }}
                >
                  <label className="field">
                    <span>Choose building</span>
                    <input
                      list="editor-buildings"
                      value={buildingSearch}
                      placeholder="Search campus buildings"
                      onChange={(event) =>
                        setBuildingSearch(event.target.value)
                      }
                    />
                  </label>
                  <datalist id="editor-buildings">
                    {data.buildings.map((building) => (
                      <option key={building.id} value={building.name} />
                    ))}
                  </datalist>
                  <button
                    className="button secondary"
                    disabled={
                      !searchBuilding || searchBuilding.id === buildingId
                    }
                  >
                    Select
                  </button>
                </form>
                {!selectedBuilding ? (
                  <p className="state-message">
                    Select a building on the map or search for one.
                  </p>
                ) : (
                  <>
                    <div className="selection-card building-selection">
                      <p className="panel-eyebrow">Selected building</p>
                      <h2>{selectedBuilding.name}</h2>
                    </div>
                    <div className="floor-tabs-row">
                      <div
                        className="floor-tabs"
                        role="tablist"
                        aria-label={`${selectedBuilding.name} floors`}
                      >
                        {displayedFloors.map((number) => (
                          <button
                            key={number}
                            type="button"
                            role="tab"
                            aria-selected={floorNumber === number}
                            className={`floor-tab${floorNumber === number ? " active" : ""}`}
                            onClick={() =>
                              void loadFloor(selectedBuilding.id, number)
                            }
                          >
                            {floorLabel(number)}
                            {!floorNumbers.includes(number) && (
                              <span className="draft-label">Draft</span>
                            )}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="add-floor-button"
                          aria-expanded={addingFloor}
                          onClick={() => {
                            setAddingFloor((current) => !current);
                            setNewFloorError("");
                          }}
                        >
                          + Add floor
                        </button>
                      </div>
                    </div>
                    {addingFloor && (
                      <form className="add-floor-form" onSubmit={addFloor}>
                        <label className="field">
                          <span>Floor number</span>
                          <input
                            type="number"
                            min={-10}
                            max={200}
                            step={1}
                            autoFocus
                            value={newFloorNumber}
                            onChange={(event) =>
                              setNewFloorNumber(event.target.value)
                            }
                          />
                        </label>
                        {newFloorError && (
                          <p className="state-message error" role="alert">
                            {newFloorError}
                          </p>
                        )}
                        <div className="action-row">
                          <button className="button primary">Add</button>
                          <button
                            type="button"
                            className="button ghost"
                            onClick={() => {
                              setAddingFloor(false);
                              setNewFloorNumber("");
                              setNewFloorError("");
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                    {floorLoading ? (
                      <p className="state-message">
                        Loading{" "}
                        {floorNumber === null
                          ? "floors"
                          : floorLabel(floorNumber)}
                        …
                      </p>
                    ) : floorNumber === null ? (
                      <p className="state-message">
                        No saved floors yet. Choose Add floor to begin.
                      </p>
                    ) : (
                      <>
                        <div className="floor-save-bar">
                          <div>
                            <strong>{floorLabel(floorNumber)}</strong>
                            <p
                              className={`state-message floor-save-status ${floorSaveState}`}
                              role="status"
                            >
                              {floorSaveMessage ||
                                (floorDirty ? "Unsaved changes" : "Saved")}
                            </p>
                          </div>
                          <button
                            className="button primary"
                            disabled={
                              !floorDirty || floorSaveState === "saving"
                            }
                            onClick={() => void saveFloor()}
                          >
                            {floorSaveState === "saving"
                              ? "Saving…"
                              : "Save floor"}
                          </button>
                        </div>
                        <FloorDesigner
                          value={layout}
                          onChange={(value) => {
                            setLayout(value);
                            setFloorDirty(true);
                            setFloorSaveState("unsaved");
                            setFloorSaveMessage("Unsaved changes");
                          }}
                        />
                      </>
                    )}
                  </>
                )}
              </section>
            )}

            {tool === "point" && (
              <section className="editor-section">
                <div className="panel-heading">
                  <div>
                    <p className="panel-eyebrow">Public map</p>
                    <h1>{pointId ? "Edit point" : "Add point"}</h1>
                  </div>
                </div>
                <p
                  className={`state-message ${pointLocation ? "success" : ""}`}
                >
                  {pointLocation
                    ? "Location selected on the map."
                    : "Tap the map to select a location."}
                </p>
                <label className="field">
                  <span>Name</span>
                  <input
                    maxLength={100}
                    value={pointName}
                    onChange={(event) => setPointName(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Public note</span>
                  <textarea
                    rows={4}
                    maxLength={500}
                    value={pointNote}
                    onChange={(event) => setPointNote(event.target.value)}
                  />
                </label>
                <div className="action-row">
                  <button
                    className="button primary"
                    disabled={!pointLocation || !pointName.trim()}
                    onClick={() => void savePoint()}
                  >
                    Save point
                  </button>
                  {pointId && (
                    <button
                      className="button danger"
                      onClick={() => void removePoint()}
                    >
                      Remove point
                    </button>
                  )}
                </div>
              </section>
            )}

            {tool === "inbox" && (
              <section className="editor-section notifications-section">
                <div className="panel-heading">
                  <div>
                    <p className="panel-eyebrow">Visitor notes</p>
                    <h1>Notifications</h1>
                  </div>
                </div>
                <div
                  className="notification-filters"
                  role="tablist"
                  aria-label="Notification status"
                >
                  {(Object.keys(messageLabels) as MessageFilter[]).map(
                    (status) => (
                      <button
                        key={status}
                        role="tab"
                        aria-selected={messageFilter === status}
                        className={`filter-tab${messageFilter === status ? " active" : ""}`}
                        onClick={() => setMessageFilter(status)}
                      >
                        {messageLabels[status]}{" "}
                        <span>{messageCounts[status]}</span>
                      </button>
                    ),
                  )}
                </div>
                <div className="message-list">
                  {filteredMessages.length ? (
                    filteredMessages.map((message) => (
                      <button
                        key={message.id}
                        className={`message-row${activeMessage?.id === message.id ? " active" : ""}`}
                        onClick={() => void openMessage(message)}
                      >
                        <span>{message.originalText}</span>
                        <time dateTime={message.createdAt}>
                          {new Date(message.createdAt).toLocaleString()}
                        </time>
                      </button>
                    ))
                  ) : (
                    <p className="state-message">
                      No {messageLabels[messageFilter].toLowerCase()}{" "}
                      notifications.
                    </p>
                  )}
                </div>
                {activeMessage && (
                  <article className="selection-card message-detail">
                    <div className="selection-card-heading">
                      <div>
                        <p className="panel-eyebrow">Original visitor note</p>
                        <h2>Message details</h2>
                      </div>
                      <span className={`status-badge ${activeMessage.status}`}>
                        {messageLabels[activeMessage.status]}
                      </span>
                    </div>
                    <p>{activeMessage.originalText}</p>
                    {activeMessage.editorAnnotation && (
                      <div className="annotation">
                        <strong>Editor annotation</strong>
                        <p>{activeMessage.editorAnnotation}</p>
                      </div>
                    )}
                    {activeMessage.hasEvidence && !evidenceUrl && (
                      <p className="state-message">Loading evidence…</p>
                    )}
                    {evidenceUrl && (
                      <img
                        className="evidence"
                        src={evidenceUrl}
                        alt="Evidence supplied with this visitor note"
                      />
                    )}
                    <div className="action-row message-actions">
                      <button
                        className="button secondary"
                        disabled={activeMessage.status === "saved"}
                        onClick={() =>
                          void patchMessage(activeMessage.id, {
                            status: "saved",
                          })
                        }
                      >
                        Keep
                      </button>
                      <button
                        className="button primary"
                        disabled={activeMessage.status === "addressed"}
                        onClick={() =>
                          void patchMessage(activeMessage.id, {
                            status: "addressed",
                          })
                        }
                      >
                        Address
                      </button>
                      <button
                        className="button ghost"
                        onClick={() => {
                          const value = window.prompt(
                            "Editor annotation",
                            activeMessage.editorAnnotation ?? "",
                          );
                          if (value !== null)
                            void patchMessage(activeMessage.id, {
                              editorAnnotation: value,
                            });
                        }}
                      >
                        Edit annotation
                      </button>
                      <button
                        className="button danger"
                        onClick={() => void deleteMessage(activeMessage.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                )}
              </section>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
