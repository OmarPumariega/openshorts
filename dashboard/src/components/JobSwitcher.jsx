import React, { useEffect, useRef, useState } from 'react';
import { Layers, Loader2, Check, AlertCircle, X, Clock } from 'lucide-react';

const STATUS_ICON = {
    processing: <Loader2 size={13} className="animate-spin text-brass shrink-0" />,
    complete: <Check size={13} className="text-ok shrink-0" />,
    error: <AlertCircle size={13} className="text-danger shrink-0" />,
    idle: <Clock size={13} className="text-muted shrink-0" />,
};

// "My jobs" — every video started this browser session (or a past one, up to
// MAX_TRACKED), each tracked independently of whichever one is currently on
// screen. Lets the user start a new upload without losing a job still
// processing in the background; click any entry to switch the main view to
// it. Purely a frontend concept (see lib/jobList.js) — the backend already
// runs jobs independently of what's focused in any browser tab.
export default function JobSwitcher({ jobs, activeJobId, onFocus, onDismiss }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [open]);

    if (!jobs.length) return null;

    const processingCount = jobs.filter((j) => j.status === 'processing').length;

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-1.5 btn-quiet px-3 py-1.5 text-xs"
                title="Switch between your videos"
            >
                <Layers size={14} />
                <span className="hidden sm:inline">my jobs</span>
                <span className="readout">{jobs.length}</span>
                {processingCount > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-brass animate-pulse" title={`${processingCount} processing`} />
                )}
            </button>

            {open && (
                <div className="absolute top-full right-0 mt-2 w-72 z-30 card overflow-hidden animate-fade">
                    <div className="max-h-80 overflow-y-auto custom-scrollbar">
                        {jobs.map((j) => (
                            <button
                                key={j.jobId}
                                onClick={() => { onFocus(j.jobId); setOpen(false); }}
                                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-rule last:border-0 transition-colors group
                                    ${j.jobId === activeJobId ? 'bg-paper3' : 'hover:bg-paper3'}`}
                            >
                                {STATUS_ICON[j.status] || STATUS_ICON.idle}
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm text-ink2 truncate">{j.title || j.jobId}</div>
                                    <div className="text-[10px] text-muted uppercase tracking-wide">{j.status}</div>
                                </div>
                                {onDismiss && (
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => { e.stopPropagation(); onDismiss(j.jobId); }}
                                        className="p-1 rounded-full text-muted opacity-0 group-hover:opacity-100 hover:text-ink hover:bg-paper2 transition-all shrink-0"
                                        title="Remove from this list (does not delete the job)"
                                    >
                                        <X size={12} />
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
