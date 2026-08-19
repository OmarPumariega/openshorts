// Lightweight multi-job tracking so starting a new video doesn't lose track
// of one still processing. Backend already runs up to MAX_CONCURRENT_JOBS at
// once (plus queues the rest) - this is purely the frontend's memory of
// "what jobs exist and what's their status", so the user can switch between
// them instead of only ever seeing the one they happen to be looking at.
//
// Persisted per-browser in localStorage, not the server: this is a private
// single-user instance with no login, so "my jobs" just means "jobs this
// browser has started" - good enough, and avoids needing any new backend
// storage beyond what /api/status already tracks per job_id.
const STORAGE_KEY = 'openshorts_job_list';
const MAX_TRACKED = 20; // oldest dropped past this, not deleted server-side

export function loadJobList() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

export function saveJobList(list) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_TRACKED)));
    } catch {
        // localStorage full/unavailable - the list just won't persist across reloads.
    }
}

// Title for the job switcher: prefer a real filename/URL host, fall back to
// a short id so there's always something to show.
export function titleFor(jobId, data) {
    if (data?.type === 'file' && data.payload?.name) {
        return data.payload.name.replace(/\.[^./]+$/, '').slice(0, 40);
    }
    if (data?.type === 'url' && data.payload) {
        try {
            return new URL(data.payload).hostname.replace(/^www\./, '') + ' video';
        } catch {
            return data.payload.slice(0, 40);
        }
    }
    return `Job ${jobId.slice(0, 8)}`;
}
