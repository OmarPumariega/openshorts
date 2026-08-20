import React, { useState, useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import RemotionPreview from './RemotionPreview';
import Modal from './ui/Modal';
import SegmentedControl from './ui/SegmentedControl';
import {
    FONT_OPTIONS, COLOR_PRESETS, HIGHLIGHT_PRESETS, CAPTION_PRESETS,
    FACTORY_DEFAULT_STYLE, loadDefaultStyle, saveDefaultStyle,
    loadCustomPresets, saveCustomPreset, deleteCustomPreset, updateCustomPreset, customPresetToStyle,
} from '../lib/subtitleStyle';

const ANIMATION_OPTIONS = [
    { value: 'pop', label: 'Rebote' },
    { value: 'word-highlight', label: 'Brillo' },
    { value: 'karaoke', label: 'Karaoke' },
    { value: 'none', label: 'Ninguna' },
];

const POSITION_OPTIONS = [
    { value: 'top', label: 'arriba' },
    { value: 'middle', label: 'medio' },
    { value: 'bottom', label: 'abajo' },
];

const swatchClass = (selected) =>
    `w-6 h-6 rounded-full transition-all ${selected
        ? 'ring-2 ring-[color:var(--color-accent)] ring-offset-2 ring-offset-[color:var(--color-paper-2)]'
        : 'ring-1 ring-[color:var(--color-rule-2)] hover:ring-[color:var(--color-accent)]'}`;

export default function SubtitleModal({ isOpen, onClose, onGenerate, onApplyAll, onRemove, isProcessing, videoUrl, jobId, clipIndex, existingHook, bulkCount = 0, bulkProgress }) {
    // Start from the user's saved default profile (Settings > Default
    // subtitle style) when one exists, so per-clip editing begins from their
    // baseline instead of the generic factory look every time.
    const initial = loadDefaultStyle() || FACTORY_DEFAULT_STYLE;

    const [position, setPosition] = useState(initial.position);
    const [fontSize, setFontSize] = useState(initial.fontSize);
    const [fontName, setFontName] = useState(initial.fontName);
    const [fontColor, setFontColor] = useState(initial.fontColor);
    const [highlightColor, setHighlightColor] = useState(initial.highlightColor);
    const [borderColor, setBorderColor] = useState(initial.borderColor);
    const [borderWidth, setBorderWidth] = useState(initial.borderWidth);
    const [bgColor, setBgColor] = useState(initial.bgColor);
    const [bgOpacity, setBgOpacity] = useState(initial.bgOpacity);
    const [animation, setAnimation] = useState('pop');
    const [showTextEditor, setShowTextEditor] = useState(false);

    // Karaoke (server-side ASS burn) state
    const [style, setStyle] = useState(initial.style); // classic | karaoke
    const [effect, setEffect] = useState(initial.effect); // none | glow | pop | box
    const [baseOpacity, setBaseOpacity] = useState(initial.baseOpacity);
    const [uppercase, setUppercase] = useState(initial.uppercase);
    const [activePreset, setActivePreset] = useState(initial.presetId);
    const [defaultSaved, setDefaultSaved] = useState(false);

    // User-named custom presets (Settings > Default subtitle style also
    // reads/writes this same localStorage list — either screen can create or
    // delete them and both stay in sync on next open).
    const [customPresets, setCustomPresets] = useState(() => loadCustomPresets());
    const [showNameInput, setShowNameInput] = useState(false);
    const [presetName, setPresetName] = useState('');
    const [presetUpdated, setPresetUpdated] = useState(false);

    const currentStyleFields = () => ({
        position, fontSize, fontName, fontColor, highlightColor,
        borderColor, borderWidth, bgColor, bgOpacity,
        style, effect, baseOpacity, uppercase,
    });

    // activePreset stays set through manual tweaks here (unlike Settings'
    // DefaultStyleEditor, no control below clears it) — so as long as it
    // still names one of our custom presets, that's the one being edited.
    const editingPreset = customPresets.find((p) => p.id === activePreset) || null;
    const presetDirty = editingPreset && (() => {
        const { presetId: _b, ...stored } = customPresetToStyle(editingPreset);
        return JSON.stringify(currentStyleFields()) !== JSON.stringify(stored);
    })();

    const applyCustomPreset = (p) => {
        const s = customPresetToStyle(p);
        setActivePreset(s.presetId);
        setPosition(s.position);
        setFontSize(s.fontSize);
        setFontName(s.fontName);
        setFontColor(s.fontColor);
        setHighlightColor(s.highlightColor);
        setBorderColor(s.borderColor);
        setBorderWidth(s.borderWidth);
        setBgColor(s.bgColor);
        setBgOpacity(s.bgOpacity);
        setStyle(s.style);
        setEffect(s.effect);
        setBaseOpacity(s.baseOpacity);
        setUppercase(s.uppercase);
        setAnimation(s.style === 'karaoke' ? (s.effect === 'pop' ? 'pop' : s.effect === 'glow' ? 'word-highlight' : 'karaoke') : 'none');
    };

    const handleSaveCustomPreset = () => {
        const name = presetName.trim();
        if (!name) return;
        const preset = saveCustomPreset(name, currentStyleFields());
        setCustomPresets((prev) => [...prev, preset]);
        setActivePreset(preset.id);
        setPresetName('');
        setShowNameInput(false);
    };

    const handleUpdatePreset = () => {
        if (!editingPreset) return;
        setCustomPresets(updateCustomPreset(editingPreset.id, currentStyleFields()));
        setPresetUpdated(true);
        setTimeout(() => setPresetUpdated(false), 2000);
    };

    const handleDeleteCustomPreset = (id) => {
        setCustomPresets(deleteCustomPreset(id));
        if (activePreset === id) setActivePreset(null);
    };

    const applyPreset = (p) => {
        setActivePreset(p.id);
        setStyle(p.style);
        setEffect(p.effect);
        setHighlightColor(p.highlightColor);
        setBaseOpacity(p.baseOpacity);
        setUppercase(p.uppercase);
        setFontName(p.fontName);
        setBorderWidth(p.borderWidth);
        setFontColor('#FFFFFF');
        setBgOpacity(0);
        // Keep the Remotion preview roughly in sync with the burned look
        setAnimation(p.style === 'karaoke' ? (p.effect === 'pop' ? 'pop' : p.effect === 'glow' ? 'word-highlight' : 'karaoke') : 'none');
    };

    // Remotion preview state
    const [captions, setCaptions] = useState([]);
    const [originalCaptions, setOriginalCaptions] = useState([]);
    const [editableText, setEditableText] = useState('');
    const [durationSec, setDurationSec] = useState(30);
    const [captionsLoading, setCaptionsLoading] = useState(false);
    const [useRemotionPreview, setUseRemotionPreview] = useState(false);

    // Fetch word-level captions when modal opens
    useEffect(() => {
        if (!isOpen || !jobId || clipIndex === undefined) return;

        setCaptionsLoading(true);
        apiFetch(`/api/clip/${jobId}/${clipIndex}/transcript`)
            .then((res) => res.ok ? res.json() : null)
            .then((data) => {
                if (data && data.captions && data.captions.length > 0) {
                    setCaptions(data.captions);
                    setOriginalCaptions(data.captions);
                    setEditableText(data.captions.map(c => c.text).join(' '));
                    setDurationSec(data.durationSec || 30);
                    setUseRemotionPreview(true);
                } else {
                    setUseRemotionPreview(false);
                }
            })
            .catch(() => setUseRemotionPreview(false))
            .finally(() => setCaptionsLoading(false));
    }, [isOpen, jobId, clipIndex]);

    // When user edits text, redistribute words across original timestamps
    const handleTextEdit = (newText) => {
        setEditableText(newText);
        const newWords = newText.split(/\s+/).filter(w => w.length > 0);
        if (newWords.length === 0 || originalCaptions.length === 0) {
            setCaptions([]);
            return;
        }

        // Distribute new words across the time span of original captions
        const totalDurationMs = originalCaptions[originalCaptions.length - 1].endMs - originalCaptions[0].startMs;
        const startMs = originalCaptions[0].startMs;
        const wordDurationMs = totalDurationMs / newWords.length;

        const newCaptions = newWords.map((word, i) => ({
            text: word,
            startMs: Math.round(startMs + i * wordDurationMs),
            endMs: Math.round(startMs + (i + 1) * wordDurationMs),
        }));
        setCaptions(newCaptions);
    };

    if (!isOpen) return null;

    // Build subtitle config for Remotion
    const subtitleConfig = {
        captions,
        position,
        style: {
            fontFamily: fontName,
            fontSize: fontSize * 2.2, // Scale up for 1080p (modal fontSize is for small preview)
            fontColor,
            highlightColor,
            borderColor,
            borderWidth: borderWidth * 1.5,
            bgColor,
            bgOpacity,
            animation,
            // Karaoke look reflected live in the playable preview.
            baseOpacity: style === 'karaoke' ? baseOpacity : 1,
            uppercase: style === 'karaoke' ? uppercase : false,
        },
    };

    // Fallback: static CSS preview (same as original)
    const bw = Math.max(borderWidth, 0);
    const bc = borderColor;
    const outlineShadow = bw > 0 ? [
        `-${bw}px -${bw}px 0 ${bc}`, `${bw}px -${bw}px 0 ${bc}`,
        `-${bw}px ${bw}px 0 ${bc}`, `${bw}px ${bw}px 0 ${bc}`,
        `0 -${bw}px 0 ${bc}`, `0 ${bw}px 0 ${bc}`,
        `-${bw}px 0 0 ${bc}`, `${bw}px 0 0 ${bc}`,
    ].join(', ') : 'none';

    const fallbackPreviewStyle = {
        fontFamily: fontName,
        color: fontColor,
        fontSize: '20px',
        fontWeight: 'bold',
        maxWidth: '85%',
        padding: '6px 12px',
        borderRadius: '4px',
        textAlign: 'center',
        lineHeight: '1.3',
        ...(bgOpacity > 0
            ? {
                backgroundColor: `${bgColor}${Math.round(bgOpacity * 255).toString(16).padStart(2, '0')}`,
                textShadow: 'none',
            }
            : { textShadow: outlineShadow }
        ),
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="xl" eyebrow="EDITOR · SUBTÍTULOS" title="subtítulos">
            <div className="flex flex-col md:flex-row gap-6">
                {/* Left: Preview */}
                <div className="flex-1 flex flex-col items-center justify-center bg-black rounded-card border border-rule overflow-hidden relative aspect-[9/16] max-h-[600px]">
                    {captionsLoading ? (
                        <div className="flex items-center gap-2 text-muted">
                            <Loader2 size={16} className="animate-spin" />
                            <span className="text-sm lowercase">Cargando vista previa...</span>
                        </div>
                    ) : useRemotionPreview ? (
                        <RemotionPreview
                            videoUrl={videoUrl}
                            durationInSeconds={durationSec}
                            subtitles={subtitleConfig}
                            hook={existingHook || null}
                        />
                    ) : (
                        <>
                            <video src={videoUrl} className="w-full h-full object-contain opacity-50" muted playsInline />
                            <div className={`absolute w-full px-8 text-center transition-all duration-300 pointer-events-none flex flex-col items-center justify-center
                                ${position === 'top' ? 'top-20' : ''}
                                ${position === 'middle' ? 'top-0 bottom-0' : ''}
                                ${position === 'bottom' ? 'bottom-20' : ''}
                            `}>
                                <span style={fallbackPreviewStyle}>
                                    Así se verán tus subtítulos<br/>en el vídeo
                                </span>
                            </div>
                        </>
                    )}
                </div>

                {/* Right: Controls */}
                <div className="w-full md:w-80 flex flex-col">
                    <div className="space-y-5 flex-1 overflow-y-auto custom-scrollbar pr-1">
                        {/* Caption presets (server-side karaoke burn) */}
                        <div>
                            <p className="eyebrow mb-2">Preset</p>
                            <div className="grid grid-cols-3 gap-1.5">
                                {CAPTION_PRESETS.map((p) => (
                                    <button
                                        key={p.id}
                                        onClick={() => applyPreset(p)}
                                        className={`px-2 py-1.5 rounded-input border text-xs transition-colors flex items-center gap-1.5 justify-center
                                            ${activePreset === p.id
                                                ? 'border-[color:var(--color-accent)] text-ink'
                                                : 'border-rule2 text-muted hover:border-[color:var(--color-accent)]'}`}
                                        title={p.label}
                                    >
                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.highlightColor }} />
                                        {p.label}
                                    </button>
                                ))}
                            </div>

                            {/* Custom presets — user-named, saved from the current style below */}
                            {customPresets.length > 0 && (
                                <div className="mt-2">
                                    <div className="grid grid-cols-3 gap-1.5">
                                        {customPresets.map((p) => (
                                            <div key={p.id} className="relative group">
                                                <button
                                                    onClick={() => applyCustomPreset(p)}
                                                    className={`w-full px-2 py-1.5 rounded-input border text-xs transition-colors flex items-center gap-1.5 justify-center
                                                        ${activePreset === p.id
                                                            ? 'border-[color:var(--color-accent)] text-ink'
                                                            : 'border-rule2 text-muted hover:border-[color:var(--color-accent)]'}`}
                                                    title={p.label}
                                                >
                                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.highlightColor }} />
                                                    <span className="truncate">{p.label}</span>
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteCustomPreset(p.id)}
                                                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[color:var(--color-paper-2)] border border-rule2 text-muted hover:text-red-500 hover:border-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                    title={`Borrar "${p.label}"`}
                                                >
                                                    <X size={10} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Update the preset currently loaded, if the controls below
                                have since been tweaked away from it */}
                            {editingPreset && (
                                <button
                                    onClick={handleUpdatePreset}
                                    disabled={!presetDirty}
                                    className="mt-2 w-full btn-primary text-xs py-2 disabled:opacity-50"
                                    title={presetDirty ? `Sobrescribir "${editingPreset.label}" con el estilo actual` : 'No hay cambios que guardar'}
                                >
                                    {presetUpdated ? `✓ "${editingPreset.label}" actualizado` : `guardar cambios en "${editingPreset.label}"`}
                                </button>
                            )}

                            {/* Save current style as a named custom preset */}
                            <div className="mt-2">
                                {showNameInput ? (
                                    <div className="flex gap-1.5 animate-fade">
                                        <input
                                            type="text"
                                            autoFocus
                                            value={presetName}
                                            onChange={(e) => setPresetName(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleSaveCustomPreset();
                                                if (e.key === 'Escape') { setShowNameInput(false); setPresetName(''); }
                                            }}
                                            placeholder="nombre del preset…"
                                            maxLength={30}
                                            className="input-field flex-1 text-xs"
                                        />
                                        <button onClick={handleSaveCustomPreset} disabled={!presetName.trim()} className="btn-primary px-3 text-xs disabled:opacity-50">
                                            crear
                                        </button>
                                        <button onClick={() => { setShowNameInput(false); setPresetName(''); }} className="btn-ghost px-3 text-xs">
                                            cancelar
                                        </button>
                                    </div>
                                ) : (
                                    <button onClick={() => setShowNameInput(true)} className="w-full btn-ghost text-xs py-2">
                                        + crear preset con el estilo actual
                                    </button>
                                )}
                            </div>

                            <button
                                onClick={() => {
                                    saveDefaultStyle({
                                        position, fontSize, fontName, fontColor, highlightColor,
                                        borderColor, borderWidth, bgColor, bgOpacity,
                                        style, effect, baseOpacity, uppercase, presetId: activePreset,
                                    });
                                    setDefaultSaved(true);
                                    setTimeout(() => setDefaultSaved(false), 2000);
                                }}
                                className="mt-2 w-full text-xs text-muted hover:text-brass transition-colors flex items-center justify-center gap-1.5 py-1"
                                title="Usa este estilo para todos los vídeos nuevos a partir de ahora (Ajustes > Estilo de subtítulos por defecto)"
                            >
                                {defaultSaved ? '✓ guardado como mi estilo por defecto' : 'guardar como mi estilo por defecto'}
                            </button>
                            {style === 'karaoke' && (
                                <div className="mt-3 space-y-3 animate-fade">
                                    <div className="flex items-center justify-between">
                                        <span className="readout">MAYÚSCULAS</span>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" checked={uppercase} onChange={(e) => setUppercase(e.target.checked)} className="sr-only peer" />
                                            <div className="w-8 h-4 rounded-full bg-paper3 peer-checked:bg-brass transition-colors after:content-[''] after:absolute after:top-0 after:left-0 after:h-4 after:w-4 after:rounded-full after:bg-ink after:transition-all peer-checked:after:translate-x-full"></div>
                                        </label>
                                    </div>
                                    <div>
                                        <div className="flex justify-between mb-1">
                                            <span className="readout">Atenuar palabras inactivas</span>
                                            <span className="readout">{Math.round(baseOpacity * 100)}%</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="30"
                                            max="100"
                                            value={Math.round(baseOpacity * 100)}
                                            onChange={(e) => setBaseOpacity(parseInt(e.target.value) / 100)}
                                            className="w-full accent-[var(--color-accent)]"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Position Selector */}
                        <div>
                            <p className="eyebrow mb-2">Posición</p>
                            <SegmentedControl
                                options={POSITION_OPTIONS}
                                value={position}
                                onChange={setPosition}
                                size="sm"
                            />
                        </div>

                        {/* Animation Style (new) */}
                        <div>
                            <p className="eyebrow mb-2">Animación</p>
                            <SegmentedControl
                                options={ANIMATION_OPTIONS}
                                value={animation}
                                onChange={setAnimation}
                                columns={2}
                                size="sm"
                            />
                        </div>

                        {/* Editable Transcript (collapsible) */}
                        {useRemotionPreview && (
                            <div>
                                <button
                                    type="button"
                                    onClick={() => setShowTextEditor(!showTextEditor)}
                                    className="w-full flex items-center justify-between mb-2"
                                >
                                    <span className="eyebrow">Editar texto ({captions.length} palabras)</span>
                                    <span className={`text-muted transition-transform ${showTextEditor ? 'rotate-180' : ''}`}>▾</span>
                                </button>
                                {showTextEditor && (
                                    <textarea
                                        value={editableText}
                                        onChange={(e) => handleTextEdit(e.target.value)}
                                        rows={5}
                                        className="input-field resize-none leading-relaxed animate-fade"
                                        placeholder="Edita el texto de los subtítulos..."
                                    />
                                )}
                            </div>
                        )}

                        {/* Font Family */}
                        <div>
                            <p className="eyebrow mb-2">Fuente</p>
                            <select
                                value={fontName}
                                onChange={(e) => setFontName(e.target.value)}
                                className="input-field"
                            >
                                {FONT_OPTIONS.map((f) => (
                                    <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Text Color */}
                        <div>
                            <p className="eyebrow mb-2">Color del texto</p>
                            <div className="flex flex-wrap items-center gap-2.5">
                                {COLOR_PRESETS.map((c) => (
                                    <button
                                        key={c.color}
                                        onClick={() => setFontColor(c.color)}
                                        className={swatchClass(fontColor === c.color)}
                                        style={{ backgroundColor: c.color }}
                                        title={c.label}
                                    />
                                ))}
                                <label className="w-6 h-6 rounded-full border border-dashed border-rule2 cursor-pointer flex items-center justify-center hover:border-brass transition-colors overflow-hidden relative" title="Color personalizado">
                                    <span className="text-xs text-muted leading-none">+</span>
                                    <input type="color" value={fontColor} onChange={(e) => setFontColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                </label>
                            </div>
                        </div>

                        {/* Highlight Color (new) */}
                        <div>
                            <p className="eyebrow mb-2">Resaltado</p>
                            <div className="flex flex-wrap items-center gap-2.5">
                                {HIGHLIGHT_PRESETS.map((c) => (
                                    <button
                                        key={c.color}
                                        onClick={() => setHighlightColor(c.color)}
                                        className={swatchClass(highlightColor === c.color)}
                                        style={{ backgroundColor: c.color }}
                                        title={c.label}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Size */}
                        <div>
                            <div className="flex justify-between mb-1">
                                <p className="eyebrow">Tamaño</p>
                                <span className="readout">{fontSize}px</span>
                            </div>
                            <input
                                type="range"
                                min="14"
                                max="48"
                                value={fontSize}
                                onChange={(e) => setFontSize(parseInt(e.target.value))}
                                className="w-full accent-[var(--color-accent)]"
                            />
                        </div>

                        {/* Border / Outline */}
                        <div>
                            <p className="eyebrow mb-2">Borde</p>
                            <div className="flex items-center gap-3">
                                <label className="relative w-8 h-8 rounded-input border border-rule2 cursor-pointer overflow-hidden shrink-0" title="Color del borde">
                                    <div className="w-full h-full" style={{ backgroundColor: borderColor }} />
                                    <input type="color" value={borderColor} onChange={(e) => setBorderColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                </label>
                                <div className="flex-1">
                                    <input
                                        type="range"
                                        min="0"
                                        max="5"
                                        value={borderWidth}
                                        onChange={(e) => setBorderWidth(parseInt(e.target.value))}
                                        className="w-full accent-[var(--color-accent)]"
                                    />
                                    <div className="flex justify-between">
                                        <span className="readout">Ninguno</span>
                                        <span className="readout">Grueso</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Background Box */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <p className="eyebrow">Fondo</p>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" checked={bgOpacity > 0} onChange={(e) => setBgOpacity(e.target.checked ? 0.5 : 0)} className="sr-only peer" />
                                    <div className="w-8 h-4 rounded-full bg-paper3 peer-checked:bg-brass transition-colors after:content-[''] after:absolute after:top-0 after:left-0 after:h-4 after:w-4 after:rounded-full after:bg-ink after:transition-all peer-checked:after:translate-x-full"></div>
                                </label>
                            </div>
                            {bgOpacity > 0 && (
                                <div className="space-y-3 animate-fade">
                                    <div className="flex items-center gap-3">
                                        <label className="relative w-8 h-8 rounded-input border border-rule2 cursor-pointer overflow-hidden shrink-0" title="Color de fondo">
                                            <div className="w-full h-full" style={{ backgroundColor: bgColor }} />
                                            <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                        </label>
                                        <div className="flex-1">
                                            <input
                                                type="range"
                                                min="10"
                                                max="100"
                                                value={Math.round(bgOpacity * 100)}
                                                onChange={(e) => setBgOpacity(parseInt(e.target.value) / 100)}
                                                className="w-full accent-[var(--color-accent)]"
                                            />
                                            <div className="flex justify-between">
                                                <span className="readout">Transparente</span>
                                                <span className="readout">{Math.round(bgOpacity * 100)}%</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="mt-5 shrink-0 space-y-2">
                        {(() => {
                            // Text edits must survive the server render path too
                            // (issue #69): send the edited words whenever the text
                            // differs from what the transcript produced.
                            const textEdited = originalCaptions.length > 0
                                && editableText.trim() !== originalCaptions.map((c) => c.text).join(' ').trim();
                            const styleOptions = {
                                position, fontSize, fontName, fontColor, borderColor, borderWidth, bgColor, bgOpacity,
                                // Karaoke burn (server-side ASS render)
                                style, effect, baseOpacity, uppercase, highlightColor,
                                // Remotion data
                                remotion: useRemotionPreview ? subtitleConfig : null,
                                captions: textEdited ? captions : null,
                            };
                            const bulkRunning = bulkProgress?.running;
                            return (
                                <>
                                    <div className="flex gap-2">
                                        <button onClick={onClose} className="btn-ghost">
                                            cancelar
                                        </button>
                                        <button
                                            onClick={() => onGenerate(styleOptions)}
                                            disabled={isProcessing}
                                            className="btn-primary flex-1"
                                        >
                                            {(isProcessing && !bulkRunning) && <Loader2 size={16} className="animate-spin text-brassink" />}
                                            {(isProcessing && !bulkRunning) ? 'generando...' : 'aplicar a este clip'}
                                        </button>
                                    </div>
                                    {onApplyAll && bulkCount > 1 && (
                                        <button
                                            onClick={() => onApplyAll({ ...styleOptions, captions: null })}
                                            disabled={isProcessing}
                                            className="btn-ghost w-full flex items-center justify-center gap-2"
                                        >
                                            {bulkRunning
                                                ? <><Loader2 size={16} className="animate-spin" />aplicando a todos… {bulkProgress.current}/{bulkProgress.total}</>
                                                : `aplicar este estilo a los ${bulkCount} clips`}
                                        </button>
                                    )}
                                    {/* Clips ship captioned by default, so the way
                                        out has to be here — otherwise a user who
                                        doesn't want captions is stuck with them. */}
                                    {onRemove && (
                                        <button
                                            onClick={onRemove}
                                            disabled={isProcessing}
                                            className="text-xs text-muted underline underline-offset-2 lowercase hover:text-ink2 disabled:opacity-50"
                                        >
                                            quitar subtítulos de este clip
                                        </button>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
