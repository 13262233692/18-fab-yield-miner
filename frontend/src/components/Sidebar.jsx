import React from 'react';

export default function Sidebar({
  batches,
  selectedBatch,
  onSelectBatch,
  wafers,
  selectedWafer,
  onSelectWafer,
  onUpload,
  clusters,
  onSelectCluster,
  onGenerateSample,
  onStartOverlapAnalysis,
}) {
  const fileInputRef = React.useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && onUpload) {
      onUpload(file);
    }
  };

  return (
    <div className="sidebar">
      <h2>🔬 Fab Yield Miner</h2>
      <p style={{ fontSize: 12, color: '#8b949e', marginBottom: 12 }}>
        晶圆缺陷空间聚集模式挖掘
      </p>

      <div className="upload-section">
        <input
          ref={fileInputRef}
          type="file"
          className="upload-input"
          accept=".csv,.txt,.tsv"
          onChange={handleFileChange}
        />
        <button
          className="upload-btn"
          onClick={() => fileInputRef.current?.click()}
        >
          📁 上传晶圆坐标文件
        </button>
        <button
          className="upload-btn"
          style={{ background: '#238636' }}
          onClick={onGenerateSample}
        >
          🎲 生成示例数据
        </button>
      </div>

      <h3>批次列表</h3>
      <ul className="batch-list">
        {batches.length === 0 ? (
          <li style={{ fontSize: 12, color: '#8b949e', padding: 8 }}>
            暂无批次数据
          </li>
        ) : (
          batches.map((batch) => (
            <li
              key={batch.id}
              className={`batch-item ${selectedBatch?.id === batch.id ? 'active' : ''}`}
              onClick={() => onSelectBatch(batch)}
            >
              <div className="batch-name">{batch.batchName}</div>
              <div className="batch-info">
                {batch.waferCount} 片晶圆 · {batch.defectCount.toLocaleString()} 缺陷
              </div>
            </li>
          ))
        )}
      </ul>

      {selectedBatch && (
        <>
          <button
            onClick={onStartOverlapAnalysis}
            style={{
              width: '100%',
              padding: '10px',
              background: '#8957e5',
              border: 'none',
              borderRadius: 6,
              color: 'white',
              fontSize: 13,
              cursor: 'pointer',
              marginTop: 4,
              marginBottom: 12,
            }}
          >
            🔬 晶圆缺陷重叠分析
          </button>

          <h3>晶圆选择</h3>
          <div className="wafer-tabs">
            <div
              className={`wafer-tab ${!selectedWafer ? 'active' : ''}`}
              onClick={() => onSelectWafer(null)}
            >
              全部
            </div>
            {wafers.map((wafer) => (
              <div
                key={wafer}
                className={`wafer-tab ${selectedWafer === wafer ? 'active' : ''}`}
                onClick={() => onSelectWafer(wafer)}
              >
                {wafer.split('_').pop() || wafer}
              </div>
            ))}
          </div>
        </>
      )}

      {clusters && clusters.length > 0 && (
        <>
          <h3>缺陷聚类 (Top {clusters.length})</h3>
          <div className="cluster-panel">
            {clusters.map((cluster, idx) => (
              <div
                key={cluster.clusterId}
                className="cluster-item"
                onClick={() => onSelectCluster?.(cluster)}
              >
                <div>
                  Cluster #{idx + 1}
                  <span className="cluster-size">
                    {' '}{cluster.defectCount} 个
                  </span>
                </div>
                <div style={{ color: '#8b949e', fontSize: 11, marginTop: 2 }}>
                  中心: ({cluster.centroidX.toFixed(1)}, {cluster.centroidY.toFixed(1)})
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
