const FALLBACK_API_URL = "http://193.168.173.181:8081/api";
const API_URL = (process.env.NEXT_PUBLIC_API_URL || FALLBACK_API_URL).replace(/\/+$/, "");

export const TOKEN_KEY = "sante_web_token";
export const USER_KEY = "sante_web_user";

export class ApiError extends Error {
  status: number;
  data: unknown;
  path: string;

  constructor(message: string, status: number, data: unknown, path: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
    this.path = path;
  }
}

function clearSessionAndRedirect() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

type ApiFetchOptions = {
  token?: string | null;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
};

export async function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { token, method = "GET", body } = options;
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError("Impossible de joindre l'API. Verifiez Internet et l'adresse du backend.", 0, null, path);
  }

  const isJsonResponse = String(response.headers.get("content-type") || "").includes("application/json");
  const data = isJsonResponse ? await response.json().catch(() => ({})) : {};

  if (!response.ok) {
    let message: string | undefined = (data as { message?: string })?.message;
    if (!message) {
      if (response.status === 404) {
        message = `Endpoint introuvable (${method.toUpperCase()} ${path}). Verifiez le deploiement du backend.`;
      } else if (response.status === 403) {
        message = "Acces refuse pour cette action.";
      } else if (response.status === 401) {
        message = "Session expiree. Reconnectez-vous.";
        clearSessionAndRedirect();
      } else if (response.status >= 500) {
        message = "Erreur serveur. Reessayez dans quelques instants.";
      } else {
        message = `Erreur API (${response.status})`;
      }
    }
    throw new ApiError(message, response.status, data, path);
  }

  return data as T;
}
