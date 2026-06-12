import React, { useState, useEffect, useRef } from 'react';
import { generateMockOverlapResult } from '../utils/mockOverlap.js';

export default function OverlapAnalysisPanel({ batch, wafers, mockMode, mockDefects, onClose }) {
  const [taskStatus, setTaskStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (batch) {
      startAnalysis();
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [batch]);

  const startAnalysis = async () => {
    setResult(null);
    setError(null);

    if (mockMode) {
      setTaskStatus({
        taskId: 'mock_task',
        status: 'running',
        progress: { phase: '模拟计算中', percent: 0, message: '初始化...' },
      });

      const phases = [
        { phase: '数据加载', percent: 20, delay: 400 },
        { phase: '空间网格构建', percent: 40, delay: 400 },
        { phase: '晶圆对重叠计算', percent: 70, delay: 600 },
        { phase: '热点区域聚合', percent: 90, delay: 300 },
        { phase: '结果序列化', percent: 100, delay: 200 },
      ];

      let i = 0;
      const runPhase = () => {
        if (i >= phases.length) {
          setTaskStatus({
            taskId: 'mock_task',
            status: 'completed',
            progress: { phase: '完成', percent: 100, message: '分析完成' },
          });
          const overlapResult = generateMockOverlapResult(
            batch.batchName, wafers, mockDefects
          );
          setResult(overlapResult);
          return;
        }
        setTaskStatus({
          taskId: 'mock_task',
          status: 'running',
          progress: phases[i],
        });
        i++;
        setTimeout(runPhase, phases[i - 1]?.delay || 300);
      };
      runPhase();
      return;
    }

    try {
      const res = await fetch(`/api/tasks/overlap-analysis/${batch.id}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to submit task');
      const task = await res.json();
      setTaskStatus(task);

      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/tasks/${task.taskId}`);
          const status = await statusRes.json();
          setTaskStatus(status);

          if (status.status === 'completed') {
            clearInterval(pollRef.current);
            const resultRes = await fetch(`/api/tasks/${task.taskId}/result`);
            const analysisResult = await resultRes.json();
            setResult(analysisResult);
          } else if (status.status === 'failed') {
            clearInterval(pollRef.current);
            setError(status.error || '任务执行失败');
          }
        } catch (e) {
          console.error('Poll error:', e);
        }
      }, 1500);

    } catch (e) {
      setError(e.message || '提交任务失败，请确认后端服务已启动');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'queued': return '#f0883e';
      case 'running': return '#58a6ff';
      case 'completed': return '#3fb950';
      case 'failed': return '#f85149';
      default: return '#8b949e';
    }
  };

  const renderHeatmap = () => {
    if (!result) return null;
    const waferIds = Object.keys(result.perWaferStats).sort();
    const cellSize = Math.max(20, Math.min(36, 280 / waferIds.length));

    const maxRatio = Math.max(...waferIds.flatMap(a =>
      waferIds.map(b => result.waferMatrix[a]?.[b] || 0)
    ), 1);

    return (
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: '#c9d1d9' }}>
          晶圆重叠热力矩阵
        </div>
        <div style={{
          display: 'inline-block',
          background: '#141b23',
          padding: 12,
          borderRadius: 6,
          overflow: 'auto',
          maxWidth: '100%',
        }}>
          <div style={{ display: 'flex' }}>
            <div style={{ width: cellSize + 8 }}></div>
            {waferIds.map(w => (
              <div
                key={w}
                style={{
                  width: cellSize,
                  height: cellSize,
                  fontSize: 10,
                  color: '#8b949e',
                  textAlign: 'center',
                  lineHeight: `${cellSize}px`,
                  transform: 'rotate(-45deg)',
                  overflow: 'hidden',
                }}
                title={w}
              >
                {w.replace(/^.*_/, '')}
              </div>
            ))}
          </div>
          {waferIds.map(wA => (
            <div key={wA} style={{ display: 'flex' }}>
              <div
                style={{
                  width: cellSize + 8,
                  height: cellSize,
                  fontSize: 10,
                  color: '#8b949e',
                  lineHeight: `${cellSize}px`,
                  textAlign: 'right',
                  paddingRight: 4,
                }}
              >
                {wA.replace(/^.*_/, '')}
              </div>
              {waferIds.map(wB => {
                const count = wA === wB ? 0 : (result.waferMatrix[wA]?.[wB] || 0);
                const intensity = count / maxRatio;
                const bg = wA === wB
                  ? '#21262d'
                  : `rgba(255, ${Math.floor(150 - intensity * 100)}, ${Math.floor(80 - intensity * 60)}, ${0.3 + intensity * 0.7})`;
                return (
                  <div
                    key={`${wA}-${wB}`}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      background: bg,
                      border: '1px solid #30363d',
                      fontSize: 9,
                      color: intensity > 0.4 ? '#fff' : 'transparent',
                      textAlign: 'center',
                      lineHeight: `${cellSize}px`,
                      cursor: wA !== wB ? 'pointer' : 'default',
                    }}
                    title={wA !== wB ? `${wA} ↔ ${wB}: ${count} 重叠` : wA}
                  >
                    {wA !== wB && count > 0 && count / maxRatio > 0.15 ? count : ''}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTopPairs = () => {
    if (!result) return null;
    const topPairs = result.overlapPairs.slice(0, 8);

    return (
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: '#c9d1d9' }}>
          高重叠晶圆对 Top 8
        </div>
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          {topPairs.map((pair, idx) => {
            const maxRatio = result.overlapPairs[0]?.overlapRatio || 1;
            const barWidth = (pair.overlapRatio / maxRatio) * 100;
            return (
              <div key={idx} style={{ marginBottom: 8 }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  marginBottom: 3,
                }}>
                  <span style={{ color: '#c9d1d9' }}>
                    <span style={{ color: '#58a6ff' }}>{pair.waferA.replace(/^.*_/, '')}</span>
                    {' ↔ '}
                    <span style={{ color: '#58a6ff' }}>{pair.waferB.replace(/^.*_/, '')}</span>
                  </span>
                  <span style={{ color: '#f0883e', fontWeight: 500 }}>
                    {(pair.overlapRatio * 100).toFixed(2)}%
                  </span>
                </div>
                <div style={{
                  height: 6,
                  background: '#21262d',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${barWidth}%`,
                    background: 'linear-gradient(90deg, #f0883e, #f85149)',
                    borderRadius: 3,
                  }}></div>
                </div>
                <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>
                  {pair.overlapCount.toLocaleString()} 个重叠缺陷点
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderHotspots = () => {
    if (!result || !result.globalHotspots) return null;

    return (
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: '#c9d1d9' }}>
          全局重叠热点 ({result.globalHotspots.length})
        </div>
        <div style={{ maxHeight: 180, overflowY: 'auto' }}>
          {result.globalHotspots.map((hs, idx) => (
            <div key={idx} style={{
              padding: '8px 10px',
              background: '#21262d',
              borderRadius: 4,
              marginBottom: 4,
              fontSize: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#8b949e' }}>
                  #{idx + 1} 中心 ({hs.centroidX.toFixed(1)}, {hs.centroidY.toFixed(1)}) mm
                </span>
                <span style={{ color: '#f85149', fontWeight: 600 }}>
                  {hs.defectCount.toLocaleString()}
                </span>
              </div>
              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {hs.involvedWafers.slice(0, 4).map(w => (
                  <span key={w} style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    background: '#1f6feb33',
                    color: '#58a6ff',
                    borderRadius: 3,
                  }}>
                    {w.replace(/^.*_/, '')}
                  </span>
                ))}
                {hs.involvedWafers.length > 4 && (
                  <span style={{ fontSize: 10, color: '#8b949e' }}>
                    +{hs.involvedWafers.length - 4}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      right: 0,
      width: 380,
      height: '100%',
      background: '#141b23',
      borderLeft: '1px solid #30363d',
      padding: 16,
      overflowY: 'auto',
      zIndex: 20,
      boxShadow: '-4px 0 20px rgba(0,0,0,0.3)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
      }}>
        <h3 style={{ fontSize: 15, color: '#58a6ff', margin: 0 }}>
          🔬 晶圆缺陷重叠分析
        </h3>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: '1px solid #30363d',
            color: '#8b949e',
            width: 28,
            height: 28,
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
          }}
        >×</button>
      </div>

      <div style={{
        background: '#21262d',
        padding: 12,
        borderRadius: 6,
        marginBottom: 12,
      }}>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6 }}>
          分析批次
        </div>
        <div style={{ fontSize: 14, color: '#c9d1d9', fontWeight: 500 }}>
          {batch?.batchName || '-'}
        </div>
        <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
          {wafers.length} 片晶圆
        </div>
      </div>

      {taskStatus && !result && !error && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <div style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: getStatusColor(taskStatus.status),
                boxShadow: taskStatus.status === 'running'
                  ? `0 0 8px ${getStatusColor(taskStatus.status)}`
                  : 'none',
              }}></div>
              <span style={{ fontSize: 13, color: '#c9d1d9' }}>
                {taskStatus.status === 'queued' && '排队中'}
                {taskStatus.status === 'running' && '运行中'}
                {taskStatus.status === 'completed' && '已完成'}
                {taskStatus.status === 'failed' && '失败'}
              </span>
            </div>
            <span style={{ fontSize: 12, color: '#58a6ff', fontWeight: 500 }}>
              {taskStatus.progress?.percent.toFixed(0)}%
            </span>
          </div>
          <div style={{
            height: 6,
            background: '#21262d',
            borderRadius: 3,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${taskStatus.progress?.percent || 0}%`,
              background: 'linear-gradient(90deg, #58a6ff, #1f6feb)',
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }}></div>
          </div>
          <div style={{ fontSize: 11, color: '#8b949e', marginTop: 6 }}>
            {taskStatus.progress?.phase}: {taskStatus.progress?.message}
          </div>
        </div>
      )}

      {error && (
        <div style={{
          padding: 12,
          background: 'rgba(248, 81, 73, 0.1)',
          border: '1px solid #f85149',
          borderRadius: 6,
          marginBottom: 12,
          fontSize: 12,
          color: '#f85149',
        }}>
          ⚠️ {error}
        </div>
      )}

      {result && result.summary && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 12,
        }}>
          <div style={{
            background: '#21262d',
            padding: 10,
            borderRadius: 6,
          }}>
            <div style={{ fontSize: 11, color: '#8b949e' }}>缺陷总数</div>
            <div style={{ fontSize: 16, color: '#c9d1d9', fontWeight: 600 }}>
              {result.summary.totalDefects.toLocaleString()}
            </div>
          </div>
          <div style={{
            background: '#21262d',
            padding: 10,
            borderRadius: 6,
          }}>
            <div style={{ fontSize: 11, color: '#8b949e' }}>平均重叠率</div>
            <div style={{ fontSize: 16, color: '#f0883e', fontWeight: 600 }}>
              {(result.summary.avgOverlapRatio * 100).toFixed(2)}%
            </div>
          </div>
          <div style={{
            background: '#21262d',
            padding: 10,
            borderRadius: 6,
            gridColumn: '1 / 3',
          }}>
            <div style={{ fontSize: 11, color: '#8b949e' }}>最高重叠对</div>
            <div style={{ fontSize: 14, color: '#f85149', fontWeight: 600, marginTop: 4 }}>
              {result.summary.highestOverlapPair[0]?.replace(/^.*_/, '')} ↔{' '}
              {result.summary.highestOverlapPair[1]?.replace(/^.*_/, '')}
              <span style={{ color: '#8b949e', fontSize: 12, marginLeft: 8 }}>
                {(result.summary.highestOverlapRatio * 100).toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {result && (
        <button
          onClick={startAnalysis}
          style={{
            width: '100%',
            padding: 8,
            background: '#21262d',
            border: '1px solid #30363d',
            borderRadius: 6,
            color: '#c9d1d9',
            fontSize: 12,
            cursor: 'pointer',
            marginBottom: 8,
          }}
        >
          🔄 重新分析
        </button>
      )}

      {result && renderHeatmap()}
      {result && renderTopPairs()}
      {result && renderHotspots()}
    </div>
  );
}
