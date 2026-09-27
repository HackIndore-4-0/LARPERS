import type {
  FloorLayout,
  FloorSummary,
  MapPayload,
  RouteDetails,
  RouteRequest,
  RouteResponse,
  SavedFloor,
  VisitorMessage,
} from "@campus-access/shared";

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:3001";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new ApiClientError(
      response.status,
      body?.error?.message ?? "The request could not be completed.",
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const json = (body: unknown, token?: string): RequestInit => ({
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(body),
});

export const api = {
  map: () => request<MapPayload>("/api/map"),
  routeDetails: (id: string) =>
    request<RouteDetails>(`/api/routes/${encodeURIComponent(id)}`),
  route: (value: RouteRequest) =>
    request<RouteResponse>("/api/routing/route", {
      method: "POST",
      ...json(value),
    }),
  revision: () => request<{ revision: number }>("/api/routing/revision"),
  floors: (buildingId: string) =>
    request<FloorSummary[]>(
      `/api/buildings/${encodeURIComponent(buildingId)}/floors`,
    ),
  floor: (buildingId: string, floor: number) =>
    request<SavedFloor>(
      `/api/buildings/${encodeURIComponent(buildingId)}/floors/${floor}`,
    ),
  sendMessage: (form: FormData) =>
    request<{ received: true }>("/api/visitor-messages", {
      method: "POST",
      body: form,
    }),
  login: (email: string, password: string) =>
    request<{ token: string }>("/api/editor/login", {
      method: "POST",
      ...json({ email, password }),
    }),
  saveRoute: (token: string, id: string, body: unknown) =>
    request<{ saved: true }>(`/api/editor/routes/${encodeURIComponent(id)}`, {
      method: "PUT",
      ...json(body, token),
    }),
  saveFloor: (
    token: string,
    buildingId: string,
    floor: number,
    layout: FloorLayout,
  ) =>
    request<{ saved: true }>(
      `/api/editor/buildings/${encodeURIComponent(buildingId)}/floors/${floor}`,
      { method: "PUT", ...json(layout, token) },
    ),
  addPoint: (token: string, body: unknown) =>
    request<{ id: string }>("/api/editor/points", {
      method: "POST",
      ...json(body, token),
    }),
  updatePoint: (token: string, id: string, body: unknown) =>
    request<void>(`/api/editor/points/${encodeURIComponent(id)}`, {
      method: "PATCH",
      ...json(body, token),
    }),
  deletePoint: (token: string, id: string) =>
    request<void>(`/api/editor/points/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }),
  messages: (token: string) =>
    request<VisitorMessage[]>("/api/editor/messages", {
      headers: { Authorization: `Bearer ${token}` },
    }),
  patchMessage: (token: string, id: string, body: unknown) =>
    request<VisitorMessage>(`/api/editor/messages/${id}`, {
      method: "PATCH",
      ...json(body, token),
    }),
  deleteMessage: (token: string, id: string) =>
    request<void>(`/api/editor/messages/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }),
  evidence: (token: string, id: string) =>
    request<{ url: string }>(`/api/editor/messages/${id}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
};
