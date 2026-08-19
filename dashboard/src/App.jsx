import React, { useState, useEffect, useRef } from 'react';
import { Youtube, Instagram, ChevronDown, Check, Activity, LayoutDashboard, Settings, Plus, History, X, Terminal, Shield, RotateCcw, AlertTriangle, KeyRound, Loader2, Download, Type, Film } from 'lucide-react';
import MediaInput from './components/MediaInput';
import ResultCard from './components/ResultCard';
import ProcessingAnimation from './components/ProcessingAnimation';
import ClipEditor from './components/ClipEditor';
import ReframeEditor from './components/ReframeEditor';
import UsageMeter from './components/UsageMeter';
import TopUpModal from './components/TopUpModal';
import StarBanner from './components/StarBanner';
import PlanChoiceModal from './components/PlanChoiceModal';
import TrialUpgradeModal from './components/TrialUpgradeModal';
import LoginModal from './components/LoginModal';
import TrialGate from './components/TrialGate';
import AdvancedBanner from './components/AdvancedBanner';
import HistoryTab from './components/HistoryTab';
import ProfileMenu from './components/ProfileMenu';
import Modal from './components/ui/Modal';
import { useAuth } from './contexts/AuthContext';
import { apiFetch, apiJson, QuotaError } from './lib/api';
import { loadDefaultStyle, saveDefaultStyle, clearDefaultStyle } from './lib/subtitleStyle';
import DefaultStyleEditor from './components/DefaultStyleEditor';
import { loadJobList, saveJobList, titleFor, loadAutoStyledJobs, markJobAutoStyled } from './lib/jobList';
import JobSwitcher from './components/JobSwitcher';

// Simple TikTok icon sine Lucide might not have it or it varies
const TikTokIcon = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-5.201 1.743l-.002-.001.002.001a2.895 2.895 0 0 1 3.183-4.51v-3.5a6.329 6.329 0 0 0-5.394 10.692 6.33 6.33 0 0 0 10.857-4.424V8.687a8.182 8.182 0 0 0 4.773 1.526V6.79a4.831 4.831 0 0 1-1.003-.104z" />
  </svg>
);

const SESSION_KEY = 'openshorts_session';
const SESSION_MAX_AGE = 3600000; // 1 hour (matches server job retention)

// Mock polling function
const pollJob = async (jobId) => {
  const res = await apiFetch(`/api/status/${jobId}`);
  if (!res.ok) throw new Error('Status check failed');
  return res.json();
};

function App() {
  // Cloud auth/billing session (inert when billing is disabled).
  const { billingEnabled, isManaged, isSignedIn, me, plan, refreshMe, geminiConfigured, llmProvider } = useAuth();
  const envVarName = llmProvider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'GEMINI_API_KEY';
  const [showLogin, setShowLogin] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [showPlanChoice, setShowPlanChoice] = useState(false);
  const [showTrialUpgrade, setShowTrialUpgrade] = useState(false);
  const [topUpInfo, setTopUpInfo] = useState({});
  // Durable R2 URLs (per clip index) for the current job — used as a fallback when
  // the ephemeral local /videos/ files have been cleaned up (e.g. after a reload).
  const [durableClips, setDurableClips] = useState({});
  const [showKeyModal, setShowKeyModal] = useState(false);
  // User's saved default subtitle style (Settings > Default subtitle style,
  // or "save as my default style" inside any clip's subtitle editor). null =
  // no profile saved, new videos keep the server's factory-default look.
  const [defaultStyle, _setDefaultStyleState] = useState(() => loadDefaultStyle());
  const setDefaultStyle = (styleOrNull) => {
    _setDefaultStyleState(styleOrNull);
    if (styleOrNull) saveDefaultStyle(styleOrNull);
    else clearDefaultStyle();
  };
  // Two-layer guard against auto-applying the default style twice (see
  // lib/jobList.js for the duplicate-subtitle-burn bug this fixes):
  //  - autoStyledJobRef (in-memory) blocks re-entry within THIS page load —
  //    the poller ticks every 2s and would otherwise fire again before the
  //    first bulk-apply loop even finishes, since results/status don't
  //    change mid-loop.
  //  - markJobAutoStyled/loadAutoStyledJobs (persisted) is only written once
  //    the loop actually finishes with zero errors. A job interrupted by a
  //    closed tab or reload is deliberately NOT marked done, so the next
  //    page load retries it — handleBulkSubtitles' skipAlreadyStyled then
  //    skips whatever clips that earlier attempt did finish, instead of
  //    re-burning them.
  const autoStyledJobRef = useRef(loadAutoStyledJobs());
  // Every video this browser has started, tracked independently of which one
  // is on screen — lets starting a new upload not lose one still processing.
  // See lib/jobList.js. jobListRef mirrors the state for the background
  // poller's setInterval closure, which would otherwise only ever see the
  // list as it was when the interval was created.
  const [jobList, setJobList] = useState(() => loadJobList());
  const jobListRef = useRef(jobList);
  useEffect(() => { jobListRef.current = jobList; }, [jobList]);
  const upsertJob = (id, patch) => {
    setJobList((prev) => {
      const idx = prev.findIndex((j) => j.jobId === id);
      const next = idx === -1
        ? [{ jobId: id, startedAt: Date.now(), status: 'processing', ...patch }, ...prev]
        : prev.map((j, i) => (i === idx ? { ...j, ...patch } : j));
      saveJobList(next);
      return next;
    });
  };
  const removeJob = (id) => {
    setJobList((prev) => {
      const next = prev.filter((j) => j.jobId !== id);
      saveJobList(next);
      return next;
    });
  };
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, processing, complete, error
  const [results, setResults] = useState(null);
  // Bulk subtitles: apply one style to every clip of the job (triggered from
  // within a clip's subtitle modal via "apply to all").
  const [bulkSub, setBulkSub] = useState({ running: false, current: 0, total: 0, errors: 0 });
  const [downloadingAll, setDownloadingAll] = useState(false);
  // Pre-flight quality gate: { info: {max_height, min_height, cookies_invalid}, data }
  const [qualityGate, setQualityGate] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsVisible, setLogsVisible] = useState(true);
  const [processingMedia, setProcessingMedia] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard'); // dashboard, settings
  // Reopened-project state (paid mode): per-clip {index, server_file, active_layers}
  // restored from the backend so ResultCards resume editing where they left off.
  const [projectState, setProjectState] = useState(null);
  // True when the current job was reopened from the library: its source video
  // was never persisted, so the session must not fall back to /api/source.
  const [noSource, setNoSource] = useState(false);

  const [sessionRecovered, setSessionRecovered] = useState(false);
  // Clip editor overlay: index of the clip being edited, or null.
  const [editingClip, setEditingClip] = useState(null);
  const [reframingClip, setReframingClip] = useState(null);

  // Sync state for original video playback
  const [syncedTime, setSyncedTime] = useState(0);
  const [isSyncedPlaying, setIsSyncedPlaying] = useState(false);
  const [syncTrigger, setSyncTrigger] = useState(0);

  const handleClipPlay = (startTime) => {
    setSyncedTime(startTime);
    setIsSyncedPlaying(true);
    setSyncTrigger(prev => prev + 1);
  };

  const handleClipPause = () => {
    setIsSyncedPlaying(false);
  };

  // --- Project persistence (paid mode) ---
  // Debounced sync of each clip's browser-only edit state (Remotion layers +
  // current server file) to the backend, so a reopened project resumes intact.
  const clipStateSync = useRef({ jobId: null, pending: {}, timer: null });

  const flushClipState = () => {
    const s = clipStateSync.current;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    const entries = Object.entries(s.pending);
    if (!s.jobId || entries.length === 0) return;
    const clips = entries.map(([i, v]) => ({
      index: Number(i),
      active_layers: v.activeLayers,
      server_file: v.serverVideoFile,
    }));
    s.pending = {};
    apiFetch(`/api/projects/${s.jobId}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clips }),
    }).catch(() => {});
  };

  const handleClipStateChange = (index, state) => {
    if (!isManaged || !jobId) return;
    const s = clipStateSync.current;
    if (s.jobId !== jobId) { s.pending = {}; s.jobId = jobId; }
    s.pending[index] = state;
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(flushClipState, 2000);
  };

  // A recut replaced the clip's server file with a fresh render (burned layers
  // reset), so update the results, the reopened-project state and the synced
  // per-clip edit state, and let the ResultCard remount from the new file.
  const handleClipRerendered = (index, data) => {
    const newFile = (data.new_video_url || '').split('/').pop();
    setResults((prev) => {
      if (!prev?.clips?.[index]) return prev;
      const clips = prev.clips.slice();
      clips[index] = {
        ...clips[index],
        video_url: data.new_video_url,
        start: data.start,
        end: data.end,
        recipe: data.recipe,
      };
      return { ...prev, clips };
    });
    setProjectState((prev) => {
      if (!prev?.clips) return prev;
      return {
        ...prev,
        clips: prev.clips.map((c) => (c.index === index
          ? { ...c, server_file: newFile, active_layers: null }
          : c)),
      };
    });
    // The old durable R2 object is deleted when the recut is archived, so the
    // stale URL would 404 as a fallback; drop it until the next refresh.
    setDurableClips((prev) => {
      if (!(index in prev)) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
    handleClipStateChange(index, { activeLayers: null, serverVideoFile: newFile });
  };

  // Reopen an archived project from the History tab: the backend re-downloads
  // its files from R2 into the server's working dir and returns the full state.
  const restoreProject = async (projectJobId) => {
    const data = await apiJson(`/api/projects/${projectJobId}/restore`, { method: 'POST' });
    flushClipState();
    setProjectState(data.project_state || null);
    setNoSource(true);
    setJobId(data.job_id);
    setResults(data.result || null);
    setLogs(['♻️ Project restored from your library.']);
    setProcessingMedia(null);
    setQualityGate(null);
    setStatus('complete');
    setActiveTab('dashboard');
  };

  // Apply one subtitle style to every clip of a job, sequentially. Defaults to
  // the focused job (the "apply this style to all clips" button inside the
  // subtitle editor), but takes an explicit id/clips so the background job
  // poller can auto-style a job that finished while it wasn't the one on
  // screen — the progress indicator only lights up when that job IS the one
  // being looked at, so background auto-styling stays invisible.
  //
  // skipAlreadyStyled makes the loop resumable: if a previous run got cut off
  // partway (tab closed mid-job — this is a real thing that happened, see
  // lib/jobList.js's markJobAutoStyled), clips whose video_url already has a
  // "subtitled_" prefix are left alone instead of re-burned, and the loop
  // only spends time on the ones that actually still need it. Only used for
  // the automatic default-style path — the manual "apply to all" button in
  // the subtitle editor always re-applies everything, since the user may be
  // deliberately switching an already-styled clip to a different look.
  const handleBulkSubtitles = async (options, targetJobId = jobId, targetClips = results?.clips, skipAlreadyStyled = false) => {
    const clips = targetClips || [];
    const total = clips.length;
    if (!total) return;
    const isFocused = targetJobId === jobId;
    if (isFocused) setBulkSub({ running: true, current: 0, total, errors: 0 });
    let errors = 0;
    for (let i = 0; i < total; i++) {
      if (isFocused) setBulkSub({ running: true, current: i + 1, total, errors });
      if (skipAlreadyStyled && /\/subtitled_/.test(clips[i].video_url || '')) continue;
      try {
        const res = await apiFetch('/api/subtitle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id: targetJobId,
            clip_index: i,
            position: options.position,
            font_size: options.fontSize,
            font_name: options.fontName,
            font_color: options.fontColor,
            border_color: options.borderColor,
            border_width: options.borderWidth,
            bg_color: options.bgColor,
            bg_opacity: options.bgOpacity,
            style: options.style || 'classic',
            highlight_color: options.highlightColor || '#FFD700',
            effect: options.effect || 'none',
            base_opacity: options.baseOpacity ?? 1.0,
            uppercase: options.uppercase || false,
            // Chain from the clip's current server file (its video_url basename).
            input_filename: (clips[i].video_url || '').split('/').pop(),
          }),
        });
        if (!res.ok) errors++;
      } catch {
        errors++;
      }
    }
    if (isFocused) setBulkSub({ running: false, current: total, total, errors });
    // Refresh results so each ResultCard picks up its new subtitled video_url.
    try {
      const data = await pollJob(targetJobId);
      if (isFocused && data.result) setResults(data.result);
    } catch { /* keep current results */ }
    return errors;
  };

  // Auto-apply the user's saved default subtitle style the moment a job's
  // clips are ready — no button, no need to open the subtitle editor per
  // clip. Fires once per job (autoStyledJobRef), and only when a profile is
  // actually saved; otherwise clips keep the server's factory-default look,
  // unchanged from before this feature existed.
  useEffect(() => {
    if (status !== 'complete' || !jobId || !defaultStyle) return;
    if (!results?.clips?.length) return;
    if (autoStyledJobRef.current.has(jobId)) return;
    autoStyledJobRef.current.add(jobId); // block re-entry this session; not yet persisted
    handleBulkSubtitles(defaultStyle, jobId, results.clips, true).then((errs) => {
      if (errs === 0) markJobAutoStyled(jobId); // fully done — persist so it never retries
      else autoStyledJobRef.current.delete(jobId); // partial/failed — eligible for retry next load
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, jobId, results, defaultStyle]);

  const handleDownloadAll = async () => {
    if (!jobId) return;
    setDownloadingAll(true);
    try {
      const res = await apiFetch(`/api/jobs/${jobId}/download-all`);
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openshorts_clips_${(jobId || '').slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Download failed: ${e.message}`);
    } finally {
      setDownloadingAll(false);
    }
  };

  // Session Recovery: Restore on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (!saved) return;
      const session = JSON.parse(saved);
      if (Date.now() - session.timestamp > SESSION_MAX_AGE) {
        localStorage.removeItem(SESSION_KEY);
        return;
      }
      if (session.jobId && session.status && session.status !== 'idle') {
        setJobId(session.jobId);
        setResults(session.results || null);
        // Restore the source preview. Older sessions (or uploads) saved no
        // media, so fall back to the backend-served source for this job —
        // except for reopened projects, whose source was never persisted.
        if (session.processingMedia) setProcessingMedia(session.processingMedia);
        else if (!session.noSource) setProcessingMedia({ type: 'server', payload: `/api/source/${session.jobId}` });
        if (session.noSource) setNoSource(true);
        if (session.projectState) setProjectState(session.projectState);
        if (session.activeTab) setActiveTab(session.activeTab);
        // If was processing, resume polling; if complete/error, just show results
        setStatus(session.status === 'processing' ? 'processing' : session.status);
        setSessionRecovered(true);
        setTimeout(() => setSessionRecovered(false), 5000);
      }
    } catch (e) {
      localStorage.removeItem(SESSION_KEY);
    }
  }, []);

  // Session Recovery: Save state changes
  useEffect(() => {
    if (status === 'idle') {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    try {
      // URL (YouTube) media serializes as-is. Uploaded 'file' media is a blob
      // that can't be persisted, so point the recovered preview at the source
      // served by the backend instead of dropping it.
      let persistMedia = null;
      if (processingMedia?.type === 'url') persistMedia = processingMedia;
      else if (processingMedia && jobId) persistMedia = { type: 'server', payload: `/api/source/${jobId}` };
      const sessionData = {
        jobId,
        status,
        results,
        processingMedia: persistMedia,
        activeTab,
        noSource,
        projectState,
        timestamp: Date.now()
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    } catch (e) {
      // localStorage full or serialization error - ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, status, results, activeTab, noSource, projectState]);

  // For managed users, fetch the durable R2 URLs of the current job's clips so the
  // preview can fall back to them when the local files have been cleaned up.
  useEffect(() => {
    if (!isManaged || !jobId || !(results?.clips?.length)) { setDurableClips({}); return; }
    let cancelled = false;
    apiJson('/api/history')
      .then((d) => {
        if (cancelled) return;
        const map = {};
        for (const v of (d.videos || [])) {
          if (v.job_id === jobId && v.clip_index != null) map[v.clip_index] = v.view_url;
        }
        setDurableClips(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isManaged, jobId, results]);

  // Unified poller: the focused job (fast path, drives the visible UI) plus
  // every OTHER tracked job still marked processing (background — started,
  // then left via "New Project" or the job switcher while it kept running).
  // Always-on rather than gated on `status`, since there can be background
  // work even when the focused view is idle. Background jobs read/write
  // through jobListRef so this effect doesn't need to restart when the list
  // changes — only jobId/status (the focused job) and defaultStyle do that.
  useEffect(() => {
    const tick = async () => {
      if (jobId && status === 'processing') {
        try {
          const data = await pollJob(jobId);
          if (data.result) setResults(data.result);
          if (data.status === 'completed') {
            setStatus('complete');
            upsertJob(jobId, { status: 'complete' });
          } else if (data.status === 'failed') {
            setStatus('error');
            const errorMsg = data.error || (data.logs?.length ? data.logs[data.logs.length - 1] : "Process failed");
            setLogs((prev) => [...prev, "Error: " + errorMsg]);
            upsertJob(jobId, { status: 'error' });
          } else if (data.logs) {
            setLogs(data.logs);
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }

      const background = jobListRef.current.filter((j) => j.status === 'processing' && j.jobId !== jobId);
      for (const j of background) {
        try {
          const data = await pollJob(j.jobId);
          if (data.status === 'completed') {
            upsertJob(j.jobId, { status: 'complete' });
            // Same auto-apply the focused job's effect does above, just for
            // a job nobody is currently looking at.
            if (defaultStyle && data.result?.clips?.length && !autoStyledJobRef.current.has(j.jobId)) {
              autoStyledJobRef.current.add(j.jobId);
              handleBulkSubtitles(defaultStyle, j.jobId, data.result.clips, true).then((errs) => {
                if (errs === 0) markJobAutoStyled(j.jobId);
                else autoStyledJobRef.current.delete(j.jobId);
              });
            }
          } else if (data.status === 'failed') {
            upsertJob(j.jobId, { status: 'error' });
          }
        } catch (e) {
          console.error("Background polling error", j.jobId, e);
        }
      }
    };

    const interval = setInterval(tick, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, jobId, defaultStyle]);


  // No BYOK in this fork: the only way this can be true is a server
  // misconfiguration (GEMINI_API_KEY missing from .env).
  const keysMissing = !geminiConfigured;
  const needsPlan = billingEnabled && !isManaged;   // hosted, signed-out or no active plan/trial

  // Fresh sign-up: show the welcome plan-choice popup once (AuthContext set the
  // flag after the auth redirect). Fires for free users too, so it's gated on
  // being signed in rather than on entitlement.
  useEffect(() => {
    if (billingEnabled && isSignedIn) {
      let flagged = false;
      try { flagged = localStorage.getItem('os_show_plan_choice') === '1'; } catch (_) { /* ignore */ }
      if (flagged) {
        setShowPlanChoice(true);
        try { localStorage.removeItem('os_show_plan_choice'); } catch (_) { /* ignore */ }
      }
    }
  }, [billingEnabled, isSignedIn]);
  // Included in the plan (fully managed, no keys): Clip Generator + YouTube Studio.
  // Advanced (bring your own fal.ai + ElevenLabs keys): AI Shorts + AI Agent.
  // AI Shorts / YouTube Studio / AI Agent tabs (and the paid-plan gating that
  // wrapped them) don't exist in this fork — only the Clip Generator does.
  const gateThisTab = false;
  const advancedThisTab = false;

  const handleProcess = async (data, forceLowQuality = false) => {
    // Hosted (never on in this fork): must be signed in AND on an active plan/trial.
    // Self-host: the only gate is the server actually having a Gemini key set.
    if (billingEnabled) {
      if (!isSignedIn) { setShowLogin(true); return; }
      if (!isManaged) { window.location.hash = '#/pricing'; return; }
    } else if (keysMissing) {
      setShowKeyModal(true);
      return;
    }
    setStatus('processing');
    setLogs(["Starting process..."]);
    setResults(null);
    setProcessingMedia(data);
    setQualityGate(null);
    setProjectState(null);
    setNoSource(false);

    try {
      let body;
      // No BYOK header: the server always resolves its own GEMINI_API_KEY.
      const headers = {};

      // Advanced generation controls: only sent when the user set them, so the
      // default request stays byte-identical to the pre-feature one.
      const advanced = {
        target_clips: data.targetClips || null,
        clip_min_seconds: data.clipMinSeconds || null,
        clip_max_seconds: data.clipMaxSeconds || null,
        // Array for the JSON (URL) path; joined to a string below for FormData
        // (form fields are always strings) — /api/process accepts both shapes.
        layouts: data.layouts || null,
      };

      if (data.type === 'url') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify({
          url: data.payload,
          acknowledged: !!data.acknowledged,
          output_format: data.outputFormat || 'auto',
          force_low_quality: forceLowQuality,
          ...Object.fromEntries(Object.entries(advanced).filter(([, v]) => v != null)),
        });
      } else {
        const formData = new FormData();
        formData.append('file', data.payload);
        formData.append('acknowledged', data.acknowledged ? 'true' : 'false');
        formData.append('output_format', data.outputFormat || 'auto');
        for (const [k, v] of Object.entries(advanced)) {
          if (v == null) continue;
          formData.append(k, Array.isArray(v) ? v.join(',') : v);
        }
        body = formData;
      }

      const res = await apiFetch('/api/process', { method: 'POST', headers, body });

      if (!res.ok) throw new Error(await res.text());
      const resData = await res.json();

      // Quality gate: the source is below the min resolution — ask before burning
      // 20 min on it. On confirm we resend with force_low_quality.
      if (resData.needs_confirmation) {
        setStatus('idle');
        setQualityGate({ info: resData.quality_check, data });
        return;
      }

      setJobId(resData.job_id);
      upsertJob(resData.job_id, { title: titleFor(resData.job_id, data), startedAt: Date.now(), status: 'processing' });

    } catch (e) {
      if (e instanceof QuotaError) {
        setStatus('idle');
        // Trial users hit the trial minute cap → prompt them to activate the plan
        // now (unlocks full minutes). Active users → offer a top-up.
        if (me?.status === 'trialing') {
          setShowTrialUpgrade(true);
        } else {
          setTopUpInfo({ required: e.minutesRequired, remaining: e.minutesRemaining });
          setShowTopUp(true);
        }
        return;
      }
      setStatus('error');
      setLogs(l => [...l, `Error starting job: ${e.message}`]);
    }
  };

  const handleReset = () => {
    // Flush any pending edit-state sync before dropping the project: the clips
    // themselves are already archived to R2 as they were edited.
    flushClipState();
    setStatus('idle');
    setJobId(null);
    setResults(null);
    setLogs([]);
    setProcessingMedia(null);
    setProjectState(null);
    setNoSource(false);
    localStorage.removeItem(SESSION_KEY);
  };

  // Switch the main view to a different tracked job (JobSwitcher) — a
  // background job the user started earlier and left running, or one that
  // already finished. Always re-fetches fresh rather than trusting the
  // switcher's cached status, since that's only updated on the 2s poll tick.
  const focusJob = async (id) => {
    if (id === jobId) return;
    flushClipState();
    setProjectState(null);
    setNoSource(false);
    setQualityGate(null);
    try {
      const data = await pollJob(id);
      setJobId(id);
      setResults(data.result || null);
      setLogs(data.logs || []);
      setStatus(data.status === 'completed' ? 'complete' : data.status === 'failed' ? 'error' : 'processing');
      // The original upload (File object or pasted URL) isn't recoverable
      // once we've navigated away from it — fall back to the source the
      // backend itself served for this job, same as session-reload recovery.
      setProcessingMedia({ type: 'server', payload: `/api/source/${id}` });
      setActiveTab('dashboard');
    } catch (e) {
      alert(`Could not load that job: ${e.message}`);
    }
  };

  // --- UI Components ---

  return (
    <div className="flex h-screen bg-paper overflow-hidden">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Header */}
        <header className="h-14 border-b border-rule bg-paper flex items-center justify-between px-6 shrink-0 z-10">
          <div className="flex items-center gap-3">
            {status !== 'idle' && (
              <button
                onClick={handleReset}
                className="btn-quiet px-3 py-1.5 text-xs"
              >
                <Plus size={14} />
                <span className="hidden sm:inline">New Project</span>
              </button>
            )}
            <JobSwitcher
              jobs={jobList}
              activeJobId={jobId}
              onFocus={focusJob}
              onDismiss={removeJob}
            />
          </div>

          <div className="flex items-center gap-4">
            {/* Cloud: minutes meter + account/sign-in. For free users the meter
                opens the upgrade modal — otherwise the only path to a plan is
                failing against the quota wall. */}
            {billingEnabled && isManaged && (
              <UsageMeter onClick={() => {
                if (plan === 'free') { setTopUpInfo({ context: 'upsell' }); setShowTopUp(true); }
                else { window.location.hash = '#/account'; }
              }} />
            )}
            {billingEnabled && isSignedIn && !isManaged && (
              <button onClick={() => setShowPlanChoice(true)}
                className="btn-primary px-4 py-2 text-xs">
                Choose a plan
              </button>
            )}
            {billingEnabled && !isSignedIn && (
              <button onClick={() => setShowLogin(true)}
                className="btn-ghost px-4 py-2 text-xs">
                Sign in
              </button>
            )}
            {billingEnabled && isSignedIn && <ProfileMenu />}

            {keysMissing && (
              <button
                onClick={() => setActiveTab('settings')}
                className="badge-warn hover:brightness-125 transition-all"
                title={`Server has no ${envVarName} configured`}
              >
                <AlertTriangle size={12} />
                <span className="hidden sm:inline">{envVarName} missing</span>
                <span className="sm:hidden">key missing</span>
              </button>
            )}
          </div>
        </header>

        {/* Persistent Missing Key Banner — visible on every screen */}
        {keysMissing && activeTab !== 'settings' && (
          <div className="mx-4 sm:mx-6 mt-3 px-4 py-3 bg-paper2 border border-rule rounded-card flex flex-wrap items-center justify-between gap-3 sm:gap-4 shrink-0 animate-fade">
            <div className="flex items-center gap-3 text-sm text-ink2">
              <KeyRound size={16} className="shrink-0 text-warn" />
              <div>
                <span className="font-medium text-ink">{envVarName} not set on the server.</span>{' '}
                <span className="text-muted">
                  Add it to the backend's .env and restart the server to use this app.
                </span>
              </div>
            </div>
            <button
              onClick={() => setActiveTab('settings')}
              className="btn-quiet px-3 py-1.5 text-xs shrink-0"
            >
              Details
            </button>
          </div>
        )}

        {/* Session Recovery Banner */}
        {sessionRecovered && (
          <div className="mx-6 mt-2 px-4 py-3 bg-paper2 border border-rule rounded-card flex items-center justify-between animate-fade shrink-0">
            <div className="flex items-center gap-2 text-sm text-ink2">
              <RotateCcw size={16} className="text-brass" />
              <span className="font-medium">Session recovered</span>
              <span className="text-muted text-xs">Your previous work has been restored.</span>
            </div>
            <button onClick={() => setSessionRecovered(false)} className="text-muted hover:text-ink transition-colors">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Included tools (Clip Generator, YouTube Studio): non-blocking trial prompt. */}
        {gateThisTab && <TrialGate toolName={TOOL_NAMES[activeTab] || 'this'} />}

        {/* Advanced tools (AI Shorts, AI Agent): BYOK fal.ai + ElevenLabs notice. */}
        {advancedThisTab && <AdvancedBanner needsPlan={needsPlan} onKeys={() => setActiveTab('settings')} />}

        {/* Main Workspace */}
        <div className="flex-1 overflow-hidden relative">

          {/* View: Settings */}
          {activeTab === 'settings' && (
            <div className="h-full overflow-y-auto p-4 sm:p-8 max-w-2xl mx-auto animate-fade">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
                <div>
                  <p className="eyebrow mb-1.5">02 · SETTINGS</p>
                  <h1 className="font-display lowercase text-2xl text-ink">Settings</h1>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted mt-1">
                  <Shield size={12} className="text-ok shrink-0" /> Private, single-user instance
                </div>
              </div>

              <div className="card p-6 mb-2">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-input bg-paper3 flex items-center justify-center shrink-0">
                      <KeyRound size={16} className="text-brass" />
                    </div>
                    <h2 className="text-base font-medium text-ink lowercase">
                      {llmProvider === 'openrouter' ? 'OpenRouter API key' : 'Gemini API key'}
                    </h2>
                  </div>
                  {geminiConfigured
                    ? <span className="badge-ok"><Check size={12} /> configured</span>
                    : <span className="badge-warn"><AlertTriangle size={12} /> not set</span>}
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  {geminiConfigured
                    ? <>The key lives in <code>{envVarName}</code> on the server's <code>.env</code> — it is never
                        sent to or stored in this browser.</>
                    : <>No key configured on the server. Set <code>{envVarName}</code> in the server's <code>.env</code>
                        file and restart the backend — this app has no way to accept one from here.</>}
                </p>
                {llmProvider === 'openrouter' && (
                  <p className="text-xs text-muted leading-relaxed mt-3 pt-3 border-t border-rule">
                    Running via OpenRouter (moment detection only) — "auto edit" and "effects" upload the clip
                    to Gemini's native video API directly and need a real <code>GEMINI_API_KEY</code> to work.
                  </p>
                )}
              </div>

              <div className="card p-6 mt-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-input bg-paper3 flex items-center justify-center shrink-0">
                      <Type size={16} className="text-brass" />
                    </div>
                    <h2 className="text-base font-medium text-ink lowercase">Default subtitle style</h2>
                  </div>
                  {defaultStyle
                    ? <span className="badge-ok"><Check size={12} /> set</span>
                    : <span className="readout">factory default</span>}
                </div>
                <p className="text-xs text-muted mb-4 leading-relaxed">
                  Applied automatically to every clip of every new video — no need to open the subtitle editor
                  each time. Build your own look below (font, colors, size, everything), or start from a preset
                  and tweak it.
                </p>
                <DefaultStyleEditor value={defaultStyle} onChange={setDefaultStyle} />
                {defaultStyle && (
                  <button
                    onClick={() => setDefaultStyle(null)}
                    className="mt-4 text-xs text-muted hover:text-ink transition-colors"
                  >
                    reset to factory default
                  </button>
                )}
              </div>
            </div>
          )}

          {/* View: History */}
          {activeTab === 'history' && (
            <div className="h-full overflow-y-auto custom-scrollbar animate-fade">
              <div className="max-w-6xl mx-auto p-6 md:p-8">
                {/* /api/projects/{id}/restore is cloud/R2-only (404s in this
                    self-host fork) — reopening a past project instead reuses
                    focusJob, the same path the JobSwitcher uses to re-focus
                    any job still recoverable from OUTPUT_DIR. */}
                <HistoryTab onOpenProject={focusJob} />
              </div>
            </div>
          )}


          {/* View: Dashboard (Idle) */}
          {activeTab === 'dashboard' && status === 'idle' && (
            <div className="h-full overflow-y-auto custom-scrollbar animate-fade">
              <div className="min-h-full flex flex-col items-center justify-center px-4 py-6 sm:p-6">
              <div className="max-w-xl w-full text-center space-y-8">
                <div className="space-y-4">
                  <p className="eyebrow">01 · CLIP GENERATOR</p>
                  <h1 className="font-display lowercase text-4xl md:text-5xl text-ink">
                    Create Viral Shorts
                  </h1>
                  <p className="text-muted text-lg">
                    Drop your long-form video below to instantly generate viral clips with AI.
                  </p>
                </div>

                <MediaInput onProcess={handleProcess} isProcessing={status === 'processing'} geminiConfigured={geminiConfigured} llmProvider={llmProvider} />

                <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 text-muted text-sm">
                  <span className="flex items-center gap-2"><Youtube size={16} /> YouTube</span>
                  <span className="flex items-center gap-2"><Instagram size={16} /> Instagram</span>
                  <span className="flex items-center gap-2"><TikTokIcon size={16} /> TikTok</span>
                </div>
              </div>
              </div>
            </div>
          )}

          {/* View: Processing / Results (Split View) */}
          {activeTab === 'dashboard' && (status === 'processing' || status === 'complete' || status === 'error') && (
            <div className="h-full flex flex-col md:flex-row gap-4 p-4 overflow-y-auto md:overflow-y-hidden custom-scrollbar animate-fade">

              {/* Left Panel: Preview & Status */}
              <div className={`${status === 'complete' ? 'w-full md:w-[30%] lg:w-[25%]' : 'w-full md:w-[55%] lg:w-[60%]'} md:h-full flex flex-col shrink-0 md:shrink card p-4 sm:p-6 overflow-y-auto custom-scrollbar transition-all duration-700 ease-in-out`}>
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-sm font-medium text-ink lowercase flex items-center gap-2">
                    <Activity className={`text-brass ${status === 'processing' ? 'animate-pulse' : ''}`} size={18} />
                    Live Analysis
                  </h2>
                  <span className={status === 'processing' ? 'badge-brass' :
                    status === 'complete' ? 'badge-ok' :
                      'badge-danger'
                    }>
                    {status.toUpperCase()}
                  </span>
                </div>

                {/* Video Preview */}
                {processingMedia && (
                  <ProcessingAnimation
                    media={processingMedia}
                    isComplete={status === 'complete'}
                    syncedTime={syncedTime}
                    isSyncedPlaying={isSyncedPlaying}
                    syncTrigger={syncTrigger}
                  />
                )}

                {/* The wait is dead time — the best moment to ask for a star. */}
                {status === 'processing' && (
                  <div className="my-3">
                    <StarBanner message="Free while it renders?" />
                  </div>
                )}

                {/* Logs Terminal */}
                <div className={`bg-paper rounded-card border border-rule overflow-hidden flex flex-col transition-all duration-500 ${status === 'complete' ? 'h-32 min-h-0 opacity-50 hover:opacity-100' : 'flex-1 min-h-[200px]'}`}>
                  <div className="px-4 py-2 border-b border-rule flex items-center justify-between bg-paper2 shrink-0">
                    <span className="readout flex items-center gap-2">
                      <Terminal size={12} /> System Logs
                    </span>
                    <button onClick={() => setLogsVisible(!logsVisible)} className="text-muted hover:text-ink transition-colors">
                      {logsVisible ? <ChevronDown size={14} /> : <ChevronDown size={14} className="rotate-180" />}
                    </button>
                  </div>
                  {logsVisible && (
                    <div className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-1.5 custom-scrollbar text-muted">
                      {logs.map((log, i) => (
                        <div key={i} className={`flex gap-2 ${log.toLowerCase().includes('error') ? 'text-danger' : 'text-muted'}`}>
                          <span className="text-muted opacity-50 shrink-0">{new Date().toLocaleTimeString()}</span>
                          <span>{log}</span>
                        </div>
                      ))}
                      {status === 'processing' && (
                        <div className="animate-pulse text-brass">_</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Panel: Results Grid */}
              <div className={`${status === 'complete' ? 'w-full md:w-[70%] lg:w-[75%]' : 'w-full md:w-[45%] lg:w-[40%]'} md:h-full flex flex-col shrink-0 md:shrink card p-4 sm:p-6 transition-all duration-700 ease-in-out`}>
                <h2 className="font-display lowercase text-xl text-ink mb-6 flex flex-wrap items-center gap-2 shrink-0">
                  Generated Shorts
                  {results?.clips?.length > 0 && (
                    <span className="readout bg-paper3 px-2.5 py-1 rounded-full ml-auto">
                      {results.clips.length} Clips
                    </span>
                  )}
                  {results?.cost_analysis && !isManaged && (
                    <span className="readout bg-paper3 px-2.5 py-1 rounded-full ml-2" title={`Input: ${results.cost_analysis.input_tokens} | Output: ${results.cost_analysis.output_tokens}`}>
                      GEMINI · ${results.cost_analysis.total_cost.toFixed(5)}
                    </span>
                  )}
                  {results?.clips?.length > 0 && status === 'complete' && (
                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        onClick={handleDownloadAll}
                        disabled={downloadingAll}
                        className="btn-ghost px-3 py-2 text-xs"
                        title="Download all clips as a ZIP"
                      >
                        {downloadingAll
                          ? <><Loader2 size={14} className="animate-spin" />zipping…</>
                          : <><Download size={14} />download all</>}
                      </button>
                    </div>
                  )}
                </h2>

                {status === 'complete' && results?.clips?.length > 0 && (
                  <div className="mb-2 space-y-2">
                    {/* Peak-moment upsell: they just SAW their clips — sell while
                        they're proud of the result, before asking for stars. */}
                    {plan === 'free' && (
                      <button
                        onClick={() => { setTopUpInfo({ context: 'upsell' }); setShowTopUp(true); }}
                        className="w-full text-left px-3 py-2.5 rounded-input bg-paper3 border border-brass/40 hover:border-brass text-sm transition-colors"
                      >
                        <span className="text-ink">Like these clips?</span>{' '}
                        <span className="text-muted">They carry a watermark and delete in 7 days.</span>{' '}
                        <span className="text-brass font-medium">Keep them forever →</span>
                      </button>
                    )}
                    <StarBanner message="Happy with your clips?" />
                  </div>
                )}

                <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
                  {results && results.clips && results.clips.length > 0 ? (
                    <div className={`grid gap-4 pb-10 ${status === 'complete' ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
                      {results.clips.map((clip, i) => (
                        <ResultCard
                          key={`${jobId}-${i}-${clip.video_url || ''}`}
                          clip={clip}
                          index={i}
                          jobId={jobId}
                          onEditClip={(index) => setEditingClip(index)}
                          onReframeClip={(index) => setReframingClip(index)}
                          initialState={projectState?.clips?.find((c) => c.index === i) || null}
                          onStateChange={handleClipStateChange}
                          durableUrl={durableClips[i]}
                          isManaged={isManaged}
                          onPlay={(time) => handleClipPlay(time)}
                          onPause={handleClipPause}
                          onBulkSubtitle={handleBulkSubtitles}
                          clipCount={results.clips.length}
                          bulkProgress={bulkSub}
                        />
                      ))}
                    </div>
                  ) : (
                    status === 'processing' ? (
                      <div className="h-full flex flex-col items-center justify-center text-muted space-y-4">
                        <Loader2 size={32} className="animate-spin text-brass" />
                        <p className="text-sm lowercase">Waiting for clips...</p>
                      </div>
                    ) : status === 'error' ? (
                      <div className="h-full flex flex-col items-center justify-center text-danger space-y-2">
                        <p>Generation failed.</p>
                      </div>
                    ) : null
                  )}
                </div>
              </div>

            </div>
          )}

        </div>

      </main>

      {/* Missing API Key Modal */}
      <Modal
        isOpen={showKeyModal}
        onClose={() => setShowKeyModal(false)}
        eyebrow="SETUP"
        title={`${envVarName} Required`}
        footer={
          <button
            onClick={() => setShowKeyModal(false)}
            className="btn-primary w-full px-4 py-2 text-sm"
          >
            Close
          </button>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            This server has no <strong className="text-ink2">{envVarName}</strong> configured — there is no way to
            set one from the browser. Add it to the backend's <code>.env</code> file and restart the server:
          </p>
          <ol className="text-xs text-muted space-y-1 list-decimal list-inside">
            <li>Go to {llmProvider === 'openrouter'
              ? <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-brass underline">openrouter.ai/keys</a>
              : <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-brass underline">aistudio.google.com/app/apikey</a>} and create a key</li>
            <li>Set <code>{envVarName}=&lt;your key&gt;</code> in the server's <code>.env</code></li>
            <li>Restart the backend container/process</li>
          </ol>
        </div>
      </Modal>

      {/* Pre-flight quality gate */}
      {qualityGate && (
        <Modal isOpen={true} onClose={() => setQualityGate(null)} size="md" eyebrow="HEADS UP" title="low source quality">
          <div className="space-y-4">
            <p className="text-sm text-ink2">
              YouTube only offers <span className="text-brass font-semibold">{qualityGate.info.max_height}p</span> for this video
              (below the {qualityGate.info.min_height}p we recommend). Processing anyway will produce lower-quality clips.
            </p>
            {qualityGate.info.cookies_invalid && (
              <p className="text-xs text-muted">
                Your YouTube cookies look expired — refreshing them (export again from an incognito window) often unlocks HD.
              </p>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setQualityGate(null)} className="btn-ghost">cancel</button>
              <button
                onClick={() => { const d = qualityGate.data; setQualityGate(null); handleProcess(d, true); }}
                className="btn-primary"
              >
                process anyway
              </button>
            </div>
          </div>
        </Modal>
      )}


      {editingClip !== null && results?.clips?.[editingClip] && (
        <ClipEditor
          jobId={jobId}
          clipIndex={editingClip}
          clipTitle={results.clips[editingClip].video_title_for_youtube_short || ''}
          onClose={() => setEditingClip(null)}
          onRerendered={handleClipRerendered}
        />
      )}
      {reframingClip !== null && results?.clips?.[reframingClip] && (
        <ReframeEditor
          jobId={jobId}
          clipIndex={reframingClip}
          clipTitle={results.clips[reframingClip].video_title_for_youtube_short || ''}
          onClose={() => setReframingClip(null)}
          onReframed={handleClipRerendered}
        />
      )}
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      {showPlanChoice && <PlanChoiceModal onClose={() => setShowPlanChoice(false)} />}
      {showTopUp && (
        <TopUpModal
          onClose={() => setShowTopUp(false)}
          required={topUpInfo.required}
          remaining={topUpInfo.remaining}
          context={topUpInfo.context || 'wall'}
        />
      )}
      {showTrialUpgrade && (
        <TrialUpgradeModal
          plan={plan}
          onActivated={refreshMe}
          onClose={() => setShowTrialUpgrade(false)}
        />
      )}
    </div>
  );
}

// Top-level, not nested inside App(): a component defined inside another
// component's body gets a fresh function identity every render, which makes
// React treat it as a brand-new component type and remount its whole subtree
// each time — including this nav. With the background job poller ticking
// every couple of seconds, that unmount/remount could race an in-flight
// click and drop it, which is exactly the "nav doesn't respond" bug this
// fixes. No OpenShorts branding here on purpose (private single-user fork,
// see CLAUDE.md) — swap in your own logo/name where noted below.
function Sidebar({ activeTab, setActiveTab }) {
  const navItems = [
    { id: 'dashboard', ord: '01', icon: LayoutDashboard, label: 'Clip Generator' },
    // Single-user self-host fork: history is just a live scan of OUTPUT_DIR
    // (see GET /api/history), so it's always available — no sign-in/plan
    // gate to check, unlike upstream's cloud-only library.
    { id: 'history', ord: '02', icon: History, label: 'History' },
    { id: 'settings', ord: '03', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="w-20 lg:w-64 bg-paper2 border-r border-rule flex flex-col h-full shrink-0 transition-all duration-300">
      {/* Brand slot — replace the icon/label below with your own. */}
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-paper3 rounded-input flex items-center justify-center shrink-0 border border-rule">
          <Film size={16} className="text-brass" />
        </div>
        <span className="font-display lowercase text-lg text-ink hidden lg:block">clip studio</span>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1">
        {navItems.map((item) => {
          const NavIcon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-input transition-colors ${isActive ? 'bg-paper3 text-ink' : 'text-muted hover:text-ink2 hover:bg-paper3/50'}`}
            >
              {isActive && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-brass rounded-full" aria-hidden="true" />
              )}
              <NavIcon size={18} className={`shrink-0 ${isActive ? 'text-brass' : ''}`} />
              <span className="text-sm lowercase hidden lg:block flex-1 text-left truncate">{item.label}</span>
              <span className="readout hidden lg:block">{item.ord}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default App;
