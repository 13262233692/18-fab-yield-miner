import React, { useState, useEffect, useRef } from 'react';
import { runMockRadonAnalysis } from '../utils/mockRadon.js';
import { getSeverityColor } from '../utils/mockRadon.js';

export default function ScratchDetectionPanel({
  batch,
  wafers,
  selectedWafer,
  mockMode,
  mockDefects,
  onApplyScratches,
  onClose,
}) {
  const [taskStatus, setTaskStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [activeWafer, setActiveWafer] = useState(selectedWafer || wafers[0] || null);
  const [alerts, setAlerts] = useState([]);
  const pollRef = useRef(null);
  const sseRef = useRef(null);

  useEffect(() => {
    if (activeWafer && result) {
      const waferResult = result.wafers?.find(w => w.waferId === activeWafer);
      if (waferResult && onApplyScratches) {
        onApplyScratches(waferResult.scratchLines);
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (sseRef.current) sseRef.current.close();
    };
  }, [activeWafer, result, onApplyScratches]);

  useEffect(() => {
    if (selectedWafer) setActiveWafer(selectedWafer);
  }, [selectedWafer]);

  useEffect(() => {
    if (batch) {
      startDetection();
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (sseRef.current) sseRef.current.close();
    };
  }, [batch]);

  const startDetection = async () => {
    setResult(null);
    setError(null);
    setAlerts([]);

    if (mockMode) {
      setTaskStatus({
        taskId: 'mock_scratch_task',
        status: 'running',
        progress: { phase: '初始化', percent: 0, message: '加载 Radon 变换算子...' },
      });

      const phases = [
        { phase: '构建空间矩阵', percent: 15, delay: 300 },
        { phase: 'Radon 变换 (0-180°)', percent: 40, delay: 500 },
        { phase: '峰值检测', percent: 65, delay: 300 },
        { phase: '反算直线方程', percent: 85, delay: 250 },
        { phase: '批次聚合', percent: 100, delay: 200 },
      ];

      let phaseIdx = 0;
      const runPhase = () => {
        if (phaseIdx >= phases.length) {
          finalizeMockResult();
          return;
        }
        setTaskStatus({
          taskId: 'mock_scratch_task',
          status: 'running',
          progress: phases[phaseIdx],
        });
        phaseIdx++;
        setTimeout(runPhase, phases[phaseIdx - 1]?.delay || 300);
      };
      runPhase();

      const mockAlerts = [];
      const allWafers = wafers.length > 0 ? wafers : ['W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08'];
      allWafers.forEach(w => {
        setTimeout(() => {
          const resultForWafer = runMockRadonAnalysis(mockDefects, w);
          if (resultForWafer.severityCount.CRITICAL > 0 || resultForWafer.severityCount.WARNING > 0) {
            const hasCritical = resultForWafer.severityCount.CRITICAL > 0;
            const alert = {
              type: 'scratch_detected',
              waferId: w,
              severity: hasCritical ? 'CRITICAL' : 'WARNING',
              scratchCount: resultForWafer.scratchLines.length,
              criticalCount: resultForWafer.severityCount.CRITICAL,
              warningCount: resultForWafer.severityCount.WARNING,
              timestamp: Date.now(),
            };
            mockAlerts.push(alert);
            setAlerts([...mockAlerts]);
          }
        }, Math.random() * 1200);
      });

      return;
    }

    try {
      const res = await fetch(`/api/scratch/detect/batch/${batch.id}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to submit scratch detection');
      const task = await res.json();
      setTaskStatus(task);

      try {
        sseRef.current = new EventSource(`/api/scratch/stream/${task.taskId}`);
        sseRef.current.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'scratch_detected') {
              setAlerts(prev => [...prev, data]);
            } else if (data.type === 'progress' || data.meta) {
              if (data.meta) {
                setTaskStatus(data.meta);
                if (data.meta.status === 'completed' && data.result) {
                  setResult(data.result);
                }
              }
            }
          } catch (e) {
            console.warn('SSE parse error:', e);
          }
        };
        sseRef.current.onerror = (e) => {
          console.warn('SSE error, falling back to polling');
          startPolling(task.taskId);
        };
      } catch (sseErr) {
        startPolling(task.taskId);
      }

    } catch (e) {
      setError(e.message || '划痕检测任务提交失败');
    }
  };

  const startPolling = (taskId) => {
    pollRef.current = setInterval(async () => {
      try {
        const statusRes = await fetch(`/api/scratch/task/${taskId}/status`);
        const status = await statusRes.json();
        setTaskStatus(status);

        if (status.status === 'completed') {
          clearInterval(pollRef.current);
          const resultRes = await fetch(`/api/scratch/result/${taskId}`);
          const analysisResult = await resultRes.json();
          setResult(analysisResult);
        } else if (status.status === 'failed') {
          clearInterval(pollRef.current);
          setError(status.error || '检测失败');
        }
      } catch (e) {
        console.error('Poll error:', e);
      }
    }, 2000);
  };

  const finalizeMockResult = () => {
    const allWafers = wafers.length > 0 ? wafers : ['W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08'];
    const waferResults = allWafers.map(w => {
      const defectsForWafer = mockDefects
        ? mockDefects.filter(d => d.waferId === w || d.waferId.endsWith(w))
        : [];
      return {
        waferId: w,
        batchId: batch?.id,
        ...runMockRadonAnalysis(defectsForWafer, w),
      };
    });

    const summary = {
      totalWafers: waferResults.length,
      wafersWithScratches: waferResults.filter(w => w.scratchLines.length > 0).length,
      totalCritical: waferResults.reduce((s, w) => s + w.severityCount.CRITICAL, 0),
      totalWarning: waferResults.reduce((s, w) => s + w.severityCount.WARNING, 0),
      totalMild: waferResults.reduce((s, w) => s + w.severityCount.MILD, 0),
    };

    let highestWafer = null;
    let highestScore = 0;
    waferResults.forEach(w => {
      const score = w.severityCount.CRITICAL * 3 + w.severityCount.WARNING * 2 + w.severityCount.MILD;
      if (score > highestScore) {
        highestScore = score;
        highestWafer = w.waferId;
      }
    });
    summary.highestSeverityWafer = highestWafer;

    setTaskStatus({
      taskId: 'mock_scratch_task',
      status: 'completed',
      progress: { phase: '完成', percent: 100, message: 'Radon 变换划痕检测完成' },
    });

    setResult({
      taskId: 'mock_scratch_task',
      batchId: batch?.id,
      wafers: waferResults,
      summary,
      completedAt: Date.now(),
    });
  };

  const currentWaferResult = result?.wafers?.find(w => w.waferId === activeWafer);
  const statusColor = (s) => ({
    queued: '#f0883e', running: '#58a6ff', completed: '#3fb950', failed: '#f85149'
  }[s] || '#8b949e');

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      right: 0,
      width: 400,
      height: '100%',
      background: '#141b23',
      borderLeft: '1px solid #30363d',
      padding: 16,
      overflowY: 'auto',
      zIndex: 20,
      boxShadow: '-4px 0 20px rgba(0,0,0,0.3)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, color: '#f85149', margin: 0 }}>
          ⚡ Radon 划痕检测
        </h3>
        <button onClick={onClose} style={{
          background: 'transparent', border: '1px solid #30363d', color: '#8b949e',
          width: 28, height: 28, borderRadius: 4, cursor: 'pointer', fontSize: 16, lineHeight: 1,
        }}>×</button>
      </div>

      <div style={{ background: '#21262d', padding: 10, borderRadius: 6, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>分析批次</div>
        <div style={{ fontSize: 13, color: '#c9d1d9', fontWeight: 500 }}>{batch?.batchName}</div>
        <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>
          Radon 变换: 0-180° 积分投影
        </div>
      </div>

      {taskStatus && !result && !error && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: statusColor(taskStatus.status),
                boxShadow: taskStatus.status === 'running'
                  ? `0 0 8px ${statusColor(taskStatus.status)}` : 'none',
              }}></div>
              <span style={{ fontSize: 12, color: '#c9d1d9' }}>
                {taskStatus.status === 'queued' && '排队中'}
                {taskStatus.status === 'running' && '扫描中'}
                {taskStatus.status === 'completed' && '完成'}
                {taskStatus.status === 'failed' && '失败'}
              </span>
            </div>
            <span style={{ fontSize: 12, color: '#58a6ff', fontWeight: 500 }}>
              {taskStatus.progress?.percent.toFixed(0)}%
            </span>
          </div>
          <div style={{ height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${taskStatus.progress?.percent || 0}%`,
              background: 'linear-gradient(90deg, #f85149, #f0883e)',
              borderRadius: 3, transition: 'width 0.3s ease',
            }}></div>
          </div>
          <div style={{ fontSize: 11, color: '#8b949e', marginTop: 6 }}>
            {taskStatus.progress?.phase}: {taskStatus.progress?.message}
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: 10, background: 'rgba(248,81,73,0.1)', border: '1px solid #f85149',
          borderRadius: 6, marginBottom: 12, fontSize: 12, color: '#f85149' }}>⚠️ {error}</div>
      )}

      {alerts.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: '#c9d1d9' }}>
            🚨 实时告警 ({alerts.length})
          </div>
          <div style={{ maxHeight: 140, overflowY: 'auto' }}>
            {[...alerts].reverse().slice(0, 8).map((alert, idx) => (
              <div key={idx} style={{
                padding: '6px 8px', marginBottom: 4, borderRadius: 4,
                background: alert.severity === 'CRITICAL'
                  ? 'rgba(248,81,73,0.15)' : 'rgba(255,145,0,0.12)',
                borderLeft: `3px solid ${alert.severity === 'CRITICAL' ? '#f85149' : '#ff9100'}`,
                fontSize: 11,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{
                    color: alert.severity === 'CRITICAL' ? '#f85149' : '#ff9100',
                    fontWeight: 600,
                  }}>⚡ {alert.severity}</span>
                  <span style={{ color: '#8b949e' }}>{alert.waferId.replace(/^.*_/, '')}</span>
                </div>
                <div style={{ color: '#c9d1d9', marginTop: 2 }}>
                  {alert.scratchCount} 条划痕
                  {alert.criticalCount > 0 && <span style={{ color: '#f85149' }}> ({alert.criticalCount} 致命)</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && result.summary && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 14 }}>
          <div style={{ background: '#21262d', padding: 8, borderRadius: 6, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#8b949e' }}>有划痕</div>
            <div style={{ fontSize: 15, color: result.summary.wafersWithScratches > 0 ? '#f85149' : '#3fb950', fontWeight: 600 }}>
              {result.summary.wafersWithScratches}/{result.summary.totalWafers}
            </div>
          </div>
          <div style={{ background: '#21262d', padding: 8, borderRadius: 6, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#8b949e' }}>致命</div>
            <div style={{ fontSize: 15, color: '#f85149', fontWeight: 600 }}>{result.summary.totalCritical}</div>
          </div>
          <div style={{ background: '#21262d', padding: 8, borderRadius: 6, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#8b949e' }}>警告</div>
            <div style={{ fontSize: 15, color: '#ff9100', fontWeight: 600 }}>{result.summary.totalWarning}</div>
          </div>
        </div>
      )}

      {result && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: '#c9d1d9' }}>晶圆结果</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 10 }}>
            {result.wafers?.map((w) => {
              const hasScratch = w.scratchLines.length > 0;
              const hasCritical = w.severityCount.CRITICAL > 0;
              const hasWarning = w.severityCount.WARNING > 0;
              return (
                <button
                  key={w.waferId}
                  onClick={() => setActiveWafer(w.waferId)}
                  style={{
                    padding: '8px 4px',
                    border: activeWafer === w.waferId ? '2px solid #58a6ff' : '1px solid #30363d',
                    borderRadius: 4,
                    background: hasCritical
                      ? 'rgba(248,81,73,0.2)'
                      : hasWarning
                        ? 'rgba(255,145,0,0.15)'
                        : hasScratch
                          ? 'rgba(255,196,0,0.1)'
                          : '#21262d',
                    cursor: 'pointer',
                    fontSize: 11,
                    color: activeWafer === w.waferId ? '#fff' : '#c9d1d9',
                  }}
                >
                  <div>{w.waferId.replace(/^.*_/, '')}</div>
                  <div style={{ fontSize: 9, marginTop: 2, color: '#8b949e' }}>
                    {hasCritical ? '🔥' : hasWarning ? '⚠️' : hasScratch ? '~' : '✓'}
                    {' '}{w.scratchLines.length}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {currentWaferResult && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: '#c9d1d9' }}>
            {currentWaferResult.waferId} 划痕详情 ({currentWaferResult.scratchLines.length})
          </div>
          {currentWaferResult.scratchLines.length === 0 ? (
            <div style={{ padding: 12, background: '#21262d', borderRadius: 6, textAlign: 'center',
              fontSize: 12, color: '#3fb950' }}>
              ✅ 未检测到划痕特征
            </div>
          ) : (
            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {currentWaferResult.scratchLines.map((s, idx) => {
                const c = getSeverityColor(s.severity);
                return (
                  <div key={s.id || idx} style={{
                    padding: '8px 10px', marginBottom: 5,
                    background: '#21262d', borderRadius: 4,
                    borderLeft: `3px solid ${c.line}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        color: c.line,
                      }}>
                        {s.severity === 'CRITICAL' && '🔴 '}
                        {s.severity === 'WARNING' && '🟠 '}
                        {s.severity === 'MILD' && '🟡 '}
                        Scratch #{idx + 1}
                      </span>
                      <span style={{ fontSize: 10, color: '#8b949e' }}>
                        {s.angleDeg?.toFixed?.(1) || Math.abs(Math.atan2(s.endY - s.startY, s.endX - s.startX) * 180 / Math.PI).toFixed(1)}°
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#c9d1d9', marginTop: 4 }}>
                      缺陷数: <span style={{ color: '#c9d1d9', fontWeight: 500 }}>{s.defectCount?.toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>
                      中心距原点: {Math.abs(s.rho || s.c || 0).toFixed(1)} mm
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {result && (
        <button onClick={startDetection} style={{
          width: '100%', padding: 8, background: '#21262d',
          border: '1px solid #30363d', borderRadius: 6, color: '#c9d1d9',
          fontSize: 12, cursor: 'pointer', marginTop: 4,
        }}>
          🔄 重新执行 Radon 检测
        </button>
      )}
    </div>
  );
}
