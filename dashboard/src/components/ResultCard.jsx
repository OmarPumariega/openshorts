import React, { useState, useEffect } from 'react';
import { Download, AlertCircle, Loader2, Copy, Check, Wand2, Type, FileText, Scissors, Crosshair } from 'lucide-react';
import { getApiUrl } from '../config';
import { apiFetch } from '../lib/api';
import SubtitleModal from './SubtitleModal';
import HookModal from './HookModal';
import Modal from './ui/Modal';
import WatermarkModal, { watermarkNoticeDismissed } from './WatermarkModal';
import { useAuth } from '../contexts/AuthContext';
import { renderInBrowser } from '../lib/renderInBrowser';

const QUIET_BTN = 'group flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-input border border-rule hover:bg-paper3 text-[11px] lowercase text-ink2 whitespace-nowrap transition-colors disabled:opacity-45 disabled:cursor-not-allowed';

function clipDurationSeconds(clip) {
    // A recut clip's start/end are the covering source range (segments may be
    // non-contiguous or reordered); its real duration is the segment sum.
    const segments = clip.recipe?.segments;
    if (segments?.length) {
        return segments.reduce((acc, s) => acc + (s.end - s.start), 0);
    }
    return clip.end && clip.start ? clip.end - clip.start : NaN;
}

function formatDuration(clip) {
    const secs = Math.floor(clipDurationSeconds(clip));
    if (!Number.isFinite(secs) || secs < 0) return null;
    return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

// vertical: video_url, the face-tracked crop — the only format that existed
// before clips shipped in three, and the only one with recut/reframe/auto-
// edit wired up server-side (those are all tied to the face-tracking reframe
// engine, which the other two formats never go through). horizontal: the
// "girar móvil" 9:16-file-rotated-content format. letterboxed: whole frame
// fitted with black bars.
const URL_FIELD = {
    vertical: 'video_url',
    horizontal: 'video_url_horizontal',
    letterboxed: 'video_url_letterboxed',
};
const FORMAT_LABEL = {
    vertical: 'vertical',
    horizontal: 'girar móvil',
    letterboxed: 'encajado',
};
// "Clip 1.1 / 1.2 / 1.3" per the user's own naming — one sub-number per
// format, in the fixed order every clip renders them.
const FORMAT_SUBINDEX = { vertical: 1, horizontal: 2, letterboxed: 3 };

export default function ResultCard({ clip, index, jobId, format = 'vertical', durableUrl, isManaged, onPlay, onPause, onBulkSubtitle, clipCount = 1, bulkProgress, initialState = null, onStateChange, onEditClip = null, onReframeClip = null }) {
    const urlField = URL_FIELD[format] || 'video_url';
    const clipUrl = clip[urlField];
    const [showDescModal, setShowDescModal] = useState(false);
    const [showSubtitleModal, setShowSubtitleModal] = useState(false);
    const [showWatermarkModal, setShowWatermarkModal] = useState(false);
    const { plan } = useAuth();
    const videoRef = React.useRef(null);
    // Pristine base clip (no burned subtitles/hook), stable regardless of how
    // the clip's url mutates after server edits. Used as the compositing base
    // for the Remotion preview so it never stacks subtitles over an already-
    // subtitled file (double-subtitle bug).
    const stripBurns = (filename) => {
        let f = filename || '', prev;
        do { prev = f; f = f.replace(/^subtitled_\d+_/, '').replace(/^hook_/, ''); } while (f !== prev);
        return f;
    };
    const originalVideoUrl = getApiUrl((clipUrl || '').replace(/[^/]+$/, stripBurns((clipUrl || '').split('/').pop())));
    const [currentVideoUrl, setCurrentVideoUrl] = useState(getApiUrl(clipUrl));

    // clip-1.mp4 for the vertical crop (unchanged filename — it's the format
    // that existed before this shipped), clip-1-horizontal.mp4 / clip-1-
    // letterboxed.mp4 for the other two, so three downloads of the same clip
    // never collide in a Downloads folder.
    const downloadClip = async () => {
        const suffix = format === 'vertical' ? '' : `-${format}`;
        try {
            const response = await fetch(currentVideoUrl);
            if (!response.ok) throw new Error('Download failed');
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `clip-${index + 1}${suffix}.mp4`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err) {
            console.error('Download error:', err);
            window.open(currentVideoUrl, '_blank');
        }
    };
    // Latest file that exists ON THE SERVER (blob: previews don't count).
    // All server-side operations must chain from this, so burned-in edits
    // (subtitles, hooks, effects) never get silently dropped.
    // A reopened project seeds it from the persisted project state.
    const [serverVideoFile, setServerVideoFile] = useState(initialState?.server_file || (clipUrl || '').split('/').pop());
    const [videoErrored, setVideoErrored] = useState(false);
    const [resolution, setResolution] = useState(null);

    // If the local video failed and a durable R2 URL is (now) available, use it.
    // Handles the race where the video errors before the durable URL has loaded.
    useEffect(() => {
        if (videoErrored && durableUrl && currentVideoUrl !== durableUrl) {
            setCurrentVideoUrl(durableUrl);
            setVideoErrored(false);
        }
    }, [videoErrored, durableUrl, currentVideoUrl]);

    // When an external refresh changes this clip's server file (e.g. bulk
    // subtitles applied from another card), adopt it so the card shows the
    // freshly subtitled video instead of a stale one.
    useEffect(() => {
        const serverUrl = getApiUrl(clipUrl);
        const serverName = (clipUrl || '').split('/').pop();
        if (serverName && serverName !== serverVideoFile) {
            setServerVideoFile(serverName);
            setCurrentVideoUrl(serverUrl);
            if (videoRef.current) videoRef.current.load();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clipUrl]);

    const [copied, setCopied] = useState(null);

    const handleCopy = async (field, text) => {
        try {
            await navigator.clipboard.writeText(text || '');
            setCopied(field);
            setTimeout(() => setCopied(null), 2000);
        } catch {
            // clipboard unavailable — silent
        }
    };

    const [isEditing, setIsEditing] = useState(false);
    const [isSubtitling, setIsSubtitling] = useState(false);
    const [isHooking, setIsHooking] = useState(false);
    const [showHookModal, setShowHookModal] = useState(false);
    const [editError, setEditError] = useState(null);

    const [clipDuration, setClipDuration] = useState(() => {
        const secs = clipDurationSeconds(clip);
        return Number.isFinite(secs) ? secs : 30;
    });

    // Accumulate Remotion layers across operations. A reopened project restores
    // the layers persisted in its project state, so the next edit composes over
    // them instead of silently dropping previous browser-side work.
    const [activeLayers, setActiveLayers] = useState(initialState?.active_layers || { subtitles: null, hook: null, effects: null });

    // Report edit state upward (debounced sync to the project record). Skip the
    // mount run: only user-driven changes are worth persisting.
    const stateReported = React.useRef(false);
    useEffect(() => {
        if (!stateReported.current) { stateReported.current = true; return; }
        onStateChange?.(index, { activeLayers, serverVideoFile });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeLayers, serverVideoFile]);

    // True when the current server file already carries burned-in content.
    // Browser (Remotion) renders compose over the ORIGINAL clip, so using them
    // here would silently drop those burns — chain via server FFmpeg instead.
    const hasServerBurns = /(^|_)(subtitled|hook)_/.test(serverVideoFile || '');

    // Fetch clip duration from transcript endpoint
    useEffect(() => {
        if (!jobId || index === undefined) return;
        apiFetch(`/api/clip/${jobId}/${index}/transcript`)
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data && data.durationSec) setClipDuration(data.durationSec);
            })
            .catch(() => {});
    }, [jobId, index]);

    const handleAutoEdit = async () => {
        setIsEditing(true);
        setEditError(null);
        try {
            // No BYOK in this fork — the server always resolves GEMINI_API_KEY
            // from its own environment, so there is nothing to gate on here.

            // Try Remotion effects endpoint first
            const effectsRes = hasServerBurns ? null : await apiFetch('/api/effects/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    job_id: jobId,
                    clip_index: index,
                    input_filename: serverVideoFile
                })
            });

            if (effectsRes && effectsRes.ok) {
                const data = await effectsRes.json();
                if (data.effects && data.effects.segments) {
                    const newLayers = { ...activeLayers, effects: data.effects };
                    setActiveLayers(newLayers);
                    const blobUrl = await renderInBrowser({
                        videoUrl: originalVideoUrl,
                        durationInSeconds: clipDuration,
                        subtitles: newLayers.subtitles,
                        hook: newLayers.hook,
                        effects: newLayers.effects,
                    });
                    setCurrentVideoUrl(blobUrl);
                    if (videoRef.current) videoRef.current.load();
                    return;
                }
            }

            // Fallback: legacy FFmpeg edit endpoint
            const res = await apiFetch('/api/edit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    job_id: jobId,
                    clip_index: index,
                    input_filename: serverVideoFile
                })
            });

            if (!res.ok) {
                const errText = await res.text();
                try {
                    const jsonErr = JSON.parse(errText);
                    throw new Error(jsonErr.detail || errText);
                } catch (e) {
                    throw new Error(errText);
                }
            }

            const data = await res.json();
            if (data.new_video_url) {
                setCurrentVideoUrl(getApiUrl(data.new_video_url));
                setServerVideoFile(data.new_video_url.split('/').pop());
                if (videoRef.current) {
                    videoRef.current.load();
                }
            }

        } catch (e) {
            setEditError(e.message);
            setTimeout(() => setEditError(null), 5000);
        } finally {
            setIsEditing(false);
        }
    };

    // Clips are captioned by default, so "no captions" has to be reachable.
    // Nothing is re-encoded: the server still holds the clean file next to the
    // captioned one and just points this clip back at it.
    const handleRemoveSubtitles = async () => {
        setIsSubtitling(true);
        setEditError(null);
        try {
            const res = await apiFetch('/api/subtitle/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_id: jobId, clip_index: index, input_filename: serverVideoFile,
                }),
            });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            if (data.new_video_url) {
                const serverUrl = getApiUrl(data.new_video_url);
                setServerVideoFile(data.new_video_url.split('/').pop());
                const remaining = { ...activeLayers, subtitles: null };
                setActiveLayers(remaining);
                if (remaining.hook || remaining.effects) {
                    setCurrentVideoUrl(await renderInBrowser({
                        videoUrl: serverUrl,
                        durationInSeconds: clipDuration,
                        subtitles: null,
                        hook: remaining.hook,
                        effects: remaining.effects,
                    }));
                } else {
                    setCurrentVideoUrl(serverUrl);
                }
                if (videoRef.current) videoRef.current.load();
                setShowSubtitleModal(false);
            }
        } catch (e) {
            setEditError(e.message);
            setTimeout(() => setEditError(null), 5000);
        } finally {
            setIsSubtitling(false);
        }
    };

    const handleSubtitle = async (options) => {
        setIsSubtitling(true);
        setEditError(null);
        try {
            // Karaoke styles are burned server-side (ASS word-highlight render);
            // the in-browser Remotion path only handles classic styles, and only
            // when the server file has no burned-in content to preserve.
            if (options.remotion && options.style !== 'karaoke' && !hasServerBurns) {
                // Accumulate layer and render all layers together
                const newLayers = { ...activeLayers, subtitles: options.remotion };
                setActiveLayers(newLayers);
                const blobUrl = await renderInBrowser({
                    videoUrl: originalVideoUrl,
                    durationInSeconds: clipDuration,
                    subtitles: newLayers.subtitles,
                    hook: newLayers.hook,
                    effects: newLayers.effects,
                });
                setCurrentVideoUrl(blobUrl);
                if (videoRef.current) videoRef.current.load();
                setShowSubtitleModal(false);
                return;
            }

            // Fallback: legacy FFmpeg
            const res = await apiFetch('/api/subtitle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_id: jobId,
                    clip_index: index,
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
                    input_filename: serverVideoFile,
                    // Edited caption text (clip-relative ms); null = server
                    // regenerates from the transcript as before.
                    words: options.captions || null
                })
            });

            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            if (data.new_video_url) {
                const serverUrl = getApiUrl(data.new_video_url);
                setServerVideoFile(data.new_video_url.split('/').pop());
                // Subtitles are burned into the server file now — drop the
                // browser subtitle layer and re-compose any remaining browser
                // layers (hook/effects) over the new file so they aren't lost.
                const remaining = { ...activeLayers, subtitles: null };
                setActiveLayers(remaining);
                if (remaining.hook || remaining.effects) {
                    const blobUrl = await renderInBrowser({
                        videoUrl: serverUrl,
                        durationInSeconds: clipDuration,
                        subtitles: null,
                        hook: remaining.hook,
                        effects: remaining.effects,
                    });
                    setCurrentVideoUrl(blobUrl);
                } else {
                    setCurrentVideoUrl(serverUrl);
                }
                if (videoRef.current) videoRef.current.load();
                setShowSubtitleModal(false);
            }
        } catch (e) {
            setEditError(e.message);
            setTimeout(() => setEditError(null), 5000);
        } finally {
            setIsSubtitling(false);
        }
    };

    const handleHook = async (hookData) => {
        setIsHooking(true);
        setEditError(null);
        try {
            if (hookData.remotion && !hasServerBurns) {
                // Accumulate layer and render all layers together
                const newLayers = { ...activeLayers, hook: hookData.remotion };
                setActiveLayers(newLayers);
                const blobUrl = await renderInBrowser({
                    videoUrl: originalVideoUrl,
                    durationInSeconds: clipDuration,
                    subtitles: newLayers.subtitles,
                    hook: newLayers.hook,
                    effects: newLayers.effects,
                });
                setCurrentVideoUrl(blobUrl);
                if (videoRef.current) videoRef.current.load();
                setShowHookModal(false);
                return;
            }

            // Fallback: legacy FFmpeg
            const payload = typeof hookData === 'string'
                ? { text: hookData, position: 'top', size: 'M' }
                : hookData;

            const res = await apiFetch('/api/hook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_id: jobId,
                    clip_index: index,
                    text: payload.text,
                    position: payload.position,
                    size: payload.size,
                    style: payload.style || 'classic',
                    duration_seconds: payload.remotion?.displayDurationSec ?? null,
                    input_filename: serverVideoFile
                })
            });

            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            if (data.new_video_url) {
                setCurrentVideoUrl(getApiUrl(data.new_video_url));
                setServerVideoFile(data.new_video_url.split('/').pop());
                if (videoRef.current) videoRef.current.load();
                setShowHookModal(false);
            }
        } catch (e) {
            setEditError(e.message);
            setTimeout(() => setEditError(null), 5000);
        } finally {
            setIsHooking(false);
        }
    };

    const durationReadout = formatDuration(clip);

    return (
        <div className="card overflow-hidden flex flex-col md:flex-row group hover:border-rule2 transition-colors animate-fade md:min-h-[420px]" style={{ animationDelay: `${index * 0.1}s` }}>
            {/* Left: Video Preview — 9:16 column matching the fixed card height */}
            <div className="w-full md:w-[236px] bg-black relative shrink-0 aspect-[9/16] md:aspect-auto group/video">
                <video
                    ref={videoRef}
                    src={currentVideoUrl}
                    controls
                    className="w-full h-full object-contain"
                    playsInline
                    onLoadedMetadata={(e) => {
                        if (e.target.videoWidth) setResolution(`${e.target.videoWidth}×${e.target.videoHeight}`);
                    }}
                    onError={() => {
                        // Local /videos/ file gone (e.g. cleaned up after a reload) →
                        // fall back to the durable R2 copy for managed users. If the
                        // durable URL hasn't loaded yet, the effect above retries.
                        if (durableUrl && currentVideoUrl !== durableUrl) setCurrentVideoUrl(durableUrl);
                        else setVideoErrored(true);
                    }}
                    onPlay={() => {
                        const currentTime = videoRef.current ? videoRef.current.currentTime : 0;
                        onPlay && onPlay(clip.start + currentTime);
                    }}
                    onPause={() => onPause && onPause()}
                    onEnded={() => {
                        if (videoRef.current) {
                            videoRef.current.currentTime = 0;
                            videoRef.current.play();
                        }
                    }}
                />
                <div className="absolute top-3 left-3 flex gap-2">
                    <span className="bg-black/70 text-ink font-mono text-micro uppercase px-2 py-1 rounded-full">
                        Clip {index + 1}.{FORMAT_SUBINDEX[format] || 1} · {FORMAT_LABEL[format] || format}
                    </span>
                </div>

                {/* Auto Edit Overlay if Processing */}
                {isEditing && (
                    <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-10 p-4 text-center">
                        <Loader2 size={28} className="text-brass animate-spin mb-3" />
                        <span className="text-xs text-ink lowercase">magia de la IA en progreso…</span>
                        <span className="readout mt-1.5">APLICANDO EDICIONES VIRALES · ZOOMS</span>
                    </div>
                )}
            </div>

            {/* Right: Content & Details */}
            <div className="flex-1 p-4 md:p-5 flex flex-col overflow-hidden min-w-0">
                <div className="mb-4">
                    <h3 className="text-base font-medium text-ink leading-tight line-clamp-2 mb-2 break-words" title={clip.video_title_for_youtube_short}>
                        {clip.video_title_for_youtube_short || "Clip viral generado"}
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                        {durationReadout && <span className="readout bg-paper3 px-2 py-0.5 rounded-full shrink-0">{durationReadout}</span>}
                        {resolution && <span className="readout bg-paper3 px-2 py-0.5 rounded-full shrink-0">{resolution}</span>}
                        <span className="readout bg-paper3 px-2 py-0.5 rounded-full shrink-0">#shorts</span>
                        <span className="readout bg-paper3 px-2 py-0.5 rounded-full shrink-0">#viral</span>
                    </div>
                </div>

                {/* Descriptions (compact) — full text lives in the modal */}
                <div className="flex-1 min-h-0 space-y-2 mb-4">
                    <div className="bg-paper rounded-input px-3 py-2 border border-rule flex items-center gap-2 min-w-0">
                        <span className="eyebrow shrink-0">YOUTUBE</span>
                        <p className="text-xs text-ink2 truncate flex-1 min-w-0">
                            {clip.video_title_for_youtube_short || "Vídeo corto viral"}
                        </p>
                        <button
                            onClick={() => handleCopy('youtube', clip.video_title_for_youtube_short || "Vídeo corto viral")}
                            aria-label="copiar título de youtube"
                            className="p-1 rounded-full text-muted hover:text-brass transition-colors shrink-0"
                        >
                            {copied === 'youtube' ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
                        </button>
                    </div>

                    <div className="bg-paper rounded-input px-3 py-2 border border-rule flex items-center gap-2 min-w-0">
                        <span className="eyebrow shrink-0">TIKTOK · IG</span>
                        <p className="text-xs text-ink2 truncate flex-1 min-w-0">
                            {clip.video_description_for_tiktok || clip.video_description_for_instagram}
                        </p>
                        <button
                            onClick={() => handleCopy('caption', clip.video_description_for_tiktok || clip.video_description_for_instagram)}
                            aria-label="copiar descripción"
                            className="p-1 rounded-full text-muted hover:text-brass transition-colors shrink-0"
                        >
                            {copied === 'caption' ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
                        </button>
                    </div>

                    <button
                        onClick={() => setShowDescModal(true)}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-input border border-dashed border-rule text-xs lowercase text-muted hover:text-brass hover:border-rule2 transition-colors"
                    >
                        <FileText size={14} /> ver descripciones
                    </button>
                </div>

                {/* Error Message */}
                {editError && (
                    <div className="mb-3 px-3 py-2 rounded-input text-xs text-danger bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] flex items-center gap-2">
                        <AlertCircle size={14} className="shrink-0" />
                        {editError}
                    </div>
                )}

                {/* Actions Footer */}
                <div className="grid grid-cols-2 gap-2 mt-auto pt-4 border-t border-rule">
                    {onEditClip && (
                        <button
                            onClick={() => onEditClip(index)}
                            className={QUIET_BTN}
                        >
                            <Scissors size={16} className="text-muted group-hover:text-brass transition-colors shrink-0" />
                            editar clip
                        </button>
                    )}

                    {onReframeClip && (
                        <button
                            onClick={() => onReframeClip(index)}
                            className={QUIET_BTN}
                        >
                            <Crosshair size={16} className="text-muted group-hover:text-brass transition-colors shrink-0" />
                            reencuadrar
                        </button>
                    )}

                    {/* AI zooms/pans read the reframe engine's per-scene face-
                        tracking data, which only the vertical crop has — the
                        other two formats never run that engine at all. */}
                    {format === 'vertical' && (
                        <button
                            onClick={handleAutoEdit}
                            disabled={isEditing}
                            className={QUIET_BTN}
                        >
                            {isEditing ? <Loader2 size={16} className="animate-spin text-brass shrink-0" /> : <Wand2 size={16} className="text-muted group-hover:text-brass transition-colors shrink-0" />}
                            {isEditing ? 'editando…' : 'auto editar'}
                        </button>
                    )}

                    <button
                        onClick={() => setShowSubtitleModal(true)}
                        disabled={isSubtitling}
                        className={QUIET_BTN}
                    >
                        {isSubtitling ? <Loader2 size={16} className="animate-spin text-brass shrink-0" /> : <Type size={16} className="text-muted group-hover:text-brass transition-colors shrink-0" />}
                        {isSubtitling ? 'añadiendo…' : 'subtítulos'}
                    </button>

                    <button
                        onClick={() => setShowHookModal(true)}
                        disabled={isHooking}
                        className={QUIET_BTN}
                    >
                        {isHooking ? <Loader2 size={16} className="animate-spin text-brass shrink-0" /> : <Wand2 size={16} className="text-muted group-hover:text-brass transition-colors shrink-0" />}
                        {isHooking ? 'añadiendo…' : 'gancho viral'}
                    </button>

                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            // Free clips are watermarked — surface the upsell once
                            // before the first download, then get out of the way.
                            if (plan === 'free' && !watermarkNoticeDismissed()) {
                                setShowWatermarkModal(true);
                                return;
                            }
                            downloadClip();
                        }}
                        className={`${QUIET_BTN}${onEditClip ? ' col-span-2' : ''}`}
                    >
                        <Download size={16} className="text-muted group-hover:text-brass transition-colors shrink-0" /> descargar
                    </button>
                </div>

            </div>

            {/* Descriptions Modal */}
            <Modal
                isOpen={showDescModal}
                onClose={() => setShowDescModal(false)}
                eyebrow="TEXTOS GENERADOS"
                title="descripciones"
                size="md"
            >
                <div className="space-y-4">
                    <div>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                            <label className="eyebrow">TÍTULO DE YOUTUBE</label>
                            <button
                                onClick={() => handleCopy('youtube', clip.video_title_for_youtube_short || "Vídeo corto viral")}
                                aria-label="copiar título de youtube"
                                className="p-1 rounded-full text-muted hover:text-brass transition-colors shrink-0"
                            >
                                {copied === 'youtube' ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
                            </button>
                        </div>
                        <p className="text-sm text-ink2 select-all break-words bg-paper rounded-input p-3 border border-rule">
                            {clip.video_title_for_youtube_short || "Vídeo corto viral"}
                        </p>
                    </div>

                    <div>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                            <label className="eyebrow">DESCRIPCIÓN TIKTOK · IG</label>
                            <button
                                onClick={() => handleCopy('caption', clip.video_description_for_tiktok || clip.video_description_for_instagram)}
                                aria-label="copiar descripción"
                                className="p-1 rounded-full text-muted hover:text-brass transition-colors shrink-0"
                            >
                                {copied === 'caption' ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
                            </button>
                        </div>
                        <p className="text-sm text-ink2 select-all break-words bg-paper rounded-input p-3 border border-rule whitespace-pre-wrap">
                            {clip.video_description_for_tiktok || clip.video_description_for_instagram}
                        </p>
                    </div>
                </div>
            </Modal>

            <SubtitleModal
                isOpen={showSubtitleModal}
                onClose={() => setShowSubtitleModal(false)}
                onGenerate={handleSubtitle}
                onApplyAll={onBulkSubtitle ? async (options) => {
                    await onBulkSubtitle(options);
                    setShowSubtitleModal(false);
                } : undefined}
                onRemove={handleRemoveSubtitles}
                bulkCount={clipCount}
                bulkProgress={bulkProgress}
                isProcessing={isSubtitling || (bulkProgress?.running ?? false)}
                videoUrl={originalVideoUrl}
                jobId={jobId}
                clipIndex={index}
                existingHook={activeLayers.hook}
                format={format}
            />

            <HookModal
                isOpen={showHookModal}
                onClose={() => setShowHookModal(false)}
                onGenerate={handleHook}
                isProcessing={isHooking}
                videoUrl={originalVideoUrl}
                initialText={clip.viral_hook_text}
                durationInSeconds={clip.end && clip.start ? clip.end - clip.start : 30}
                existingSubtitles={activeLayers.subtitles}
            />

            {showWatermarkModal && (
                <WatermarkModal
                    onClose={() => setShowWatermarkModal(false)}
                    onContinue={downloadClip}
                />
            )}

        </div>
    );
}
