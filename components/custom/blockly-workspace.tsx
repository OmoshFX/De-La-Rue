'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as Blockly from 'blockly';
import {
  Undo2, Redo2, AlignLeft, Save, Download, Upload, RotateCcw, Sparkles,
} from 'lucide-react';
import { defineBlocks, TOOLBOX, STARTER_XML } from '@/lib/bot-blocks';
import { parseWorkspace, type ParseResult } from '@/lib/bot-strategy';
import { PRESETS } from '@/lib/bot-presets';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

const STORAGE_KEY = 'bot_builder_workspace';

interface BlocklyWorkspaceProps {
  /** Fires on every workspace change, with the strategy parsed out of it. */
  onChange: (result: ParseResult) => void;
}

function ToolButton({
  onClick, title, children,
}: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
    >
      {children}
    </button>
  );
}

export function BlocklyWorkspace({ onChange }: BlocklyWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const onChangeRef = useRef(onChange);
  const [saved, setSaved] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);

  // Kept in a ref so re-renders don't tear down and rebuild the workspace.
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;

    defineBlocks();

    const workspace = Blockly.inject(containerRef.current, {
      toolbox: TOOLBOX,
      grid: { spacing: 24, length: 3, colour: '#e5e7eb', snap: true },
      zoom: { controls: true, wheel: true, startScale: 0.9, maxScale: 2, minScale: 0.4 },
      trashcan: true,
      move: { scrollbars: true, drag: true, wheel: false },
    });
    workspaceRef.current = workspace;

    // Restore the last session, falling back to a working starter strategy so
    // the canvas is never blank on a first visit.
    let xml = STARTER_XML;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) xml = stored;
    } catch {
      // Storage can be blocked; the starter strategy is a fine fallback.
    }

    try {
      Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), workspace);
    } catch {
      workspace.clear();
      Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(STARTER_XML), workspace);
    }

    const handleChange = (event: Blockly.Events.Abstract) => {
      // UI events (scroll, zoom, selection) don't alter the strategy.
      if (event.isUiEvent) return;
      onChangeRef.current(parseWorkspace(workspace));
    };

    workspace.addChangeListener(handleChange);
    onChangeRef.current(parseWorkspace(workspace));

    // Blockly measures its container on injection, so a container that was
    // hidden or resized afterwards needs a nudge.
    const observer = new ResizeObserver(() => Blockly.svgResize(workspace));
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      workspace.removeChangeListener(handleChange);
      workspace.dispose();
      workspaceRef.current = null;
    };
  }, []);

  const loadXml = useCallback((xml: string) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    try {
      workspace.clear();
      Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), workspace);
      workspace.cleanUp();
    } catch {
      alert('That strategy could not be loaded.');
    }
  }, []);

  const save = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    try {
      localStorage.setItem(STORAGE_KEY, Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace)));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Nothing useful to do if storage is unavailable.
    }
  }, []);

  const download = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const xml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));
    const url = URL.createObjectURL(new Blob([xml], { type: 'text/xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'strategy.xml';
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const upload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => loadXml(String(reader.result));
    reader.readAsText(file);
  }, [loadXml]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b bg-background px-2 py-1.5">
        <Popover open={presetsOpen} onOpenChange={setPresetsOpen}>
          <PopoverTrigger asChild>
            <button className="mr-1 flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background">
              <Sparkles className="h-3.5 w-3.5" /> Quick strategy
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-2">
            <p className="px-2 pb-2 text-xs uppercase tracking-wider text-muted-foreground">
              Load a prebuilt strategy
            </p>
            <div className="space-y-1">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => { loadXml(preset.xml); setPresetsOpen(false); }}
                  className="w-full rounded-md px-2 py-2 text-left hover:bg-muted transition-colors"
                >
                  <span className="block text-sm font-medium">{preset.name}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {preset.description}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 border-t px-2 pt-2 text-xs text-muted-foreground">
              Loading a strategy replaces what is on the canvas.
            </p>
          </PopoverContent>
        </Popover>

        <span className="mx-1 h-5 w-px bg-border" />

        <ToolButton onClick={() => workspaceRef.current?.undo(false)} title="Undo">
          <Undo2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => workspaceRef.current?.undo(true)} title="Redo">
          <Redo2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => workspaceRef.current?.cleanUp()} title="Tidy blocks">
          <AlignLeft className="h-4 w-4" />
        </ToolButton>

        <span className="mx-1 h-5 w-px bg-border" />

        <ToolButton onClick={save} title={saved ? 'Saved' : 'Save to this browser'}>
          <Save className={`h-4 w-4 ${saved ? 'text-emerald-600' : ''}`} />
        </ToolButton>
        <ToolButton onClick={download} title="Export as XML">
          <Download className="h-4 w-4" />
        </ToolButton>
        <label
          title="Import XML"
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Upload className="h-4 w-4" />
          <input
            type="file"
            accept=".xml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = '';
            }}
          />
        </label>

        <ToolButton
          onClick={() => {
            loadXml(STARTER_XML);
            try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
          }}
          title="Reset to starter strategy"
        >
          <RotateCcw className="h-4 w-4" />
        </ToolButton>
      </div>
      <div ref={containerRef} className="min-h-[420px] flex-1" />
    </div>
  );
}
