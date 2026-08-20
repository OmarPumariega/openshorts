import React, { useState, useEffect } from 'react';
import { Loader2, Download, Film, FolderOpen, Video, VideoOff, RefreshCw, Pencil } from 'lucide-react';
import { apiJson, apiFetch } from '../lib/api';
import { getApiUrl } from '../config';

// Self-host, single-user history: OUTPUT_DIR on disk IS the history, scanned
// live by GET /api/history. There is no database and no per-user scoping —
// a project simply exists as long as its output/<job_id>/ folder does, and
// disappears once cleanup_jobs() purges it (CLEANUP_RETENTION_HOURS).
export default function HistoryTab({ onOpenProject }) {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(null);
  const [openError, setOpenError] = useState('');
  const [downloadingAll, setDownloadingAll] = useState(null);

  const load = () => {
    setError('');
    apiJson('/api/history')
      .then((d) => setProjects(d.projects || []))
      .catch(() => setError('No se pudieron cargar tus proyectos.'));
  };

  useEffect(load, []);

  const handleOpen = async (jobId) => {
    if (!onOpenProject || opening) return;
    setOpening(jobId);
    setOpenError('');
    try {
      await onOpenProject(jobId);
    } catch (e) {
      setOpenError('No se pudo abrir este proyecto. Puede que sus archivos de trabajo ya se hayan eliminado.');
    } finally {
      setOpening(null);
    }
  };

  const handleDownloadAll = async (jobId) => {
    setDownloadingAll(jobId);
    try {
      const res = await apiFetch(`/api/jobs/${jobId}/download-all`);
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `openshorts_clips_${jobId.slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e) {
      alert(`Error al descargar: ${e.message}`);
    } finally {
      setDownloadingAll(null);
    }
  };

  const fmtDate = (iso) => (iso
    ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '');

  if (projects === null && !error) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-brass" /></div>;
  }

  return (
    <div className="h-full overflow-y-auto p-8 max-w-6xl mx-auto animate-fade">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <p className="eyebrow mb-1.5">02 · HISTORIAL</p>
          <h1 className="font-display lowercase text-2xl text-ink">Tus proyectos</h1>
        </div>
        <button onClick={load} className="btn-quiet px-3 py-2 text-xs shrink-0" title="actualizar">
          <RefreshCw size={14} /> actualizar
        </button>
      </div>
      <p className="text-muted text-sm mb-8 lowercase">
        Todos los vídeos que has procesado, leídos directamente del disco — no hay una base de datos aparte.
        Los proyectos se conservan durante una ventana limitada (configurada mediante
        <code className="font-mono text-ink2">CLEANUP_RETENTION_HOURS</code>, normalmente 24–48h) y después sus
        archivos se eliminan automáticamente para mantener el servidor ordenado.
      </p>

      {error && <p className="text-danger text-sm mb-4">{error}</p>}
      {openError && <p className="text-danger text-sm mb-4">{openError}</p>}

      {projects && projects.length === 0 && (
        <div className="text-center py-20 text-muted">
          <Film size={40} className="mx-auto mb-4 text-muted" />
          <p className="lowercase">Aún no hay proyectos. Genera tu primer short desde el Generador de clips.</p>
        </div>
      )}

      <div className="space-y-6">
        {(projects || []).map((project) => (
          <section key={project.job_id} className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-rule">
              <div className="min-w-0">
                <p className="text-sm text-ink font-medium truncate" title={project.title}>
                  {project.title}
                </p>
                <p className="readout mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>{fmtDate(project.created_at)}</span>
                  <span>·</span>
                  <span>{project.clip_count} clip{project.clip_count === 1 ? '' : 's'}</span>
                  <span>·</span>
                  {project.source_available ? (
                    <span className="text-ok flex items-center gap-1"><Video size={12} /> original disponible</span>
                  ) : (
                    <span className="text-muted flex items-center gap-1"><VideoOff size={12} /> original eliminado</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {project.source_available && (
                  <a
                    href={getApiUrl(`/api/source/${project.job_id}`)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost px-3 py-2 text-xs"
                    title="Reproducir el vídeo original"
                  >
                    <Video size={14} /> original
                  </a>
                )}
                {project.clip_count > 0 && (
                  <button
                    onClick={() => handleDownloadAll(project.job_id)}
                    disabled={downloadingAll === project.job_id}
                    className="btn-ghost px-3 py-2 text-xs"
                    title="Descargar todos los clips como ZIP"
                  >
                    {downloadingAll === project.job_id
                      ? <><Loader2 size={14} className="animate-spin" /> comprimiendo…</>
                      : <><Download size={14} /> todos los clips</>}
                  </button>
                )}
                {onOpenProject && (
                  <button
                    onClick={() => handleOpen(project.job_id)}
                    disabled={!!opening}
                    className="btn-primary px-3 py-2 text-xs"
                    title="Reabrir este proyecto en el editor completo del Generador de clips — subtítulos, reencuadre, gancho, todo"
                  >
                    {opening === project.job_id
                      ? <><Loader2 size={14} className="animate-spin" /> abriendo…</>
                      : <><Pencil size={14} /> abrir para editar</>}
                  </button>
                )}
              </div>
            </div>

            {project.clips.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 p-4">
                {project.clips.map((clip) => (
                  <div key={clip.index} className="rounded-input overflow-hidden border border-rule bg-paper group relative">
                    <div className="aspect-[9/16] bg-black">
                      {clip.video_url ? (
                        <video
                          src={getApiUrl(clip.video_url)}
                          controls
                          preload="metadata"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted">
                          <VideoOff size={20} />
                        </div>
                      )}
                      {/* Same target as the project-level "open to edit" button —
                          a per-clip path into the editor for people who land on a
                          clip first and don't notice the header button. Sits above
                          the video but out of the way of its native play controls. */}
                      {onOpenProject && (
                        <button
                          onClick={() => handleOpen(project.job_id)}
                          disabled={!!opening}
                          className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-paper/90 text-ink2 opacity-0 group-hover:opacity-100 hover:text-brass hover:bg-paper transition-all"
                          title="Abrir este proyecto para editar — subtítulos, reencuadre, gancho"
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-xs text-ink2 line-clamp-2 mb-1.5" title={clip.title}>
                        {clip.title || `Clip ${clip.index + 1}`}
                      </p>
                      {clip.video_url && (
                        <a
                          href={getApiUrl(clip.video_url)}
                          download
                          className="text-micro font-mono uppercase text-brass hover:text-ink flex items-center gap-1 transition-colors"
                        >
                          <Download size={12} /> vertical
                        </a>
                      )}
                      {/* The other two formats every clip ships in alongside
                          the vertical crop above — plain downloads, omitted
                          for clips from before this shipped. */}
                      {clip.video_url_horizontal && (
                        <a
                          href={getApiUrl(clip.video_url_horizontal)}
                          download
                          className="text-micro font-mono uppercase text-muted hover:text-ink flex items-center gap-1 transition-colors mt-1"
                        >
                          <Download size={12} /> girar móvil
                        </a>
                      )}
                      {clip.video_url_letterboxed && (
                        <a
                          href={getApiUrl(clip.video_url_letterboxed)}
                          download
                          className="text-micro font-mono uppercase text-muted hover:text-ink flex items-center gap-1 transition-colors mt-1"
                        >
                          <Download size={12} /> encajado
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted p-4 lowercase">No quedan archivos de clips para este proyecto.</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
