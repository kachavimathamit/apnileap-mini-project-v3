/**
 * Thin API client. The session lives in an httpOnly cookie, so nothing
 * security-relevant is stored in the browser and there is no token to leak
 * through localStorage.
 */

export class ApiError extends Error {
  code: string;
  status: number;
  details?: { field: string; message: string }[];

  constructor(status: number, code: string, message: string, details?: { field: string; message: string }[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const error = typeof payload === 'object' && payload !== null ? (payload as any).error : null;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'The request could not be completed.',
      error?.details,
    );
  }

  return payload as T;
}

async function readErrorFrom(response: Response): Promise<never> {
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  const error = typeof payload === 'object' && payload !== null ? (payload as any).error : null;
  throw new ApiError(
    response.status,
    error?.code ?? 'UNKNOWN',
    error?.message ?? 'The download could not be completed.',
    error?.details,
  );
}

/**
 * Downloads a file from the API and saves it via the browser's normal download
 * flow. Fetched with JS (rather than a plain `<a href>` navigation) so an
 * auth/permission failure surfaces as a catchable ApiError the caller can show
 * inline, instead of the browser silently navigating to a raw JSON error page.
 */
export async function downloadFile(url: string, filename: string): Promise<void> {
  const response = await fetch(`/api${url}`, { credentials: 'same-origin' });
  if (!response.ok) await readErrorFrom(response);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export const api = {
  get: <T,>(url: string) => request<T>('GET', url),
  post: <T,>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T,>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T,>(url: string) => request<T>('DELETE', url),
};

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export type RagStatus = 'GREEN' | 'YELLOW' | 'RED';

export interface Session {
  user: { id: string; email: string; fullName: string; designation: string | null; mustChangePassword: boolean };
  access: {
    isPlatformAdmin: boolean;
    roles: string[];
    roleLabels: string[];
    permissions: string[];
    scopeDescription: string;
    instituteCount: number;
    grants: {
      role: string;
      roleLabel: string;
      scopeType: string;
      instituteName: string | null;
      departmentName: string | null;
      projectTitle: string | null;
    }[];
  };
  system: {
    lastDataRefresh: string | null;
    staleProjectDays: number;
    sessionIdleMinutes: number;
    ragDefinitions: Record<RagStatus, { label: string; criteria: string; response: string }>;
  };
  notifications: { unread: number };
  pendingReviews: { count: number };
}

export interface InstituteSummary {
  id: string;
  code: string;
  name: string;
  short_name: string;
  city: string | null;
  department_count: number;
  project_count: number;
  red_count: number;
}

export interface RagCounts {
  counts: Record<RagStatus, number>;
  total: number;
  percentages: Record<RagStatus, number>;
}

export interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  institute_id: string;
  head_name: string | null;
  coordinator_name: string | null;
  project_count: number;
  green_count: number;
  yellow_count: number;
  red_count: number;
}

export interface ProjectRow {
  id: string;
  code: string;
  title: string;
  rag_status: RagStatus;
  rag_status_since: string;
  completion_percentage: number;
  last_update_at: string;
  last_review_at: string | null;
  next_review_date: string | null;
  department_name: string;
  institute_short_name: string;
  mentor_name: string | null;
  open_issues: number;
  overdue_actions: number;
  is_stale: number;
  academic_year: string;
  semester: string;
  is_archived: number;
}

export interface InstituteDashboard extends RagCounts {
  institute: { id: string; code: string; name: string; shortName: string; city: string | null } | null;
  departmentCount: number;
  attention: {
    awaitingReview: number;
    overdueActions: number;
    staleProjects: number;
    assistanceRequests: number;
    staleThresholdDays: number;
  };
  upcomingMilestones: {
    id: string; title: string; planned_date: string; is_critical: number;
    project_id: string; project_code: string; project_title: string;
  }[];
  departments: DepartmentRow[];
  trend: { date: string; GREEN: number; YELLOW: number; RED: number }[];
  /** Capabilities the signed-in user holds at this institute. */
  permissions: string[];
}

export interface FilterOptions {
  mentors: { id: string; name: string }[];
  semesters: string[];
  academicYears: string[];
}

export interface DepartmentDashboard extends RagCounts {
  department: {
    id: string; code: string; name: string;
    headName: string | null; coordinatorName: string | null;
    instituteId: string; instituteShortName: string; instituteName: string;
  };
  projects: ProjectRow[];
  filterOptions: FilterOptions;
  /** Capabilities the signed-in user holds at this department's institute. */
  permissions: string[];
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  root_cause: string | null;
  impact: string | null;
  assistance_required: string | null;
  support_source: string | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'VERIFIED' | 'CLOSED';
  escalation_level: string;
  evidence: string | null;
  raised_by_name: string | null;
  opened_at: string;
}

export interface CorrectiveAction {
  id: string;
  issue_id: string | null;
  description: string;
  owner_display_name: string | null;
  escalation_owner_name: string | null;
  due_date: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED' | 'CANCELLED';
  evidence: string | null;
  is_overdue: number;
}

export interface ProjectDetail {
  // The detail endpoint computes staleness as a boolean; list endpoints return
  // SQLite's 0/1, so that one field is redeclared rather than intersected.
  project: Omit<ProjectRow, 'is_stale'> & {
    institute_id: string;
    department_id: string;
    institute_name: string;
    department_name: string;
    need_statement: string | null;
    problem_statement: string | null;
    objective: string | null;
    learning_outcomes: string | null;
    foundation_courses: string | null;
    functional_blocks: string | null;
    interfaces: string | null;
    dependencies: string | null;
    expected_deliverables: string | null;
    start_date: string | null;
    expected_completion_date: string | null;
    is_stale: boolean;
    definition_frozen: number;
    frozen_by_name: string | null;
    frozen_at: string | null;
    theme_id: string | null;
    theme_title: string | null;
    theme_code: string | null;
  };
  members: {
    id: string; member_role: string; name: string | null; team_identifier: string | null; email: string | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED'; approved_by_name: string | null; approved_at: string | null;
  }[];
  milestones: {
    id: string; sequence: number; title: string; description: string | null;
    planned_date: string | null; actual_date: string | null;
    status: 'UPCOMING' | 'CURRENT' | 'COMPLETED' | 'MISSED'; is_critical: number;
  }[];
  kpis: {
    id: string; name: string; definition: string | null; target_value: string; unit: string | null;
    accountable_name: string | null; latest_value: string | null; latest_date: string | null;
    latest_evidence: string | null; meets_target: number | null;
  }[];
  issues: Issue[];
  actions: CorrectiveAction[];
  reviews: {
    id: string; reviewer_name: string; review_date: string; previous_status: string | null;
    recommended_status: string | null; decision: string; comments: string;
    corrective_action_summary: string | null; next_review_date: string | null;
  }[];
  history: {
    id: string; previous_status: string | null; new_status: RagStatus; changed_by_name: string;
    changed_at: string; rationale: string; evidence: string | null; approved_by_name: string | null;
  }[];
  repositories: { id: string; provider: string; label: string; repo_url: string; visibility: string }[];
  attachments: { id: string; kind: string; label: string; external_url: string | null; storage_key: string | null }[];
  permissions: string[];
  roles: string[];
  blockers: { criticalIssues: number; overdueActions: number };
}

export interface WeeklyReport {
  generatedAt: string;
  periodDays: number;
  scopeDescription: string;
  instituteCount: number;
  totals: { green: number; yellow: number; red: number; total: number };
  instituteSummary: { id: string; short_name: string; name: string; green: number; yellow: number; red: number; total: number }[];
  newRed: { id: string; code: string; title: string; institute: string; department: string; rag_status_since: string; rationale: string | null }[];
  longStandingRed: { id: string; code: string; title: string; institute: string; days_red: number }[];
  recovering: { id: string; title: string; institute: string; previous_status: string; new_status: string; changed_by_name: string }[];
  overdueActions: { id: string; description: string; owner: string | null; days_overdue: number; project_title: string; institute: string }[];
  staleProjects: { id: string; title: string; institute: string; days_since_update: number }[];
  upcomingReviews: { id: string; title: string; institute: string; next_review_date: string }[];
  upcomingMilestones: { title: string; planned_date: string; project_code: string; project_title: string; institute: string; is_critical: number }[];
  assistanceRequests: { id: string; title: string; assistance_required: string; project_id: string; project_title: string; institute: string; support_source: string | null }[];
}
