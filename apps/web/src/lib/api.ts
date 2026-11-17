export const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";

// ---------------------------------------------------------------------------
// Resume types (mirrors the FastAPI response schemas)
// ---------------------------------------------------------------------------

export type ApiProfile = {
  id: number;
  name: string;
  headline: string;
  introduction: string;
  about: string;
  location: string | null;
  avatar_url: string | null;
  avatar_updated_at: string | null;
  avatar_content_type: string | null;
  banner_url: string | null;
  banner_updated_at: string | null;
  banner_content_type: string | null;
};

export type ApiSkillItem = { id: number; item: string; display_order: number };
export type ApiSkillGroup = {
  id: number;
  label: string;
  display_order: number;
  items: ApiSkillItem[];
};

export type ApiHighlight = { id: number; text: string; display_order: number };
export type ApiExperience = {
  id: number;
  slug: string;
  role: string;
  organization: string;
  started: string;
  ended: string | null;
  current: boolean;
  description: string;
  display_order: number;
  highlights: ApiHighlight[];
};

export type ApiEducation = {
  id: number;
  slug: string;
  qualification: string;
  institution: string;
  started: string | null;
  ended: string | null;
  display_order: number;
};

export type ApiContactLink = {
  id: number;
  label: string;
  url: string;
  display_order: number;
};
export type ApiContact = {
  id: number;
  phone: string | null;
  email: string | null;
  links: ApiContactLink[];
};

export type ApiResume = {
  profile: ApiProfile | null;
  skills: ApiSkillGroup[];
  experience: ApiExperience[];
  education: ApiEducation[];
  contact: ApiContact | null;
};

// Render's free tier spins the API service down after ~15 idle minutes and a
// cold start takes 20-60 s, while reads that block a page render need to stay
// fast when the API is healthy. fetchWakingApi models that asymmetry: the
// first attempt uses the caller's short timeout, and if the API looks asleep
// (network failure or a gateway 5xx), it pauses briefly and retries once with
// a cold-start-length timeout so the caller waits through the wake-up instead
// of showing the "temporarily unavailable" fallback. 404s and other client
// errors are definitive answers and are returned without a retry.
export const COLD_START_RETRY_DELAY_MS = 3000;
export const COLD_START_WAKE_TIMEOUT_MS = 60000;

function wakeRetryInit(init: RequestInit): RequestInit {
  return {
    ...init,
    signal: AbortSignal.timeout(COLD_START_WAKE_TIMEOUT_MS),
  };
}

async function wakeRetry(url: string, init: RequestInit): Promise<Response> {
  await new Promise((resolve) =>
    setTimeout(resolve, COLD_START_RETRY_DELAY_MS)
  );
  return fetch(url, wakeRetryInit(init));
}

export async function fetchWakingApi(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return wakeRetry(url, init);
  }
  if (response.status >= 500) return wakeRetry(url, init);
  return response;
}

const RESUME_TIMEOUT_MS = 5000;

export async function fetchResume(token?: string): Promise<ApiResume | null> {
  let controller: AbortController | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    controller = new AbortController();
    timeout = setTimeout(() => controller?.abort(), RESUME_TIMEOUT_MS);
    const response = await fetch(
      `${API_BASE_URL}/api/v1/${token ? "" : "public/"}resume`,
      {
        signal: controller.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      }
    );
    if (!response.ok) return null;
    return (await response.json()) as ApiResume;
  } catch {
    return null;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
    controller = null;
  }
}

export type HealthStatus = { status: string } | null;

export type Project = {
  id: number;
  slug: string;
  title: string;
  summary: string;
  technologies: string[];
  highlights?: string[];
  repository_url: string | null;
  demo_url: string | null;
  display_order: number;
  is_sample: boolean;
  screenshot_url?: string | null;
  screenshot_updated_at?: string | null;
};

export type ProjectsResponse = {
  items: Project[];
};

const HEALTH_TIMEOUT_MS = 5000;
const PROJECTS_TIMEOUT_MS = 5000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isProject(value: unknown): value is Project {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === "number" &&
    isString(value.slug) &&
    isString(value.title) &&
    isString(value.summary) &&
    Array.isArray(value.technologies) &&
    value.technologies.every(isString) &&
    (value.highlights === undefined ||
      (Array.isArray(value.highlights) && value.highlights.every(isString))) &&
    (value.repository_url === null || isString(value.repository_url)) &&
    (value.demo_url === null || isString(value.demo_url)) &&
    (value.screenshot_url === undefined ||
      value.screenshot_url === null ||
      isString(value.screenshot_url)) &&
    (value.screenshot_updated_at === undefined ||
      value.screenshot_updated_at === null ||
      isString(value.screenshot_updated_at)) &&
    typeof value.display_order === "number" &&
    typeof value.is_sample === "boolean"
  );
}

export function isProjectsResponse(value: unknown): value is ProjectsResponse {
  return (
    isPlainObject(value) &&
    Array.isArray(value.items) &&
    value.items.every(isProject)
  );
}

export async function fetchHealth(): Promise<HealthStatus> {
  let controller: AbortController | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    controller = new AbortController();
    timeout = setTimeout(() => controller?.abort(), HEALTH_TIMEOUT_MS);
    const response = await fetch(`${API_BASE_URL}/api/v1/health`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as { status: string };
  } catch {
    return null;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
    controller = null;
  }
}

/**
 * Fetches projects without throwing, so a page can render partial content
 * when the API is unavailable instead of failing the whole route.
 */
export async function fetchProjectsSafe(): Promise<Project[]> {
  try {
    const response = await fetchProjects();
    return response.items;
  } catch {
    return [];
  }
}

export async function fetchProjects(token?: string): Promise<ProjectsResponse> {
  // No per-attempt timer to clear: fetchWakingApi owns its AbortSignals.
  const response = await fetchWakingApi(
    `${API_BASE_URL}/api/v1/${token ? "" : "public/"}projects`,
    {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-store",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
    PROJECTS_TIMEOUT_MS
  );
  if (!response.ok) {
    throw new Error(
      `Upstream projects request failed with HTTP ${response.status}`
    );
  }
  const data = await response.json();
  if (!isProjectsResponse(data)) {
    throw new Error("Invalid projects response payload");
  }
  return data;
}
