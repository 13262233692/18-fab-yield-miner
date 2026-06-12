import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar.jsx';
import WaferMap from './components/WaferMap.jsx';
import OverlapAnalysisPanel from './components/OverlapAnalysisPanel.jsx';
import {
  generateMockDefects,
  getMockWafers,
  getMockBatches,
  pickDefectAtPoint,
  findClusters,
} from './utils/mockData.js';

export default function App() {
  const [batches, setBatches] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [wafers, setWafers] = useState([]);
  const [selectedWafer, setSelectedWafer] = useState(null);
  const [clusters, setClusters] = useState([]);
  const [pickedDefect, setPickedDefect] = useState(null);
  const [mockMode, setMockMode] = useState(false);
  const [showOverlapPanel, setShowOverlapPanel] = useState(false);
  const mockDefectsRef = useRef(null);

  const loadBatches = useCallback(async () => {
    try {
      const res = await fetch('/api/batches');
      if (!res.ok) throw new Error('API not available');
      const data = await res.json();
      setBatches(data);
      setMockMode(false);
      if (data.length > 0 && !selectedBatch) {
        setSelectedBatch(data[0]);
      }
    } catch (e) {
      console.log('Backend not available, using mock data');
      const mockBatches = getMockBatches();
      setBatches(mockBatches);
      setMockMode(true);
      if (!selectedBatch) {
        setSelectedBatch(mockBatches[0]);
      }
      if (!mockDefectsRef.current) {
        mockDefectsRef.current = generateMockDefects(50000);
      }
    }
  }, [selectedBatch]);

  const loadWafers = useCallback(async (batchId) => {
    if (!batchId) return;

    if (mockMode) {
      setWafers(getMockWafers());
      return;
    }

    try {
      const res = await fetch(`/api/defects/wafers/${batchId}`);
      const data = await res.json();
      setWafers(data);
    } catch (e) {
      console.error('Load wafers error:', e);
    }
  }, [mockMode]);

  const loadClusters = useCallback(async (batchId) => {
    if (!batchId) return;

    if (mockMode && mockDefectsRef.current) {
      const clusterResult = findClusters(mockDefectsRef.current, 6.0, 20);
      setClusters(clusterResult);
      return;
    }

    try {
      const res = await fetch(`/api/defects/clusters/${batchId}?eps=8.0&minPoints=15`);
      const data = await res.json();
      setClusters(data);
    } catch (e) {
      console.error('Load clusters error:', e);
    }
  }, [mockMode]);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  useEffect(() => {
    if (selectedBatch) {
      loadWafers(selectedBatch.id);
      loadClusters(selectedBatch.id);
      setSelectedWafer(null);
      setPickedDefect(null);
    }
  }, [selectedBatch, loadWafers, loadClusters]);

  const handleSelectBatch = (batch) => {
    setSelectedBatch(batch);
  };

  const handleSelectWafer = (wafer) => {
    setSelectedWafer(wafer);
  };

  const handleUpload = async (file) => {
    if (mockMode) {
      alert('当前为演示模式，请启动后端服务后再上传数据');
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('batchName', file.name.replace(/\.[^.]+$/, ''));
    formData.append('productName', 'UPLOAD');

    try {
      const res = await fetch('/api/upload/wafermap', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        loadBatches();
      }
    } catch (e) {
      console.error('Upload error:', e);
      alert('上传失败，请确保后端服务已启动');
    }
  };

  const handleGenerateSample = async () => {
    if (mockMode) {
      const count = prompt('请输入模拟缺陷数量（建议 1000 - 100000）', '50000');
      if (count) {
        const num = parseInt(count);
        if (num > 0 && num <= 500000) {
          mockDefectsRef.current = generateMockDefects(num);
          const mockBatches = [
            {
              ...getMockBatches()[0],
              defectCount: num,
              batchName: `DEMO_${num}defects`,
            },
          ];
          setBatches(mockBatches);
          setSelectedBatch(mockBatches[0]);
          loadClusters(mockBatches[0].id);
        }
      }
      return;
    }

    const batchName = `BATCH_${Date.now().toString().slice(-6)}`;
    try {
      const res = await fetch(
        `/api/upload/sample?batchName=${batchName}&waferCount=8&defectsPerWafer=5000`
      );
      const blob = await res.blob();
      const formData = new FormData();
      formData.append('file', blob, `${batchName}_defects.csv`);
      formData.append('batchName', batchName);
      formData.append('productName', 'SAMPLE');

      const uploadRes = await fetch('/api/upload/wafermap', {
        method: 'POST',
        body: formData,
      });
      const data = await uploadRes.json();
      if (data.success) {
        loadBatches();
      }
    } catch (e) {
      console.error('Generate sample error:', e);
    }
  };

  const handleDefectPick = (defects, worldPos) => {
    if (defects && defects.length > 0) {
      setPickedDefect({ defects, position: worldPos });
    } else {
      setPickedDefect(null);
    }
  };

  const handleSelectCluster = (cluster) => {
    console.log('Selected cluster:', cluster);
  };

  const handleStartOverlapAnalysis = () => {
    setShowOverlapPanel(true);
    setPickedDefect(null);
  };

  return (
    <div className="app">
      <Sidebar
        batches={batches}
        selectedBatch={selectedBatch}
        onSelectBatch={handleSelectBatch}
        wafers={wafers}
        selectedWafer={selectedWafer}
        onSelectWafer={handleSelectWafer}
        onUpload={handleUpload}
        clusters={clusters}
        onSelectCluster={handleSelectCluster}
        onGenerateSample={handleGenerateSample}
        onStartOverlapAnalysis={handleStartOverlapAnalysis}
      />

      <div style={{ flex: 1, position: 'relative', display: 'flex' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          {selectedBatch ? (
            <WaferMap
              batchId={selectedBatch.id}
              waferId={selectedWafer}
              onDefectPick={handleDefectPick}
              mockDefects={mockMode ? mockDefectsRef.current : null}
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <div style={{ textAlign: 'center', color: '#8b949e' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🔬</div>
                <h2 style={{ color: '#c9d1d9', marginBottom: 8 }}>晶圆缺陷空间分析系统</h2>
                <p>请先选择一个批次或上传晶圆坐标数据</p>
              </div>
            </div>
          )}

          {pickedDefect && pickedDefect.defects.length > 0 && (
            <div className="defect-detail">
              <strong>📍 拾取位置</strong>
              <div style={{ marginTop: 6 }}>
                坐标: ({pickedDefect.position.x.toFixed(2)}, {pickedDefect.position.y.toFixed(2)}) mm
              </div>
              <div>附近缺陷数: {pickedDefect.defects.length}</div>
              {pickedDefect.defects[0]?.wafer_id && (
                <div>晶圆: {pickedDefect.defects[0].wafer_id}</div>
              )}
              {pickedDefect.defects[0]?.waferId && (
                <div>晶圆: {pickedDefect.defects[0].waferId}</div>
              )}
              {pickedDefect.defects[0]?.defectClass && (
                <div>类型: {pickedDefect.defects[0].defectClass}</div>
              )}
              {pickedDefect.defects[0]?.size && (
                <div>尺寸: {pickedDefect.defects[0].size.toFixed(3)} μm</div>
              )}
            </div>
          )}

          {mockMode && (
            <div style={{
              position: 'absolute',
              top: 16,
              left: 16,
              background: 'rgba(240, 136, 62, 0.2)',
              border: '1px solid #f0883e',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              color: '#f0883e',
              zIndex: 10,
            }}>
              ⚠️ 演示模式 - 使用本地模拟数据
            </div>
          )}
        </div>

        {showOverlapPanel && selectedBatch && (
          <OverlapAnalysisPanel
            batch={selectedBatch}
            wafers={wafers}
            mockMode={mockMode}
            mockDefects={mockDefectsRef.current}
            onClose={() => setShowOverlapPanel(false)}
          />
        )}
      </div>
    </div>
  );
}
