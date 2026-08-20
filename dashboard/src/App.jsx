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
import { loadAllDefaultStyles, saveDefaultStyle, clearDefaultStyle, FORMATS } from './lib/subtitleStyle';
import DefaultStyleEditor from './components/DefaultStyleEditor';
import { loadJobList, saveJobList, titleFor, loadAutoStyledJobs, markJobAutoStyled } from './lib/jobList';
import JobSwitcher from './components/JobSwitcher';

// Simple TikTok icon sine Lucide might not have it or it varies
const TikTokIcon = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-5.201 1.743l-.002-.001.002.001a2.895 2.895 0 0 1 3.183-4.51v-3.5a6.329 6.329 0 0 0-5.394 10.692 6.33 6.33 0 0 0 10.857-4.424V8.687a8.182 8.182 0 0 0 4.773 1.526V6.79a4.831 4.831 0 0 1-1.003-.104z" />
  </svg>
);

// Spanish labels for the internal status values (kept in English internally
// since they drive logic/CSS class names throughout the file).
const STATUS_LABELS = { idle: 'INACTIVO', processing: 'PROCESANDO', complete: 'COMPLETO', error: 'ERROR' };

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
  // User's saved default subtitle style, ONE PER DELIVERY FORMAT (Settings >
  // Default subtitle style, or "save as my default style" inside any clip's
  // subtitle editor). {vertical, horizontal, letterboxed} -> profile | null;
  // null means that format keeps the server's factory-default look. Formats
  // style independently on purpose — see subtitleStyle.js's module docstring
  // for why a look tuned for the tight face crop doesn't suit the letterboxed
  // whole-frame version of the same clip.
  const [defaultStyles, _setDefaultStylesState] = useState(() => loadAllDefaultStyles());
  const setDefaultStyleFor = (format, styleOrNull) => {
    _setDefaultStylesState((prev) => ({ ...prev, [format]: styleOrNull }));
    if (styleOrNull) saveDefaultStyle(styleOrNull, format);
    else clearDefaultStyle(format);
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
  // Which format's default-style editor is showing in Settings — purely a
  // local UI selector, not persisted (defaultStyles itself is, per format).
  const [settingsStyleFormat, setSettingsStyleFormat] = useState('vertical');
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
    setLogs(['♻️ Proyecto restaurado desde tu biblioteca.']);
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
  // lib/jobList.js's markJobAutoStyled), clips whose video url already has a
  // "subtitled_" prefix are left alone instead of re-burned, and the loop
  // only spends time on the ones that actually still need it. Only used for
  // the automatic default-style path — the manual "apply to all" button in
  // the subtitle editor always re-applies everything, since the user may be
  // deliberately switching an already-styled clip to a different look.
  //
  // ``format`` picks which of a clip's three rendered files this styles —
  // 'vertical' (video_url, the default and the only one that existed before
  // clips shipped in three formats), 'horizontal' (video_url_horizontal,
  // the "turn your phone" 9:16-file-rotated-content format) or
  // 'letterboxed' (video_url_letterboxed). The backend infers which field to
  // write the result back to from the input filename's own suffix, so this
  // only has to pick the right SOURCE field going in.
  const urlFieldFor = (format) => (
    format === 'horizontal' ? 'video_url_horizontal'
      : format === 'letterboxed' ? 'video_url_letterboxed'
      : 'video_url'
  );
  const handleBulkSubtitles = async (options, targetJobId = jobId, targetClips = results?.clips, skipAlreadyStyled = false, format = 'vertical') => {
    const clips = targetClips || [];
    const urlField = urlFieldFor(format);
    // Clips from before this format existed (or a source too short/silent
    // for one of the extra formats to have rendered at all) simply don't
    // have this field — skip them rather than styling nothing / erroring.
    const indices = clips.map((c, i) => i).filter((i) => clips[i][urlField]);
    const total = indices.length;
    if (!total) return 0;
    const isFocused = targetJobId === jobId;
    if (isFocused) setBulkSub({ running: true, current: 0, total, errors: 0 });
    let errors = 0;
    for (let n = 0; n < total; n++) {
      const i = indices[n];
      if (isFocused) setBulkSub({ running: true, current: n + 1, total, errors });
      if (skipAlreadyStyled && /\/subtitled_/.test(clips[i][urlField] || '')) continue;
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
            // Chain from the clip's current server file for THIS format.
            input_filename: (clips[i][urlField] || '').split('/').pop(),
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

  // Runs handleBulkSubtitles once per format that has a saved default,
  // sequentially, against the given job's clips — the single entry point
  // both auto-apply effects below call, so "apply every format's own
  // default" is defined once instead of duplicated at each call site.
  // Returns the total error count across all formats attempted.
  const applyDefaultStylesToJob = async (targetJobId, clips) => {
    let errors = 0;
    for (const { id: format } of FORMATS) {
      const style = defaultStyles[format];
      if (!style) continue;
      errors += (await handleBulkSubtitles(style, targetJobId, clips, true, format)) || 0;
    }
    return errors;
  };

  // Auto-apply the user's saved default subtitle style(s) the moment a job's
  // clips are ready — no button, no need to open the subtitle editor per
  // clip. Fires once per job (autoStyledJobRef), and only for formats that
  // actually have a profile saved; a format with none keeps the server's
  // factory-default look, unchanged from before this feature existed.
  useEffect(() => {
    if (status !== 'complete' || !jobId) return;
    if (!results?.clips?.length) return;
    if (autoStyledJobRef.current.has(jobId)) return;
    autoStyledJobRef.current.add(jobId); // block re-entry this session; not yet persisted
    applyDefaultStylesToJob(jobId, results.clips).then((errs) => {
      if (errs === 0) markJobAutoStyled(jobId); // fully done — persist so it never retries
      else autoStyledJobRef.current.delete(jobId); // partial/failed — eligible for retry next load
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, jobId, results, defaultStyles]);

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
      alert(`Error al descargar: ${e.message}`);
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
  // changes — only jobId/status (the focused job) and defaultStyles do that.
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
            const errorMsg = data.error || (data.logs?.length ? data.logs[data.logs.length - 1] : "El proceso ha fallado");
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
            if (data.result?.clips?.length && !autoStyledJobRef.current.has(j.jobId)) {
              autoStyledJobRef.current.add(j.jobId);
              applyDefaultStylesToJob(j.jobId, data.result.clips).then((errs) => {
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
  }, [status, jobId, defaultStyles]);


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
    setLogs(["Iniciando proceso..."]);
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
      setLogs(l => [...l, `Error al iniciar el trabajo: ${e.message}`]);
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

  // Browser back/forward support. The app has no router — every tab switch
  // and every project focus was plain React state, invisible to the
  // browser's own history stack, so the back button had nothing of ours to
  // step back through and just left the app (or did nothing at all). This
  // pushes one history entry per navigation instead, keyed on (tab, jobId),
  // and popNavState below restores state from it on back/forward without
  // pushing again — pushing there would turn one "back" press into a loop.
  const pushNavState = (tab, id) => {
    try {
      window.history.pushState({ tab, jobId: id ?? null }, '', `#/${tab}`);
    } catch (e) { /* history API unavailable — navigation still works, just not back/forward */ }
  };

  // For a tab switch that doesn't touch which job is loaded (Ajustes,
  // Historial from the sidebar, …) — setActiveTab plus a history entry.
  const navigateTab = (tab) => {
    setActiveTab(tab);
    pushNavState(tab, jobId);
  };

  const poppingRef = useRef(false);
  const historyInitRef = useRef(false);

  // Establish the FIRST history entry once, after the localStorage session
  // (if any) has finished restoring — so the very first back-press has
  // something of ours to land on instead of falling straight out of the app.
  useEffect(() => {
    if (historyInitRef.current) return;
    historyInitRef.current = true;
    try {
      window.history.replaceState({ tab: activeTab, jobId }, '', `#/${activeTab}`);
    } catch (e) { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back/forward: restore the (tab, jobId) pair from the entry being
  // navigated to. A jobId that isn't already loaded gets re-fetched through
  // focusJob, same as clicking it anywhere else in the UI — just without
  // pushing a further history entry (poppingRef guards that).
  useEffect(() => {
    const onPopState = (e) => {
      const state = e.state || { tab: 'dashboard', jobId: null };
      poppingRef.current = true;
      if (state.jobId && state.jobId !== jobId) {
        focusJob(state.jobId, { pushHistory: false }).finally(() => { poppingRef.current = false; });
      } else {
        setActiveTab(state.tab || 'dashboard');
        poppingRef.current = false;
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Switch the main view to a different tracked job (JobSwitcher) — a
  // background job the user started earlier and left running, or one that
  // already finished. Always re-fetches fresh rather than trusting the
  // switcher's cached status, since that's only updated on the 2s poll tick.
  const focusJob = async (id, { pushHistory = true } = {}) => {
    if (id === jobId) {
      // Already the loaded job (e.g. clicking "abrir para editar" in History
      // on the project you're already focused on, from a different tab) —
      // nothing to re-fetch, but the tab switch below still has to happen or
      // the click looks like it did nothing at all.
      setActiveTab('dashboard');
      if (pushHistory) pushNavState('dashboard', id);
      return;
    }
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
      if (pushHistory) pushNavState('dashboard', id);
    } catch (e) {
      alert(`No se pudo cargar ese trabajo: ${e.message}`);
    }
  };

  // --- UI Components ---

  return (
    <div className="flex h-screen bg-paper overflow-hidden">
      <Sidebar activeTab={activeTab} setActiveTab={navigateTab} />

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
                <span className="hidden sm:inline">Nuevo proyecto</span>
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
                Elegir un plan
              </button>
            )}
            {billingEnabled && !isSignedIn && (
              <button onClick={() => setShowLogin(true)}
                className="btn-ghost px-4 py-2 text-xs">
                Iniciar sesión
              </button>
            )}
            {billingEnabled && isSignedIn && <ProfileMenu />}

            {keysMissing && (
              <button
                onClick={() => navigateTab('settings')}
                className="badge-warn hover:brightness-125 transition-all"
                title={`El servidor no tiene ${envVarName} configurada`}
              >
                <AlertTriangle size={12} />
                <span className="hidden sm:inline">falta {envVarName}</span>
                <span className="sm:hidden">falta la clave</span>
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
                <span className="font-medium text-ink">{envVarName} no está configurada en el servidor.</span>{' '}
                <span className="text-muted">
                  Añádela al .env del backend y reinicia el servidor para usar esta app.
                </span>
              </div>
            </div>
            <button
              onClick={() => navigateTab('settings')}
              className="btn-quiet px-3 py-1.5 text-xs shrink-0"
            >
              Detalles
            </button>
          </div>
        )}

        {/* Session Recovery Banner */}
        {sessionRecovered && (
          <div className="mx-6 mt-2 px-4 py-3 bg-paper2 border border-rule rounded-card flex items-center justify-between animate-fade shrink-0">
            <div className="flex items-center gap-2 text-sm text-ink2">
              <RotateCcw size={16} className="text-brass" />
              <span className="font-medium">Sesión recuperada</span>
              <span className="text-muted text-xs">Se ha restaurado tu trabajo anterior.</span>
            </div>
            <button onClick={() => setSessionRecovered(false)} className="text-muted hover:text-ink transition-colors">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Included tools (Clip Generator, YouTube Studio): non-blocking trial prompt. */}
        {gateThisTab && <TrialGate toolName={TOOL_NAMES[activeTab] || 'this'} />}

        {/* Advanced tools (AI Shorts, AI Agent): BYOK fal.ai + ElevenLabs notice. */}
        {advancedThisTab && <AdvancedBanner needsPlan={needsPlan} onKeys={() => navigateTab('settings')} />}

        {/* Main Workspace */}
        <div className="flex-1 overflow-hidden relative">

          {/* View: Settings */}
          {activeTab === 'settings' && (
            <div className="h-full overflow-y-auto p-4 sm:p-8 max-w-2xl mx-auto animate-fade">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
                <div>
                  <p className="eyebrow mb-1.5">02 · AJUSTES</p>
                  <h1 className="font-display lowercase text-2xl text-ink">Ajustes</h1>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted mt-1">
                  <Shield size={12} className="text-ok shrink-0" /> Instancia privada, de un solo usuario
                </div>
              </div>

              <div className="card p-6 mb-2">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-input bg-paper3 flex items-center justify-center shrink-0">
                      <KeyRound size={16} className="text-brass" />
                    </div>
                    <h2 className="text-base font-medium text-ink lowercase">
                      {llmProvider === 'openrouter' ? 'Clave API de OpenRouter' : 'Clave API de Gemini'}
                    </h2>
                  </div>
                  {geminiConfigured
                    ? <span className="badge-ok"><Check size={12} /> configurada</span>
                    : <span className="badge-warn"><AlertTriangle size={12} /> no configurada</span>}
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  {geminiConfigured
                    ? <>La clave vive en <code>{envVarName}</code>, en el <code>.env</code> del servidor — nunca
                        se envía ni se guarda en este navegador.</>
                    : <>No hay ninguna clave configurada en el servidor. Define <code>{envVarName}</code> en el
                        <code>.env</code> del servidor y reinicia el backend — esta app no tiene forma de
                        aceptar una clave desde aquí.</>}
                </p>
                {llmProvider === 'openrouter' && (
                  <p className="text-xs text-muted leading-relaxed mt-3 pt-3 border-t border-rule">
                    Funcionando vía OpenRouter (solo detección de momentos) — "auto edit" y "efectos" suben el
                    clip directamente a la API de vídeo nativa de Gemini y necesitan una <code>GEMINI_API_KEY</code>
                    real para funcionar.
                  </p>
                )}
              </div>

              <div className="card p-6 mt-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-input bg-paper3 flex items-center justify-center shrink-0">
                      <Type size={16} className="text-brass" />
                    </div>
                    <h2 className="text-base font-medium text-ink lowercase">Estilo de subtítulos por defecto</h2>
                  </div>
                  {defaultStyles[settingsStyleFormat]
                    ? <span className="badge-ok"><Check size={12} /> configurado</span>
                    : <span className="readout">valor de fábrica</span>}
                </div>
                <p className="text-xs text-muted mb-4 leading-relaxed">
                  Cada uno de los 3 formatos en que se genera un clip (vertical recortado, girar móvil,
                  vertical encajado) tiene su propio estilo por defecto — uno pensado para un recorte ajustado
                  a la cara puede quedar mal encima de la versión encajada del mismo clip. Se aplica
                  automáticamente a cada formato de cada vídeo nuevo, sin tener que abrir el editor cada vez.
                </p>
                {/* Format tabs — DefaultStyleEditor gets a key per format so
                    its internal state (which custom preset is "loaded", the
                    new-preset-name input, …) never bleeds between formats. */}
                <div className="flex gap-1.5 mb-4 border-b border-rule">
                  {FORMATS.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setSettingsStyleFormat(f.id)}
                      className={`pb-2.5 px-1 -mb-px border-b-2 text-xs lowercase whitespace-nowrap transition-colors flex items-center gap-1.5 ${settingsStyleFormat === f.id
                        ? 'text-ink border-brass'
                        : 'text-muted border-transparent hover:text-ink2'
                        }`}
                    >
                      {f.label}
                      {defaultStyles[f.id] && <span className="w-1.5 h-1.5 rounded-full bg-brass shrink-0" />}
                    </button>
                  ))}
                </div>
                <DefaultStyleEditor
                  key={settingsStyleFormat}
                  value={defaultStyles[settingsStyleFormat]}
                  onChange={(style) => setDefaultStyleFor(settingsStyleFormat, style)}
                />
                {defaultStyles[settingsStyleFormat] && (
                  <button
                    onClick={() => setDefaultStyleFor(settingsStyleFormat, null)}
                    className="mt-4 text-xs text-muted hover:text-ink transition-colors"
                  >
                    restablecer al valor de fábrica
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
                  <p className="eyebrow">01 · GENERADOR DE CLIPS</p>
                  <h1 className="font-display lowercase text-4xl md:text-5xl text-ink">
                    Crea shorts virales
                  </h1>
                  <p className="text-muted text-lg">
                    Suelta tu vídeo largo abajo para generar al instante clips virales con IA.
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
                    Análisis en vivo
                  </h2>
                  <span className={status === 'processing' ? 'badge-brass' :
                    status === 'complete' ? 'badge-ok' :
                      'badge-danger'
                    }>
                    {STATUS_LABELS[status] || status.toUpperCase()}
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
                    <StarBanner message="¿Gratis mientras se genera?" />
                  </div>
                )}

                {/* Logs Terminal */}
                <div className={`bg-paper rounded-card border border-rule overflow-hidden flex flex-col transition-all duration-500 ${status === 'complete' ? 'h-32 min-h-0 opacity-50 hover:opacity-100' : 'flex-1 min-h-[200px]'}`}>
                  <div className="px-4 py-2 border-b border-rule flex items-center justify-between bg-paper2 shrink-0">
                    <span className="readout flex items-center gap-2">
                      <Terminal size={12} /> Registro del sistema
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
                  Shorts generados
                  {results?.clips?.length > 0 && (
                    <span className="readout bg-paper3 px-2.5 py-1 rounded-full ml-auto">
                      {results.clips.length} clips
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
                        title="Descargar todos los clips como ZIP"
                      >
                        {downloadingAll
                          ? <><Loader2 size={14} className="animate-spin" />comprimiendo…</>
                          : <><Download size={14} />descargar todo</>}
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
                        <span className="text-ink">¿Te gustan estos clips?</span>{' '}
                        <span className="text-muted">Llevan marca de agua y se eliminan en 7 días.</span>{' '}
                        <span className="text-brass font-medium">Consérvalos para siempre →</span>
                      </button>
                    )}
                    <StarBanner message="¿Contento con tus clips?" />
                  </div>
                )}

                <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
                  {results && results.clips && results.clips.length > 0 ? (
                    <div className={`grid gap-4 pb-10 ${status === 'complete' ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
                      {/* Each detected clip ships in three formats — a card
                          per format that actually rendered, "Clip N.1/N.2/N.3"
                          (vertical / girar móvil / encajado). Only the vertical
                          crop carries recut/reframe/auto-edit/session-restore:
                          those are all tied to the face-tracking reframe engine,
                          which the other two formats never run. */}
                      {results.clips.flatMap((clip, i) => (
                        FORMATS
                          .filter((f) => f.id === 'vertical' || clip[urlFieldFor(f.id)])
                          .map((f) => (
                            <ResultCard
                              key={`${jobId}-${i}-${f.id}-${clip[urlFieldFor(f.id)] || ''}`}
                              clip={clip}
                              index={i}
                              format={f.id}
                              jobId={jobId}
                              onEditClip={f.id === 'vertical' ? (index) => setEditingClip(index) : undefined}
                              onReframeClip={f.id === 'vertical' ? (index) => setReframingClip(index) : undefined}
                              initialState={f.id === 'vertical' ? (projectState?.clips?.find((c) => c.index === i) || null) : null}
                              onStateChange={f.id === 'vertical' ? handleClipStateChange : undefined}
                              durableUrl={f.id === 'vertical' ? durableClips[i] : undefined}
                              isManaged={isManaged}
                              onPlay={f.id === 'vertical' ? (time) => handleClipPlay(time) : undefined}
                              onPause={f.id === 'vertical' ? handleClipPause : undefined}
                              onBulkSubtitle={(options) => handleBulkSubtitles(options, jobId, results.clips, false, f.id)}
                              clipCount={results.clips.length}
                              bulkProgress={bulkSub}
                            />
                          ))
                      ))}
                    </div>
                  ) : (
                    status === 'processing' ? (
                      <div className="h-full flex flex-col items-center justify-center text-muted space-y-4">
                        <Loader2 size={32} className="animate-spin text-brass" />
                        <p className="text-sm lowercase">Esperando los clips...</p>
                      </div>
                    ) : status === 'error' ? (
                      <div className="h-full flex flex-col items-center justify-center text-danger space-y-2">
                        <p>Ha fallado la generación.</p>
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
        eyebrow="CONFIGURACIÓN"
        title={`Falta ${envVarName}`}
        footer={
          <button
            onClick={() => setShowKeyModal(false)}
            className="btn-primary w-full px-4 py-2 text-sm"
          >
            Cerrar
          </button>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Este servidor no tiene <strong className="text-ink2">{envVarName}</strong> configurada — no hay forma de
            establecerla desde el navegador. Añádela al archivo <code>.env</code> del backend y reinicia el servidor:
          </p>
          <ol className="text-xs text-muted space-y-1 list-decimal list-inside">
            <li>Ve a {llmProvider === 'openrouter'
              ? <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-brass underline">openrouter.ai/keys</a>
              : <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-brass underline">aistudio.google.com/app/apikey</a>} y crea una clave</li>
            <li>Define <code>{envVarName}=&lt;tu_clave&gt;</code> en el <code>.env</code> del servidor</li>
            <li>Reinicia el contenedor o proceso del backend</li>
          </ol>
        </div>
      </Modal>

      {/* Pre-flight quality gate */}
      {qualityGate && (
        <Modal isOpen={true} onClose={() => setQualityGate(null)} size="md" eyebrow="ATENCIÓN" title="calidad de origen baja">
          <div className="space-y-4">
            <p className="text-sm text-ink2">
              YouTube solo ofrece <span className="text-brass font-semibold">{qualityGate.info.max_height}p</span> para este vídeo
              (por debajo de los {qualityGate.info.min_height}p recomendados). Procesarlo igualmente producirá clips de menor calidad.
            </p>
            {qualityGate.info.cookies_invalid && (
              <p className="text-xs text-muted">
                Tus cookies de YouTube parecen haber caducado — renovarlas (exportarlas de nuevo desde una ventana de incógnito) suele desbloquear HD.
              </p>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setQualityGate(null)} className="btn-ghost">cancelar</button>
              <button
                onClick={() => { const d = qualityGate.data; setQualityGate(null); handleProcess(d, true); }}
                className="btn-primary"
              >
                procesar de todas formas
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
    { id: 'dashboard', ord: '01', icon: LayoutDashboard, label: 'Generador de clips' },
    // Single-user self-host fork: history is just a live scan of OUTPUT_DIR
    // (see GET /api/history), so it's always available — no sign-in/plan
    // gate to check, unlike upstream's cloud-only library.
    { id: 'history', ord: '02', icon: History, label: 'Historial' },
    { id: 'settings', ord: '03', icon: Settings, label: 'Ajustes' },
  ];

  return (
    <div className="w-20 lg:w-64 bg-paper2 border-r border-rule flex flex-col h-full shrink-0 transition-all duration-300">
      {/* Brand slot — replace the icon/label below with your own. */}
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-paper3 rounded-input flex items-center justify-center shrink-0 border border-rule">
          <Film size={16} className="text-brass" />
        </div>
        <span className="font-display lowercase text-lg text-ink hidden lg:block">estudio de clips</span>
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
