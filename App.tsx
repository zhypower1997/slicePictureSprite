
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Upload, Play, Pause, Download, Wand2, Grid, AlertCircle, RefreshCw, Move, EyeOff, CheckSquare, Square, ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { FrameConfig, GridDimensions, AppMode } from './types';
import { generateSpriteSheet } from './services/geminiService';
import { getGifWorkerUrl } from './utils/gifWorker';

declare global {
  interface Window {
    GIF: any;
  }
}

interface Dividers {
  v: number[]; // Vertical dividers (0 to 1)
  h: number[]; // Horizontal dividers (0 to 1)
}

interface SelectionBox {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
}

const HIT_TOLERANCE = 12; // Pixels distance to grab a line

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.EDIT);
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [grid, setGrid] = useState<GridDimensions>({ rows: 3, cols: 3 });
  const [dividers, setDividers] = useState<Dividers>({ v: [0.33, 0.66], h: [0.33, 0.66] });
  
  const [frames, setFrames] = useState<FrameConfig[]>([]);
  const [selectedFrameIds, setSelectedFrameIds] = useState<number[]>([]); 
  
  const [fps, setFps] = useState<number>(8);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [previewFrameIndex, setPreviewFrameIndex] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [prompt, setPrompt] = useState<string>('A cute pixel art robot walking');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [generationSuccess, setGenerationSuccess] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Interaction State
  const [dragTarget, setDragTarget] = useState<{ type: 'v' | 'h', index: number } | null>(null);
  const [hoverTarget, setHoverTarget] = useState<{ type: 'v' | 'h', index: number } | null>(null);
  
  // Selection Box State
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [isSelecting, setIsSelecting] = useState<boolean>(false);

  // References
  const imgRef = useRef<HTMLImageElement>(new Image());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Derived State
  // Sort by sequenceOrder to allow custom ordering
  const activeFrames = useMemo(() => {
    return frames
        .filter(f => f.active)
        .sort((a,b) => a.sequenceOrder - b.sequenceOrder);
  }, [frames]);

  // --- Initialization & Grid Logic ---

  const resetDividers = (rows: number, cols: number) => {
     const v = Array.from({length: cols - 1}, (_, i) => (i + 1) / cols);
     const h = Array.from({length: rows - 1}, (_, i) => (i + 1) / rows);
     setDividers({ v, h });
  };

  useEffect(() => {
    if (sourceImage) {
      const img = imgRef.current;
      img.src = sourceImage;
      img.onload = () => {
        calculateFrames();
      };
    }
  }, [sourceImage]);

  useEffect(() => {
      calculateFrames();
  }, [dividers, sourceImage]);

  const calculateFrames = () => {
    if (!imgRef.current.complete || !imgRef.current.src) return;
    
    const imgWidth = imgRef.current.width;
    const imgHeight = imgRef.current.height;

    // Construct full list of split points including 0 and 1
    const xPoints = [0, ...dividers.v, 1].map(p => p * imgWidth);
    const yPoints = [0, ...dividers.h, 1].map(p => p * imgHeight);

    setFrames(prev => {
        const newFrames: FrameConfig[] = [];
        let idCounter = 0;
        
        for (let r = 0; r < yPoints.length - 1; r++) {
            for (let c = 0; c < xPoints.length - 1; c++) {
                const x = xPoints[c];
                const y = yPoints[r];
                const width = xPoints[c+1] - x;
                const height = yPoints[r+1] - y;
                
                // Try to find existing frame to preserve offsets, active state, and sequence
                // We map loosely based on spatial proximity or row/col index
                const existing = prev.find(p => p.row === r && p.col === c);
                
                newFrames.push({
                    id: idCounter,
                    row: r,
                    col: c,
                    x,
                    y,
                    width,
                    height,
                    offsetX: existing ? existing.offsetX : 0,
                    offsetY: existing ? existing.offsetY : 0,
                    active: existing ? existing.active : true,
                    sequenceOrder: existing ? existing.sequenceOrder : idCounter,
                });
                idCounter++;
            }
        }
        return newFrames;
    });
    // Clear selection on re-calc to avoid ghost IDs
    setSelectedFrameIds([]);
  };

  const handleGridCountChange = (type: 'rows' | 'cols', val: number) => {
      const newVal = Math.max(1, Math.min(20, val));
      const newGrid = { ...grid, [type]: newVal };
      setGrid(newGrid);
      resetDividers(newGrid.rows, newGrid.cols);
  };

  // --- Batch Operations ---

  const updateFrameOffset = (axis: 'x' | 'y', delta: number) => {
      if (selectedFrameIds.length === 0) return;
      setFrames(prev => prev.map(f => {
          if (selectedFrameIds.includes(f.id)) {
              return { 
                  ...f, 
                  [axis === 'x' ? 'offsetX' : 'offsetY']: (axis === 'x' ? f.offsetX : f.offsetY) + delta 
              };
          }
          return f;
      }));
  };

  const setBatchActive = (active: boolean) => {
      if (selectedFrameIds.length === 0) return;
      setFrames(prev => prev.map(f => {
          if (selectedFrameIds.includes(f.id)) {
              return { ...f, active };
          }
          return f;
      }));
  };

  // --- Sequence Reordering ---

  const moveFrameInSequence = (direction: -1 | 1) => {
      if (selectedFrameIds.length !== 1) return; // Only allow single frame reorder for simplicity
      const selectedId = selectedFrameIds[0];
      const frame = frames.find(f => f.id === selectedId);
      if (!frame || !frame.active) return;

      // Get list of active frames sorted by current sequence
      const sortedActive = [...frames.filter(f => f.active)].sort((a,b) => a.sequenceOrder - b.sequenceOrder);
      const currentIndex = sortedActive.findIndex(f => f.id === selectedId);
      
      if (currentIndex === -1) return;
      
      const swapIndex = currentIndex + direction;
      if (swapIndex < 0 || swapIndex >= sortedActive.length) return;

      const targetFrame = sortedActive[swapIndex];

      // Swap their sequenceOrder values
      const newOrderA = targetFrame.sequenceOrder;
      const newOrderB = frame.sequenceOrder;

      setFrames(prev => prev.map(f => {
          if (f.id === frame.id) return { ...f, sequenceOrder: newOrderA };
          if (f.id === targetFrame.id) return { ...f, sequenceOrder: newOrderB };
          return f;
      }));
  };

  // --- File & GenAI ---

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setSourceImage(ev.target?.result as string);
        setMode(AppMode.EDIT);
        setGenerationSuccess(false);
        // Reset to default grid on new file
        setGrid({rows: 3, cols: 3});
        resetDividers(3, 3);
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
      setGrid({ rows: 3, cols: 3 }); 
      resetDividers(3, 3);
      setMode(AppMode.EDIT);
      setGenerationSuccess(true);
    } catch (err: any) {
      setErrorMsg("Failed to generate: " + (err.message || "Unknown error"));
    } finally {
      setIsGenerating(false);
    }
  };

  // --- Export ---
  const handleExportGif = async () => {
    if (activeFrames.length === 0 || !imgRef.current?.complete) {
      alert('No active frames to export!');
      return;
    }

    setIsExporting(true);

    try {
        const workerUrl = await getGifWorkerUrl();

        const gif = new window.GIF({
            workers: 2,
            quality: 10,
            width: activeFrames[0].width, // Assume roughly equal sizes, or use max
            height: activeFrames[0].height,
            workerScript: workerUrl
        });

        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) throw new Error('Could not create canvas context');

        // Render each frame to the GIF
        activeFrames.forEach((frame) => {
            // Resize temp canvas to match frame size (GIF.js handles varying sizes, 
            // but ideally frames should be uniform for a good sprite animation)
            tempCanvas.width = frame.width;
            tempCanvas.height = frame.height;

            tempCtx.clearRect(0, 0, frame.width, frame.height);
            tempCtx.drawImage(
                imgRef.current,
                frame.x, frame.y, frame.width, frame.height,
                frame.offsetX, frame.offsetY, frame.width, frame.height
            );
            
            gif.addFrame(tempCanvas, { delay: 1000 / fps, copy: true });
        });

        gif.on('finished', (blob: Blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `animation-${Date.now()}.gif`;
            a.click();
            URL.revokeObjectURL(url);
            URL.revokeObjectURL(workerUrl); // Clean up worker URL
            setIsExporting(false);
        });

        gif.render();

    } catch (e) {
        console.error(e);
        alert('Failed to export GIF. See console for details.');
        setIsExporting(false);
    }
  };
  
  const handleExportPic = () => {
  console.log('activeFrames', activeFrames);
  // 边界判断
  if (activeFrames.length === 0 || !imgRef.current?.complete) {
    alert('无有效帧或图片资源未加载完成，无法导出！');
    return;
  }

  // 创建临时 Canvas 用于绘制单帧
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) {
    alert('获取 Canvas 上下文失败！');
    return;
  }

  // 遍历每帧，逐个导出（添加延迟）
  activeFrames.forEach((frame, index) => {
    // 为每个帧添加延迟，避免浏览器拦截（100ms 可根据实际情况调整）
    setTimeout(() => {
      // 设置临时 Canvas 尺寸为当前帧尺寸
      tempCanvas.width = frame.width;
      tempCanvas.height = frame.height;

      // 绘制当前帧（与预览逻辑一致）
      tempCtx.clearRect(0, 0, frame.width, frame.height);
      tempCtx.drawImage(
        imgRef.current,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        frame.offsetX,
        frame.offsetY,
        frame.width,
        frame.height
      );

      // 生成下载链接
      const url = tempCanvas.toDataURL('image/png'); // 导出为 PNG 格式（也可换 image/jpeg）
      const a = document.createElement('a');
      a.href = url;
      a.download = `frame-${frame.id || index}.png`; // 文件名：frame-0.png、frame-1.png...
      // 必须将 a 标签添加到文档中，部分浏览器需要此步骤
      document.body.appendChild(a);
      a.click();
      // 移除 a 标签
      document.body.removeChild(a);

      // 释放资源
      URL.revokeObjectURL(url);
    }, index * 100); // 每个帧延迟 index*100ms，依次导出
  });
};

  // --- Preview Loop ---
  useEffect(() => {
    if (!isPlaying || activeFrames.length === 0) return;

    if (previewFrameIndex >= activeFrames.length) {
        setPreviewFrameIndex(0);
    }

    const interval = setInterval(() => {
      setPreviewFrameIndex(current => (current + 1) % activeFrames.length);
    }, 1000 / fps);

    return () => clearInterval(interval);
  }, [isPlaying, fps, activeFrames.length]);

  // --- Canvas Rendering ---
  
  const getRelativeMousePos = (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY
      };
  };

  const getSelectionRect = (box: SelectionBox) => {
      const x = Math.min(box.startX, box.currentX);
      const y = Math.min(box.startY, box.currentY);
      const width = Math.abs(box.currentX - box.startX);
      const height = Math.abs(box.currentY - box.startY);
      return { x, y, width, height };
  };

  const isIntersecting = (r1: {x:number, y:number, width:number, height:number}, r2: {x:number, y:number, width:number, height:number}) => {
      return !(r2.x > r1.x + r1.width || 
               r2.x + r2.width < r1.x || 
               r2.y > r1.y + r1.height || 
               r2.y + r2.height < r1.y);
  };

  // Main Draw Loop
  const drawEditor = () => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceImage || !frames.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = imgRef.current;
    
    if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = img.width;
        canvas.height = img.height;
    }

    // 1. Draw Source Image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    // 2. Draw Frame Overlays
    // Pre-calculate sequence index for active frames to display badge
    const activeFrameMap = new Map<number, number>();
    activeFrames.forEach((f, idx) => activeFrameMap.set(f.id, idx + 1));

    frames.forEach(frame => {
        // Handle Inactive Frames
        if (!frame.active) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'; 
            ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
            
            ctx.beginPath();
            ctx.moveTo(frame.x, frame.y);
            ctx.lineTo(frame.x + frame.width, frame.y + frame.height);
            ctx.moveTo(frame.x + frame.width, frame.y);
            ctx.lineTo(frame.x, frame.y + frame.height);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();
        } else {
             // Draw Sequence Badge
             const seqNum = activeFrameMap.get(frame.id);
             if (seqNum !== undefined) {
                 ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                 ctx.fillRect(frame.x + 2, frame.y + 2, 20, 20);
                 ctx.fillStyle = '#fff';
                 ctx.font = '12px sans-serif';
                 ctx.fillText(seqNum.toString(), frame.x + 8, frame.y + 16);
             }
        }

        // Highlight selected frames
        if (selectedFrameIds.includes(frame.id)) {
            ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
            ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);
            
            // Draw Offset Indicator
            if (frame.offsetX !== 0 || frame.offsetY !== 0) {
                 ctx.save();
                 ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)';
                 ctx.setLineDash([4, 4]);
                 ctx.strokeRect(frame.x + frame.offsetX, frame.y + frame.offsetY, frame.width, frame.height);
                 ctx.restore();
            }
        }
    });

    // 3. Draw Grid Lines
    dividers.v.forEach((pos, idx) => {
        const x = pos * canvas.width;
        const isHovered = hoverTarget?.type === 'v' && hoverTarget.index === idx;
        const isDragging = dragTarget?.type === 'v' && dragTarget.index === idx;

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.lineWidth = isHovered || isDragging ? 3 : 1;
        ctx.strokeStyle = isHovered || isDragging ? '#ef4444' : 'rgba(0, 255, 255, 0.7)';
        ctx.stroke();
    });

    dividers.h.forEach((pos, idx) => {
        const y = pos * canvas.height;
        const isHovered = hoverTarget?.type === 'h' && hoverTarget.index === idx;
        const isDragging = dragTarget?.type === 'h' && dragTarget.index === idx;

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.lineWidth = isHovered || isDragging ? 3 : 1;
        ctx.strokeStyle = isHovered || isDragging ? '#ef4444' : 'rgba(0, 255, 255, 0.7)';
        ctx.stroke();
    });

    // 4. Draw Selection Box
    if (selectionBox) {
        const rect = getSelectionRect(selectionBox);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
  };

  useEffect(() => {
     requestAnimationFrame(drawEditor);
  }, [sourceImage, frames, dividers, hoverTarget, dragTarget, selectedFrameIds, selectionBox, activeFrames]);


  // --- Canvas Interaction ---

  const handleMouseDown = (e: React.MouseEvent) => {
      const { x, y } = getRelativeMousePos(e);

      if (hoverTarget) {
          setDragTarget(hoverTarget);
          return;
      }

      setIsSelecting(true);
      setSelectionBox({
          startX: x,
          startY: y,
          currentX: x,
          currentY: y
      });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      const { x, y } = getRelativeMousePos(e);
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (dragTarget) {
          if (dragTarget.type === 'v') {
              const prevLimit = dragTarget.index === 0 ? 0 : dividers.v[dragTarget.index - 1];
              const nextLimit = dragTarget.index === dividers.v.length - 1 ? 1 : dividers.v[dragTarget.index + 1];
              let newPos = x / canvas.width;
              newPos = Math.max(prevLimit + 0.01, Math.min(nextLimit - 0.01, newPos));
              const newV = [...dividers.v];
              newV[dragTarget.index] = newPos;
              setDividers({ ...dividers, v: newV });
          } else {
              const prevLimit = dragTarget.index === 0 ? 0 : dividers.h[dragTarget.index - 1];
              const nextLimit = dragTarget.index === dividers.h.length - 1 ? 1 : dividers.h[dragTarget.index + 1];
              let newPos = y / canvas.height;
              newPos = Math.max(prevLimit + 0.01, Math.min(nextLimit - 0.01, newPos));
              const newH = [...dividers.h];
              newH[dragTarget.index] = newPos;
              setDividers({ ...dividers, h: newH });
          }
          return;
      }

      if (isSelecting && selectionBox) {
          setSelectionBox(prev => prev ? ({ ...prev, currentX: x, currentY: y }) : null);
          return;
      }

      let found: { type: 'v' | 'h', index: number } | null = null;
      for (let i = 0; i < dividers.v.length; i++) {
          const lineX = dividers.v[i] * canvas.width;
          if (Math.abs(x - lineX) < HIT_TOLERANCE) {
              found = { type: 'v', index: i };
              break;
          }
      }
      if (!found) {
          for (let i = 0; i < dividers.h.length; i++) {
              const lineY = dividers.h[i] * canvas.height;
              if (Math.abs(y - lineY) < HIT_TOLERANCE) {
                  found = { type: 'h', index: i };
                  break;
              }
          }
      }
      setHoverTarget(found);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
      if (dragTarget) {
          setDragTarget(null);
          return;
      }

      if (isSelecting && selectionBox) {
          const { x, y } = getRelativeMousePos(e);
          const dist = Math.sqrt(Math.pow(x - selectionBox.startX, 2) + Math.pow(y - selectionBox.startY, 2));

          if (dist < 5) {
              const clickedFrame = frames.find(f => 
                x >= f.x && x < f.x + f.width && 
                y >= f.y && y < f.y + f.height
              );
              if (clickedFrame) {
                  setSelectedFrameIds([clickedFrame.id]);
              } else {
                  setSelectedFrameIds([]);
              }
          } else {
              const selRect = getSelectionRect(selectionBox);
              const intersected = frames.filter(f => isIntersecting(selRect, f));
              setSelectedFrameIds(intersected.map(f => f.id));
          }
          
          setSelectionBox(null);
          setIsSelecting(false);
      }
  };

  const handleMouseLeave = () => {
      setDragTarget(null);
      setHoverTarget(null);
      setSelectionBox(null);
      setIsSelecting(false);
  };

  const getCursor = () => {
      if (dragTarget) return dragTarget.type === 'v' ? 'col-resize' : 'row-resize';
      if (hoverTarget) return hoverTarget.type === 'v' ? 'col-resize' : 'row-resize';
      if (isSelecting) return 'crosshair';
      return 'default';
  };

  // --- Preview Renderer ---
  useEffect(() => {
      if (!previewCanvasRef.current) return;
      const ctx = previewCanvasRef.current.getContext('2d');
      if (!ctx) return;

      if (activeFrames.length === 0) {
          ctx.clearRect(0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
          ctx.fillStyle = '#18181b';
          ctx.fillRect(0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
          return;
      }

      const safeIndex = previewFrameIndex % activeFrames.length;
      const frame = activeFrames[safeIndex];
      
      if (imgRef.current.complete && frame) {
          previewCanvasRef.current.width = frame.width;
          previewCanvasRef.current.height = frame.height;

          ctx.clearRect(0, 0, frame.width, frame.height);
          ctx.drawImage(
              imgRef.current, 
              frame.x, frame.y, frame.width, frame.height, 
              frame.offsetX, frame.offsetY, frame.width, frame.height
          );
      }
  }, [previewFrameIndex, activeFrames]);

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-zinc-200 font-sans overflow-hidden">
      
      {/* LEFT SIDEBAR - Controls */}
      <aside className="w-80 flex-shrink-0 border-r border-zinc-800 bg-zinc-900/50 p-4 flex flex-col gap-6 overflow-y-auto">
        
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-indigo-400">
            <Wand2 className="w-5 h-5" />
            NanoSprite
          </h1>
          <p className="text-xs text-zinc-500 mt-1">AI Sprite Sheet Slicer</p>
        </div>

        {/* Generator Section */}
        <div className="space-y-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Generate New</label>
          <textarea 
            className="w-full bg-zinc-950 border border-zinc-700 rounded p-3 text-sm focus:border-indigo-500 focus:outline-none resize-none h-24"
            placeholder="Describe your character..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button 
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
          >
            {isGenerating ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"/> : <Wand2 className="w-4 h-4" />}
            Generate Sprite
          </button>
          {errorMsg && (
            <div className="p-2 bg-red-900/20 border border-red-800 rounded text-xs text-red-300 flex items-center gap-2">
              <AlertCircle className="w-3 h-3" />
              {errorMsg}
            </div>
          )}
        </div>

        <div className="h-px bg-zinc-800" />

        {/* Upload */}
        <div className="space-y-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Or Upload Source</label>
          <label className="flex flex-col items-center justify-center w-full h-16 border-2 border-zinc-700 border-dashed rounded cursor-pointer hover:border-zinc-500 transition-colors bg-zinc-900">
             <div className="flex flex-col items-center justify-center pt-2 pb-2">
                <Upload className="w-5 h-5 text-zinc-400 mb-1" />
                <p className="text-xs text-zinc-500">Upload PNG/JPG</p>
             </div>
             <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
          </label>
        </div>

        <div className="h-px bg-zinc-800" />

        {/* Slicing Controls */}
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-2">
                    <Grid className="w-3 h-3" /> Grid Layout
                </label>
                <button onClick={() => resetDividers(grid.rows, grid.cols)} className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" /> Reset
                </button>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <span className="text-xs text-zinc-400 block mb-1">Rows</span>
                    <input 
                        type="number" 
                        min="1" max="16"
                        value={grid.rows}
                        onChange={(e) => handleGridCountChange('rows', parseInt(e.target.value) || 1)}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm"
                    />
                </div>
                <div>
                    <span className="text-xs text-zinc-400 block mb-1">Columns</span>
                    <input 
                        type="number" 
                        min="1" max="16"
                        value={grid.cols}
                        onChange={(e) => handleGridCountChange('cols', parseInt(e.target.value) || 1)}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm"
                    />
                </div>
            </div>
        </div>

        {/* Selected Frames Adjustment */}
        {selectedFrameIds.length > 0 && (
            <div className="bg-zinc-800/40 rounded p-3 space-y-3 border border-zinc-700/50">
                <div className="flex items-center justify-between border-b border-zinc-700/50 pb-2">
                     <span className="text-xs font-medium text-white flex items-center gap-1">
                        <Move className="w-3 h-3" /> {selectedFrameIds.length} Frame{selectedFrameIds.length > 1 ? 's' : ''} Selected
                     </span>
                </div>
                
                {/* Batch Actions */}
                <div className="grid grid-cols-2 gap-2">
                    <button 
                        onClick={() => setBatchActive(true)}
                        className="flex items-center justify-center gap-1 bg-green-900/30 hover:bg-green-900/50 text-green-400 border border-green-800/50 rounded py-1.5 text-xs transition-colors"
                    >
                        <CheckSquare className="w-3 h-3" /> Mark Active
                    </button>
                    <button 
                         onClick={() => setBatchActive(false)}
                         className="flex items-center justify-center gap-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/50 rounded py-1.5 text-xs transition-colors"
                    >
                        <Square className="w-3 h-3" /> Mark Skipped
                    </button>
                </div>

                {/* Fine Tune Offset */}
                <div className="space-y-2">
                    <div className="text-[10px] text-zinc-500 uppercase font-semibold">Fine Tune Offset</div>
                    <div className="grid grid-cols-3 gap-1">
                        <div />
                        <button onClick={() => updateFrameOffset('y', -1)} className="p-1 bg-zinc-700 hover:bg-zinc-600 rounded text-xs">Up</button>
                        <div />
                        <button onClick={() => updateFrameOffset('x', -1)} className="p-1 bg-zinc-700 hover:bg-zinc-600 rounded text-xs">Left</button>
                        <div className="flex items-center justify-center text-zinc-500 text-xs"><Move className="w-3 h-3"/></div>
                        <button onClick={() => updateFrameOffset('x', 1)} className="p-1 bg-zinc-700 hover:bg-zinc-600 rounded text-xs">Right</button>
                        <div />
                        <button onClick={() => updateFrameOffset('y', 1)} className="p-1 bg-zinc-700 hover:bg-zinc-600 rounded text-xs">Down</button>
                        <div />
                    </div>
                </div>

                {/* Sequence Ordering */}
                {selectedFrameIds.length === 1 && frames.find(f => f.id === selectedFrameIds[0])?.active && (
                    <div className="space-y-2 pt-2 border-t border-zinc-700/50">
                        <div className="text-[10px] text-zinc-500 uppercase font-semibold flex items-center gap-1">
                            <Layers className="w-3 h-3"/> Reorder Sequence
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <button 
                                onClick={() => moveFrameInSequence(-1)}
                                className="flex items-center justify-center gap-1 bg-zinc-700 hover:bg-zinc-600 rounded py-1.5 text-xs"
                            >
                                <ChevronLeft className="w-3 h-3" /> Earlier
                            </button>
                            <button 
                                onClick={() => moveFrameInSequence(1)}
                                className="flex items-center justify-center gap-1 bg-zinc-700 hover:bg-zinc-600 rounded py-1.5 text-xs"
                            >
                                Later <ChevronRight className="w-3 h-3" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        )}

      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col min-w-0">
          
          {/* Top Bar - Preview & Export */}
          <header className="h-16 border-b border-zinc-800 bg-zinc-900/30 flex items-center justify-between px-6">
               <div className="flex items-center gap-4">
                  {/* Animation Preview Small */}
                  <div className="relative w-12 h-12 bg-zinc-800 rounded overflow-hidden border border-zinc-700">
                     <canvas ref={previewCanvasRef} className="w-full h-full object-contain" />
                     {activeFrames.length === 0 && <div className="absolute inset-0 flex items-center justify-center text-zinc-600"><EyeOff className="w-4 h-4"/></div>}
                  </div>
                  <div className="flex items-center gap-2 bg-zinc-800 rounded-lg p-1">
                      <button onClick={() => setIsPlaying(!isPlaying)} className="p-1.5 hover:bg-zinc-700 rounded text-white">
                          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                      <div className="h-4 w-px bg-zinc-700" />
                      <div className="flex items-center gap-1 px-1">
                         <span className="text-xs text-zinc-400">FPS</span>
                         <input 
                            type="number" 
                            className="w-10 bg-transparent text-xs text-center focus:outline-none"
                            value={fps}
                            onChange={(e) => setFps(parseInt(e.target.value) || 8)}
                         />
                      </div>
                  </div>
               </div>

               <button 
                onClick={handleExportGif}
                disabled={isExporting || !sourceImage || activeFrames.length === 0}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 {isExporting ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"/> : <Download className="w-4 h-4" />}
                 Export GIF
               </button>

               <button 
                onClick={handleExportPic}
                disabled={isExporting || !sourceImage || activeFrames.length === 0}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 {isExporting ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"/> : <Download className="w-4 h-4" />}
                 Export Pic
               </button>
          </header>

          {/* Canvas Area */}
          <div className="flex-1 overflow-auto bg-[radial-gradient(#1f2937_1px,transparent_1px)] [background-size:16px_16px] p-8 flex items-center justify-center relative">
             {sourceImage ? (
                <div 
                    ref={containerRef}
                    className="relative shadow-2xl ring-1 ring-zinc-800 select-none"
                    style={{ cursor: getCursor() }}
                >
                    <canvas 
                        ref={canvasRef}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseLeave}
                        className="max-w-full max-h-[80vh] object-contain block"
                    />
                </div>
             ) : (
                <div className="text-center text-zinc-500">
                    <Grid className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p>Select an image or generate one to start slicing</p>
                </div>
             )}
          </div>

      </main>
    </div>
  );
};

export default App;
