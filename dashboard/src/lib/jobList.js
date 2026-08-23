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

// Which jobs have already had the default subtitle style auto-applied.
// MUST be persisted, not just an in-memory ref/Set: a bare ref resets on
// every page reload, so a completed job with a saved default style would
// get re-styled from scratch (all N clips, one POST /api/subtitle each)
// every time the page reloaded — burning duplicate "subtitled_<ts>_..."
// files on disk and, worse, racing a fresh in-progress run against
// whatever the previous reload's loop hadn't finished yet, so a job could
// end up with its early clips re-styled a dozen times and its later ones
// never reached at all. Bounded to the same size as the job list itself.
const STYLED_KEY = 'openshorts_auto_styled_jobs';

export function loadAutoStyledJobs() {
    try {
        const raw = localStorage.getItem(STYLED_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr : []);
    } catch {
        return new Set();
    }
}

export function markJobAutoStyled(id) {
    try {
        const set = loadAutoStyledJobs();
        set.add(id);
        localStorage.setItem(STYLED_KEY, JSON.stringify([...set].slice(-MAX_TRACKED)));
    } catch {
        // localStorage full/unavailable - worst case this job re-styles on
        // the next reload, same as before this fix existed.
    }
}

// Which individual (job, format, clip) combinations the "apply my saved
// default style" pass has already burned — the ONLY reliable signal for
// that, because every clip already carries a "subtitled_" file the moment
// it's generated (main.py auto-captions every clip unconditionally, with
// its own fixed style, before the frontend ever sees it). Sniffing the
// video_url for a "subtitled_" prefix to decide "does this still need my
// default style?" was always true, so the default-style auto-apply pass
// silently no-op'd on every fresh clip — this per-clip ledger replaces
// that filename heuristic. Same bounded/persisted shape as the job-level
// ledger above, just keyed by "jobId:format:clipIndex" instead of jobId.
const STYLED_CLIPS_KEY = 'openshorts_auto_styled_clips';
const MAX_TRACKED_CLIPS = MAX_TRACKED * 60; // ~20 clips x 3 formats, generous headroom

export function loadAutoStyledClips() {
    try {
        const raw = localStorage.getItem(STYLED_CLIPS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr : []);
    } catch {
        return new Set();
    }
}

export function markClipAutoStyled(key) {
    try {
        const set = loadAutoStyledClips();
        set.add(key);
        localStorage.setItem(STYLED_CLIPS_KEY, JSON.stringify([...set].slice(-MAX_TRACKED_CLIPS)));
    } catch {
        // localStorage full/unavailable - worst case this clip re-styles once more.
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
