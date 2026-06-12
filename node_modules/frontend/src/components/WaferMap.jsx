import React, { useRef, useEffect, useState, useCallback } from 'react';
import { aggregateDefects, pickDefectAtPoint } from '../utils/mockData.js';

const WAFER_RADIUS_MM = 150;
const TILE_RESOLUTION = 200;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 50;

function getScratchColor(scratch) {
  let severity = 'INFO';
  if (typeof scratch.severity === 'string') {
    severity = scratch.severity;
  } else if (typeof scratch.confidence === 'number') {
    if (scratch.confidence >= 0.8) severity = 'CRITICAL';
    else if (scratch.confidence >= 0.6) severity = 'WARNING';
    else severity = 'MILD';
  }
  switch (severity) {
    case 'CRITICAL':
      return { line: '#ff1744', glow: 'rgba(255, 23, 68, 0.8)', label: 'CRITICAL' };
    case 'WARNING':
      return { line: '#ff9100', glow: 'rgba(255, 145, 0, 0.7)', label: 'WARNING' };
    case 'MILD':
      return { line: '#ffc400', glow: 'rgba(255, 196, 0, 0.5)', label: 'MILD' };
    default:
      return { line: '#ffc107', glow: 'rgba(255, 193, 7, 0.5)', label: 'INFO' };
  }
}

function isHighConfidence(scratch) {
  if (typeof scratch.severity === 'string') {
    return scratch.severity === 'CRITICAL';
  }
  return (scratch.confidence || 0) >= 0.8;
}

function isMediumConfidence(scratch) {
  if (typeof scratch.severity === 'string') {
    return scratch.severity === 'WARNING';
  }
  return (scratch.confidence || 0) >= 0.6 && (scratch.confidence || 0) < 0.8;
}

function getLineEquation(scratch) {
  if (scratch.lineEquation) return scratch.lineEquation;
  return { a: scratch.a || 0, b: scratch.b || 0, c: scratch.c || 0 };
}

export default function WaferMap({
  batchId,
  waferId,
  onDefectPick,
  onViewChange,
  mockDefects = null,
  scratchLines = [],
  showScratches = true,
  onScratchClick,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const viewRef = useRef({
    offsetX: 0,
    offsetY: 0,
    zoom: 1,
  });
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const animFrameRef = useRef(null);
  const defectsCacheRef = useRef(new Map());
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [isLoading, setIsLoading] = useState(false);
  const [defectCount, setDefectCount] = useState(0);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setCanvasSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  useEffect(() => {
    if (canvasSize.width > 0 && canvasSize.height > 0) {
      const minDim = Math.min(canvasSize.width, canvasSize.height);
      const zoom = (minDim * 0.8) / (WAFER_RADIUS_MM * 2);
      viewRef.current = {
        offsetX: canvasSize.width / 2,
        offsetY: canvasSize.height / 2,
        zoom,
      };
      requestRender();
    }
  }, [canvasSize.width, canvasSize.height]);

  const worldToScreen = useCallback((wx, wy) => {
    const v = viewRef.current;
    return {
      x: wx * v.zoom + v.offsetX,
      y: wy * v.zoom + v.offsetY,
    };
  }, []);

  const screenToWorld = useCallback((sx, sy) => {
    const v = viewRef.current;
    return {
      x: (sx - v.offsetX) / v.zoom,
      y: (sy - v.offsetY) / v.zoom,
    };
  }, []);

  const getVisibleBounds = useCallback(() => {
    const { width, height } = canvasSize;
    const topLeft = screenToWorld(0, 0);
    const bottomRight = screenToWorld(width, height);
    return {
      xMin: topLeft.x,
      yMin: topLeft.y,
      xMax: bottomRight.x,
      yMax: bottomRight.y,
    };
  }, [canvasSize, screenToWorld]);

  const fetchTileData = useCallback(async () => {
    if (!batchId) return [];

    const bounds = getVisibleBounds();
    const v = viewRef.current;

    const tileKey = `${batchId}_${waferId || 'all'}_${bounds.xMin.toFixed(2)}_${bounds.yMin.toFixed(2)}_${bounds.xMax.toFixed(2)}_${bounds.yMax.toFixed(2)}_${v.zoom.toFixed(2)}`;

    if (defectsCacheRef.current.has(tileKey)) {
      return defectsCacheRef.current.get(tileKey);
    }

    if (mockDefects) {
      let filtered = mockDefects;
      if (waferId) {
        filtered = mockDefects.filter((d) => d.waferId === waferId || d.waferId.endsWith(waferId));
      }

      const resolution = v.zoom > 10 ? 300 : v.zoom > 5 ? 250 : 200;
      const aggregated = aggregateDefects(
        filtered,
        bounds.xMin,
        bounds.yMin,
        bounds.xMax,
        bounds.yMax,
        resolution
      );

      defectsCacheRef.current.set(tileKey, aggregated);
      setDefectCount(aggregated.reduce((sum, d) => sum + d.count, 0));
      return aggregated;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        batchId,
        xMin: bounds.xMin,
        yMin: bounds.yMin,
        xMax: bounds.xMax,
        yMax: bounds.yMax,
        resolution: TILE_RESOLUTION,
      });
      if (waferId) params.set('waferId', waferId);

      const res = await fetch(`/api/defects/tile?${params.toString()}`);
      const data = await res.json();

      defectsCacheRef.current.set(tileKey, data);

      if (defectsCacheRef.current.size > 50) {
        const keys = Array.from(defectsCacheRef.current.keys());
        keys.slice(0, 20).forEach((k) => defectsCacheRef.current.delete(k));
      }

      setDefectCount(data.reduce((sum, d) => sum + d.count, 0));
      return data;
    } catch (e) {
      console.error('Fetch tile error:', e);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [batchId, waferId, mockDefects, getVisibleBounds]);

  const render = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvasSize;
    const v = viewRef.current;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, width, height);

    const center = worldToScreen(0, 0);
    const radiusPx = WAFER_RADIUS_MM * v.zoom;

    const bgGrad = ctx.createRadialGradient(
      center.x, center.y, radiusPx * 0.3,
      center.x, center.y, radiusPx
    );
    bgGrad.addColorStop(0, '#1a2233');
    bgGrad.addColorStop(1, '#0d1117');

    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = bgGrad;
    ctx.fill();

    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = '#1a2332';
    ctx.lineWidth = 0.5;
    const gridStep = 10;
    for (let gx = -WAFER_RADIUS_MM; gx <= WAFER_RADIUS_MM; gx += gridStep) {
      const p1 = worldToScreen(gx, -WAFER_RADIUS_MM);
      const p2 = worldToScreen(gx, WAFER_RADIUS_MM);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    for (let gy = -WAFER_RADIUS_MM; gy <= WAFER_RADIUS_MM; gy += gridStep) {
      const p1 = worldToScreen(-WAFER_RADIUS_MM, gy);
      const p2 = worldToScreen(WAFER_RADIUS_MM, gy);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    const defects = await fetchTileData();
    if (defects && defects.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
      ctx.clip();

      const maxCount = Math.max(...defects.map((d) => d.count), 1);

      defects.forEach((defect) => {
        const pos = worldToScreen(defect.x, defect.y);
        const intensity = Math.min(1, defect.count / maxCount);
        const size = Math.max(0.5, Math.min(8, (defect.avgSize || 1) * v.zoom * 0.8));

        let r, g, b, a;
        if (intensity > 0.7) {
          r = 255;
          g = Math.floor(80 + (1 - intensity) * 50);
          b = Math.floor(50 + (1 - intensity) * 30);
          a = 0.7 + intensity * 0.3;
        } else if (intensity > 0.3) {
          r = Math.floor(200 + intensity * 55);
          g = Math.floor(120 + intensity * 30);
          b = Math.floor(80 + intensity * 20);
          a = 0.4 + intensity * 0.3;
        } else {
          r = Math.floor(120 + intensity * 80);
          g = Math.floor(120 + intensity * 30);
          b = Math.floor(120 - intensity * 40);
          a = 0.2 + intensity * 0.3;
        }

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
        ctx.fill();

        if (intensity > 0.6 && v.zoom > 5) {
          ctx.strokeStyle = `rgba(255, 220, 150, ${intensity * 0.4})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      });

      ctx.restore();
    }

    if (showScratches && scratchLines && scratchLines.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
      ctx.clip();

      scratchLines.forEach((scratch) => {
        const startP = worldToScreen(scratch.startX, scratch.startY);
        const endP = worldToScreen(scratch.endX, scratch.endY);
        const colors = getScratchColor(scratch);

        const midX = (startP.x + endP.x) / 2;
        const midY = (startP.y + endP.y) / 2;
        const dx = endP.x - startP.x;
        const dy = endP.y - startP.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const extendFactor = 1.15;
        const extX = len > 0 ? (dx / len) * len * (extendFactor - 1) / 2 : 0;
        const extY = len > 0 ? (dy / len) * len * (extendFactor - 1) / 2 : 0;
        const sx = startP.x - extX;
        const sy = startP.y - extY;
        const ex = endP.x + extX;
        const ey = endP.y + extY;

        ctx.shadowColor = colors.glow;
        ctx.shadowBlur = isHighConfidence(scratch) ? 25 : isMediumConfidence(scratch) ? 15 : 8;

        ctx.strokeStyle = colors.line;
        ctx.lineWidth = isHighConfidence(scratch)
          ? Math.max(3.5, 3.5 * Math.min(v.zoom / 2, 3))
          : isMediumConfidence(scratch)
            ? Math.max(2.5, 2.5 * Math.min(v.zoom / 2.5, 2.5))
            : Math.max(1.8, 1.8 * Math.min(v.zoom / 3, 2));
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        ctx.shadowBlur = 0;

        if (isHighConfidence(scratch) && v.zoom > 2 && len > 0) {
          const nLines = 3;
          for (let i = 1; i <= nLines; i++) {
            ctx.strokeStyle = colors.line;
            ctx.globalAlpha = 0.15 / i;
            ctx.lineWidth = Math.max(1, ctx.lineWidth / (i + 0.5));
            const offset = i * 4;
            const nx = -dy / len * offset;
            const ny = dx / len * offset;

            ctx.beginPath();
            ctx.moveTo(sx + nx, sy + ny);
            ctx.lineTo(ex + nx, ey + ny);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(sx - nx, sy - ny);
            ctx.lineTo(ex - nx, ey - ny);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }

        if (v.zoom > 4) {
          const labelX = midX;
          const labelY = midY - 14;
          ctx.font = isHighConfidence(scratch) ? 'bold 11px sans-serif' : '10px sans-serif';
          const label = `⚡ ${colors.label} ${scratch.waferId || ''}`;
          const textWidth = ctx.measureText(label).width;
          ctx.fillStyle = 'rgba(10, 14, 20, 0.85)';
          ctx.fillRect(labelX - textWidth / 2 - 5, labelY - 10, textWidth + 10, 14);
          ctx.fillStyle = colors.line;
          ctx.textAlign = 'center';
          ctx.fillText(label, labelX, labelY);
        }
      });

      ctx.restore();
    }

    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
    ctx.stroke();

    const notchAngle = -Math.PI / 2;
    const notchX = center.x + Math.cos(notchAngle) * radiusPx;
    const notchY = center.y + Math.sin(notchAngle) * radiusPx;

    ctx.fillStyle = '#58a6ff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('↑ Notch', notchX, notchY - 12);

    ctx.fillStyle = '#8b949e';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${(WAFER_RADIUS_MM * 2).toFixed(0)}mm`, center.x + radiusPx + 8, center.y + 4);

    ctx.restore();
  }, [canvasSize, worldToScreen, fetchTileData, scratchLines, showScratches]);

  const requestRender = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    animFrameRef.current = requestAnimationFrame(render);
  }, [render]);

  useEffect(() => {
    defectsCacheRef.current.clear();
    requestRender();
  }, [batchId, waferId, mockDefects, scratchLines, showScratches, requestRender]);

  const handleMouseDown = (e) => {
    isDraggingRef.current = true;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e) => {
    if (!isDraggingRef.current) return;

    const dx = e.clientX - lastPosRef.current.x;
    const dy = e.clientY - lastPosRef.current.y;

    viewRef.current.offsetX += dx;
    viewRef.current.offsetY += dy;

    lastPosRef.current = { x: e.clientX, y: e.clientY };

    requestRender();
    if (onViewChange) onViewChange(viewRef.current);
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e) => {
    e.preventDefault();

    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const before = screenToWorld(mouseX, mouseY);

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewRef.current.zoom * zoomFactor));
    viewRef.current.zoom = newZoom;

    const after = screenToWorld(mouseX, mouseY);

    viewRef.current.offsetX += (after.x - before.x) * newZoom;
    viewRef.current.offsetY += (after.y - before.y) * newZoom;

    requestRender();
    if (onViewChange) onViewChange(viewRef.current);
  };

  const handleClick = async (e) => {
    if (!batchId || !onDefectPick) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);

    const distFromCenter = Math.sqrt(world.x ** 2 + world.y ** 2);
    if (distFromCenter > WAFER_RADIUS_MM) return;

    if (scratchLines && scratchLines.length > 0 && onScratchClick) {
      for (const scratch of scratchLines) {
        const { a, b, c } = getLineEquation(scratch);
        if (a === 0 && b === 0) continue;
        const dist = Math.abs(a * world.x + b * world.y + c) / Math.sqrt(a * a + b * b);
        if (dist <= 2.0) {
          onScratchClick(scratch);
          return;
        }
      }
    }

    const pickRadius = 3 / viewRef.current.zoom;

    if (mockDefects) {
      const picked = pickDefectAtPoint(mockDefects, world.x, world.y, pickRadius);
      onDefectPick(picked, world);
      return;
    }

    try {
      const params = new URLSearchParams({
        batchId,
        x: world.x,
        y: world.y,
        radius: pickRadius,
      });
      if (waferId) params.set('waferId', waferId);

      const res = await fetch(`/api/defects/pick?${params.toString()}`);
      const defects = await res.json();
      onDefectPick(defects, world);
    } catch (e) {
      console.error('Pick error:', e);
    }
  };

  const handleZoomIn = () => {
    const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
    const before = screenToWorld(center.x, center.y);
    viewRef.current.zoom = Math.min(MAX_ZOOM, viewRef.current.zoom * 1.5);
    const after = screenToWorld(center.x, center.y);
    viewRef.current.offsetX += (after.x - before.x) * viewRef.current.zoom;
    viewRef.current.offsetY += (after.y - before.y) * viewRef.current.zoom;
    requestRender();
  };

  const handleZoomOut = () => {
    const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
    const before = screenToWorld(center.x, center.y);
    viewRef.current.zoom = Math.max(MIN_ZOOM, viewRef.current.zoom / 1.5);
    const after = screenToWorld(center.x, center.y);
    viewRef.current.offsetX += (after.x - before.x) * viewRef.current.zoom;
    viewRef.current.offsetY += (after.y - before.y) * viewRef.current.zoom;
    requestRender();
  };

  const handleReset = () => {
    const minDim = Math.min(canvasSize.width, canvasSize.height);
    const zoom = (minDim * 0.8) / (WAFER_RADIUS_MM * 2);
    viewRef.current = {
      offsetX: canvasSize.width / 2,
      offsetY: canvasSize.height / 2,
      zoom,
    };
    defectsCacheRef.current.clear();
    requestRender();
  };

  return (
    <div ref={containerRef} className="canvas-container">
      <canvas
        ref={canvasRef}
        className="wafer-canvas"
        width={canvasSize.width * (window.devicePixelRatio || 1)}
        height={canvasSize.height * (window.devicePixelRatio || 1)}
        style={{ width: canvasSize.width, height: canvasSize.height }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onClick={handleClick}
      />

      <div className="toolbar">
        <button onClick={handleZoomIn} title="放大">+</button>
        <button onClick={handleZoomOut} title="缩小">−</button>
        <button onClick={handleReset} title="重置">⟲</button>
      </div>

      <div className="info-panel">
        <div className="row">
          <span className="label">缩放</span>
          <span className="value">{(viewRef.current.zoom * 10).toFixed(1)}x</span>
        </div>
        <div className="row">
          <span className="label">可见缺陷</span>
          <span className="value">{defectCount.toLocaleString()}</span>
        </div>
        <div className="row">
          <span className="label">晶圆</span>
          <span className="value">{waferId || '全部'}</span>
        </div>
        {scratchLines && scratchLines.length > 0 && (
          <div className="row">
            <span className="label">⚡ 划痕</span>
            <span className="value" style={{ color: '#ff1a1a' }}>{scratchLines.length}</span>
          </div>
        )}
      </div>

      <div className="legend">
        <div style={{ fontWeight: 500, marginBottom: 6, color: '#c9d1d9' }}>缺陷密度</div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: 'rgba(255, 80, 50, 0.9)' }}></div>
          <span>高密度</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: 'rgba(220, 150, 100, 0.7)' }}></div>
          <span>中密度</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: 'rgba(120, 120, 120, 0.4)' }}></div>
          <span>低密度</span>
        </div>
        {scratchLines && scratchLines.length > 0 && (
          <>
            <div style={{ height: 1, background: '#30363d', margin: '8px 0' }}></div>
            <div style={{ fontWeight: 500, marginBottom: 6, color: '#c9d1d9' }}>划痕告警</div>
            <div className="legend-item">
              <div style={{ width: 16, height: 3, background: '#ff1a1a', boxShadow: '0 0 6px #ff1a1a', borderRadius: 2 }}></div>
              <span>严重</span>
            </div>
            <div className="legend-item">
              <div style={{ width: 16, height: 3, background: '#ff6b35', boxShadow: '0 0 4px #ff6b35', borderRadius: 2 }}></div>
              <span>警告</span>
            </div>
            <div className="legend-item">
              <div style={{ width: 16, height: 3, background: '#ffc107', boxShadow: '0 0 3px #ffc107', borderRadius: 2 }}></div>
              <span>提示</span>
            </div>
          </>
        )}
      </div>

      {isLoading && <div className="loading">加载中...</div>}
    </div>
  );
}
