import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Sliders, Play, Pause, Download, Wand2, Grid, MousePointer2, AlertCircle } from 'lucide-react';
import { FrameConfig, GridDimensions, AppMode } from './types';
import { generateSpriteSheet } from './services/geminiService';
import { getGifWorkerUrl } from './utils/gifWorker';

declare global {
  interface Window {
    GIF: any;
  }
}

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.EDIT);
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [grid, setGrid] = useState<GridDimensions>({ rows: 1, cols: 1 });
  const [frames, setFrames] = useState<FrameConfig[]>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<number | null>(null);
  const [fps, setFps] = useState<number>(8);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [previewFrameIndex, setPreviewFrameIndex] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [prompt, setPrompt] = useState<string>('A cute pixel art robot walking');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [generationSuccess, setGenerationSuccess] = useState<boolean>(false);

  // References
  const imgRef = useRef<HTMLImageElement>(new Image());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load image when source changes
  useEffect(() => {
    if (sourceImage) {
      const img = imgRef.current;
      img.src = sourceImage;
      img.onload = () => {
        calculateFrames();
      };
    }
  }, [sourceImage, grid]);

  const calculateFrames = () => {
    if (!imgRef.current.complete) return;
    
    const imgWidth = imgRef.current.width;
    const imgHeight = imgRef.current.height;
    const frameWidth = imgWidth / grid.cols;
    const frameHeight = imgHeight / grid.rows;

    // If frames already exist, try to preserve offsets if count matches
    setFrames(prev => {
        const newFrames: FrameConfig[] = [];
        let idCounter = 0;
        for (let r = 0; r < grid.rows; r++) {
            for (let c = 0; c < grid.cols; c++) {
                const existing = prev.find(p => p.id === idCounter);
                newFrames.push({
                    id: idCounter,
                    row: r,
                    col: c,
                    x: c * frameWidth,
                    y: r * frameHeight,
                    width: frameWidth,
                    height: frameHeight,
                    offsetX: existing ? existing.offsetX : 0,
                    offsetY: existing ? existing.offsetY : 0,
                });
                idCounter++;
            }
        }
        return newFrames;
    });
    setPreviewFrameIndex(0);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setSourceImage(ev.target?.result as string);
        setMode(AppMode.EDIT);
        setGenerationSuccess(false);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerate = async () => {
    if (!prompt) return;
    setIsGenerating(true);
    setErrorMsg(null);
    try {
      const base64Image = await generateSpriteSheet(prompt);
      setSourceImage(base64Image);
      // Auto-guess grid for nano banana (often 3x3 or 4x4 for simple sprites)
      // We start with 3x3 as a safe bet for sprite sheets
      setGrid({ rows: 3, cols: 3 }); 
      setMode(AppMode.EDIT);
      setGenerationSuccess(true);
    } catch (err: any) {
      setErrorMsg("Failed to generate: " + (err.message || "Unknown error"));
    } finally {
      setIsGenerating(false);
    }
  };

  // Preview Loop
  useEffect(() => {
    if (!isPlaying || frames.length === 0) return;

    const interval = setInterval(() => {
      setPreviewFrameIndex(current => (current + 1) % frames.length);
    }, 1000 / fps);

    return () => clearInterval(interval);
  }, [isPlaying, fps, frames.length]);

  // Render Editor Canvas (Grid & Selection)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceImage || !frames.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = imgRef.current;
    
    // Resize canvas to match image natural size, but styled via CSS to fit
    canvas.width = img.width;
    canvas.height = img.height;

    // Draw Image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    // Draw Grid Lines
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    // Vertical lines
    for (let i = 1; i < grid.cols; i++) {
        const x = (img.width / grid.cols) * i;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, img.height);
    }
    // Horizontal lines
    for (let i = 1; i < grid.rows; i++) {
        const y = (img.height / grid.rows) * i;
        ctx.moveTo(0, y);
        ctx.lineTo(img.width, y);
    }
    ctx.stroke();

    // Highlight Selected Frame
    if (selectedFrameId !== null) {
        const frame = frames.find(f => f.id === selectedFrameId);
        if (frame) {
            ctx.fillStyle = 'rgba(255, 0, 128, 0.3)';
            ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
            ctx.strokeStyle = '#ff0080';
            ctx.lineWidth = 3;
            ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);
            
            // Draw Indicator for Offset if exists
            if (frame.offsetX !== 0 || frame.offsetY !== 0) {
               ctx.beginPath();
               ctx.strokeStyle = 'yellow';
               ctx.moveTo(frame.x + frame.width/2, frame.y + frame.height/2);
               ctx.lineTo(frame.x + frame.width/2 + frame.offsetX, frame.y + frame.height/2 + frame.offsetY);
               ctx.stroke();
               ctx.fillStyle = 'yellow';
               ctx.beginPath();
               ctx.arc(frame.x + frame.width/2 + frame.offsetX, frame.y + frame.height/2 + frame.offsetY, 3, 0, Math.PI*2);
               ctx.fill();
            }
        }
    }

  }, [sourceImage, grid, frames, selectedFrameId]);

  // Render Preview Canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || frames.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentFrame = frames[previewFrameIndex];
    if (!currentFrame) return;

    const img = imgRef.current;
    
    // Set canvas size to frame size
    // We maintain the aspect ratio of the frame
    canvas.width = currentFrame.width;
    canvas.height = currentFrame.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw the specific slice with offsets
    // source x, source y, source w, source h, dest x, dest y, dest w, dest h
    ctx.drawImage(
        img,
        currentFrame.x,
        currentFrame.y,
        currentFrame.width,
        currentFrame.height,
        -currentFrame.offsetX, // Apply offset inversely to "move" the character
        -currentFrame.offsetY,
        currentFrame.width,
        currentFrame.height
    );

  }, [previewFrameIndex, frames]);

  // Click on Canvas to Select Frame
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      const clickedFrame = frames.find(f => 
          x >= f.x && x < f.x + f.width &&
          y >= f.y && y < f.y + f.height
      );

      if (clickedFrame) {
          setSelectedFrameId(clickedFrame.id);
          // Set preview to this frame so user can see what they are editing
          setPreviewFrameIndex(clickedFrame.id);
          setIsPlaying(false); // Pause to edit
      }
  };

  const updateFrameOffset = useCallback((dx: number, dy: number) => {
      if (selectedFrameId === null) return;
      setFrames(prev => prev.map(f => {
          if (f.id === selectedFrameId) {
              return { ...f, offsetX: f.offsetX + dx, offsetY: f.offsetY + dy };
          }
          return f;
      }));
  }, [selectedFrameId]);

  // Keyboard Shortcuts for Nudging
  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          if (selectedFrameId === null) return;
          
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
             e.preventDefault(); 
          }

          if (e.key === 'ArrowUp') updateFrameOffset(0, -1);
          if (e.key === 'ArrowDown') updateFrameOffset(0, 1);
          if (e.key === 'ArrowLeft') updateFrameOffset(-1, 0);
          if (e.key === 'ArrowRight') updateFrameOffset(1, 0);
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFrameId, updateFrameOffset]);

  const handleDownloadGif = () => {
      if (!frames.length || !imgRef.current) return;
      
      const workerUrl = getGifWorkerUrl();

      const gif = new window.GIF({
        workers: 2,
        quality: 10,
        width: frames[0].width,
        height: frames[0].height,
        workerScript: workerUrl
      });

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = frames[0].width;
      tempCanvas.height = frames[0].height;
      const ctx = tempCanvas.getContext('2d');
      if (!ctx) return;

      frames.forEach(frame => {
          ctx.clearRect(0,0, tempCanvas.width, tempCanvas.height);
          // Background color for GIF? Let's keep it transparent if possible
          // or fill with a color if user wants, but default transparent is standard
          
          ctx.drawImage(
            imgRef.current,
            frame.x, frame.y, frame.width, frame.height,
            -frame.offsetX, -frame.offsetY, frame.width, frame.height
          );
          
          gif.addFrame(ctx, {copy: true, delay: 1000/fps});
      });

      gif.on('finished', (blob: Blob) => {
          window.open(URL.createObjectURL(blob));
          URL.revokeObjectURL(workerUrl); // Clean up
      });

      gif.render();
  };

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      
      {/* Sidebar Controls */}
      <aside className="w-80 border-r border-zinc-800 p-6 flex flex-col gap-6 overflow-y-auto bg-zinc-900/50 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded bg-gradient-to-tr from-pink-500 to-violet-500 flex items-center justify-center font-bold">N</div>
            <h1 className="text-xl font-bold tracking-tight">NanoSprite</h1>
        </div>

        {/* Mode Switcher */}
        <div className="flex p-1 bg-zinc-800 rounded-lg">
            <button 
                onClick={() => setMode(AppMode.GENERATE)}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${mode === AppMode.GENERATE ? 'bg-zinc-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
                Generate
            </button>
            <button 
                onClick={() => setMode(AppMode.EDIT)}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${mode === AppMode.EDIT ? 'bg-zinc-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
                Edit
            </button>
        </div>

        {mode === AppMode.GENERATE && (
             <div className="space-y-4 animate-in slide-in-from-left-4 fade-in duration-300">
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-400 uppercase">Prompt</label>
                    <textarea 
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-md p-3 text-sm focus:ring-2 focus:ring-pink-500 outline-none resize-none h-32"
                        placeholder="E.g., A running pixel art cat, side view"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                    />
                </div>
                <button 
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="w-full py-2 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md font-medium transition-colors flex items-center justify-center gap-2"
                >
                    {isGenerating ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"/> : <Wand2 size={16} />}
                    {isGenerating ? 'Dreaming...' : 'Generate Sprite'}
                </button>
                {errorMsg && (
                    <div className="p-3 bg-red-900/30 border border-red-800 rounded text-red-200 text-xs flex gap-2">
                        <AlertCircle size={14} className="mt-0.5" />
                        {errorMsg}
                    </div>
                )}
            </div>
        )}

        {mode === AppMode.EDIT && (
            <div className="space-y-6 animate-in slide-in-from-left-4 fade-in duration-300">
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-400 uppercase">Input Source</label>
                    <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-zinc-700 rounded-lg cursor-pointer hover:border-zinc-500 hover:bg-zinc-800/50 transition-colors">
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            <Upload className="w-6 h-6 mb-2 text-zinc-400" />
                            <p className="text-xs text-zinc-500">Click to upload image</p>
                        </div>
                        <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                    </label>
                </div>

                {sourceImage && (
                    <>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold text-zinc-400 uppercase flex items-center gap-1">
                                    <Grid size={12} /> Grid Layout
                                </label>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <span className="text-xs text-zinc-500 mb-1 block">Rows</span>
                                    <input 
                                        type="number" 
                                        min="1" max="10" 
                                        value={grid.rows}
                                        onChange={(e) => setGrid(prev => ({ ...prev, rows: parseInt(e.target.value) || 1 }))}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded p-1.5 text-sm text-center"
                                    />
                                </div>
                                <div>
                                    <span className="text-xs text-zinc-500 mb-1 block">Cols</span>
                                    <input 
                                        type="number" 
                                        min="1" max="10" 
                                        value={grid.cols}
                                        onChange={(e) => setGrid(prev => ({ ...prev, cols: parseInt(e.target.value) || 1 }))}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded p-1.5 text-sm text-center"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                             <label className="text-xs font-semibold text-zinc-400 uppercase flex items-center gap-1">
                                <MousePointer2 size={12} /> Micro Adjust
                            </label>
                             <div className="bg-zinc-900 rounded p-3 border border-zinc-800 text-xs text-zinc-400">
                                {selectedFrameId !== null ? (
                                    <div className="space-y-2">
                                        <div className="flex justify-between">
                                            <span>Frame:</span>
                                            <span className="text-white font-mono">{selectedFrameId + 1}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span>Offset X:</span>
                                            <span className="text-white font-mono">{frames.find(f => f.id === selectedFrameId)?.offsetX}px</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span>Offset Y:</span>
                                            <span className="text-white font-mono">{frames.find(f => f.id === selectedFrameId)?.offsetY}px</span>
                                        </div>
                                        <div className="pt-2 text-[10px] text-zinc-600 text-center">
                                            Use Arrow Keys to nudge
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center py-2">
                                        Click a grid cell on the image to select and adjust it.
                                    </div>
                                )}
                             </div>
                        </div>
                    </>
                )}
            </div>
        )}
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col h-full bg-zinc-950 relative">
          
          {/* Toolbar */}
          <div className="h-16 border-b border-zinc-800 flex items-center justify-between px-6 bg-zinc-900/30">
             <div className="flex items-center gap-4">
                 {/* Empty for now, could put zoom controls here */}
             </div>
             
             {/* Playback Controls */}
             <div className="flex items-center gap-4 bg-zinc-900 rounded-full px-4 py-2 border border-zinc-800">
                 <button 
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-200 transition-colors"
                 >
                     {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
                 </button>
                 <div className="flex items-center gap-2 border-l border-zinc-700 pl-4">
                     <span className="text-xs font-mono text-zinc-400 w-12">FPS {fps}</span>
                     <input 
                        type="range" 
                        min="1" max="24" 
                        value={fps} 
                        onChange={(e) => setFps(parseInt(e.target.value))}
                        className="w-24 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-pink-500"
                     />
                 </div>
             </div>

             <button 
                onClick={handleDownloadGif}
                disabled={!sourceImage}
                className="flex items-center gap-2 bg-zinc-100 hover:bg-white text-zinc-900 px-4 py-2 rounded-md text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
             >
                 <Download size={16} /> Export GIF
             </button>
          </div>

          {/* Canvas Area */}
          <div className="flex-1 overflow-hidden relative flex">
              
              {/* Editor View */}
              <div 
                ref={containerRef} 
                className="flex-1 overflow-auto flex items-center justify-center bg-zinc-950 p-8"
              >
                  {sourceImage ? (
                      <div className="relative shadow-2xl shadow-black/50">
                          <canvas 
                            ref={canvasRef} 
                            onClick={handleCanvasClick}
                            className="cursor-crosshair max-w-[calc(100vw-450px)] max-h-[calc(100vh-200px)] object-contain border border-zinc-800"
                            style={{ imageRendering: 'pixelated' }}
                          />
                      </div>
                  ) : (
                      <div className="text-zinc-600 flex flex-col items-center">
                          <Sliders size={48} className="mb-4 opacity-20" />
                          <p>Upload a sprite sheet or generate one to begin</p>
                      </div>
                  )}
              </div>

              {/* Live Preview Panel (Floating or fixed on right) */}
              <div className="w-64 border-l border-zinc-800 bg-zinc-900/50 backdrop-blur flex flex-col">
                  <div className="p-4 border-b border-zinc-800">
                      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-4">Live Preview</h3>
                      <div className="aspect-square bg-[url('https://www.transparenttextures.com/patterns/black-linen.png')] bg-zinc-800 rounded-lg flex items-center justify-center overflow-hidden border border-zinc-700 shadow-inner">
                          {sourceImage && (
                              <canvas 
                                ref={previewCanvasRef} 
                                className="max-w-full max-h-full object-contain"
                                style={{ imageRendering: 'pixelated' }}
                              />
                          )}
                          {!sourceImage && <div className="text-zinc-600 text-xs">No Signal</div>}
                      </div>
                      <div className="mt-2 flex justify-between text-xs text-zinc-500 font-mono">
                          <span>Frame: {previewFrameIndex + 1}/{frames.length}</span>
                          {selectedFrameId !== null && isPlaying === false && (
                              <span className="text-yellow-500">Editing Frame {selectedFrameId + 1}</span>
                          )}
                      </div>
                  </div>
                  
                  {/* Instructions */}
                  <div className="p-4 text-xs text-zinc-500 space-y-2">
                      <p>1. <strong>Grid:</strong> Adjust rows/cols to match sprite sheet.</p>
                      <p>2. <strong>Select:</strong> Click a frame in the main view.</p>
                      <p>3. <strong>Adjust:</strong> Use arrow keys to fix jitter.</p>
                      <p>4. <strong>Export:</strong> Download smooth GIF.</p>
                  </div>

                  {generationSuccess && (
                      <div className="mt-auto p-4 bg-green-900/20 border-t border-green-900/50 text-green-400 text-xs">
                          <p>Sprite generated successfully! The system has auto-guessed a 3x3 grid. Adjust if necessary.</p>
                      </div>
                  )}
              </div>
          </div>
      </main>
    </div>
  );
}

export default App;
