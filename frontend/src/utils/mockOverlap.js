export function generateMockOverlapResult(batchName, wafers, defects) {
  const waferIds = wafers.length > 0 ? wafers : ['W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08'];
  const waferDefectCounts = {};

  if (defects && defects.length > 0) {
    waferIds.forEach(id => {
      waferDefectCounts[id] = defects.filter(d =>
        d.waferId === id || d.waferId.endsWith(id)
      ).length;
    });
  } else {
    waferIds.forEach(id => {
      waferDefectCounts[id] = Math.floor(3000 + Math.random() * 10000);
    });
  }

  const waferMatrix = {};
  waferIds.forEach(id => { waferMatrix[id] = {}; });

  const overlapPairs = [];
  const waferOverlapSum = {};
  const waferOverlapMax = {};
  waferIds.forEach(id => { waferOverlapSum[id] = 0; waferOverlapMax[id] = 0; });

  for (let i = 0; i < waferIds.length; i++) {
    for (let j = i + 1; j < waferIds.length; j++) {
      const waferA = waferIds[i];
      const waferB = waferIds[j];

      const baseOverlap = Math.min(waferDefectCounts[waferA], waferDefectCounts[waferB]);
      const hasHighOverlap = (waferA === 'W03' && waferB === 'W05') ||
                             (waferA === 'W02' && waferB === 'W04') ||
                             (waferA === 'W01' && waferB === 'W06');

      const overlapRatio = hasHighOverlap
        ? 0.15 + Math.random() * 0.25
        : 0.005 + Math.random() * 0.04;

      const overlapCount = Math.floor(baseOverlap * overlapRatio);

      waferMatrix[waferA][waferB] = overlapCount;
      waferMatrix[waferB][waferA] = overlapCount;

      overlapPairs.push({ waferA, waferB, overlapCount, overlapRatio });

      waferOverlapSum[waferA] += overlapRatio;
      waferOverlapSum[waferB] += overlapRatio;
      waferOverlapMax[waferA] = Math.max(waferOverlapMax[waferA], overlapRatio);
      waferOverlapMax[waferB] = Math.max(waferOverlapMax[waferB], overlapRatio);
    }
  }

  overlapPairs.sort((a, b) => b.overlapRatio - a.overlapRatio);

  const perWaferStats = {};
  waferIds.forEach(id => {
    const otherCount = waferIds.length - 1;
    perWaferStats[id] = {
      defectCount: waferDefectCounts[id],
      avgOverlapRatio: otherCount > 0 ? waferOverlapSum[id] / otherCount : 0,
      maxOverlapRatio: waferOverlapMax[id],
    };
  });

  const globalHotspots = [
    { centroidX: -40, centroidY: 30, defectCount: 2847, involvedWafers: ['W03', 'W05', 'W07'] },
    { centroidX: 50, centroidY: -60, defectCount: 1923, involvedWafers: ['W02', 'W04'] },
    { centroidX: 20, centroidY: 80, defectCount: 1456, involvedWafers: ['W01', 'W06', 'W08'] },
    { centroidX: -70, centroidY: -40, defectCount: 1102, involvedWafers: ['W03', 'W04'] },
    { centroidX: 60, centroidY: 50, defectCount: 876, involvedWafers: ['W01', 'W05'] },
  ];

  const topPair = overlapPairs[0] || { waferA: '-', waferB: '-', overlapRatio: 0 };
  const avgOverlapRatio = overlapPairs.length > 0
    ? overlapPairs.reduce((s, p) => s + p.overlapRatio, 0) / overlapPairs.length
    : 0;

  const totalDefects = Object.values(waferDefectCounts).reduce((a, b) => a + b, 0);

  return {
    taskId: 'mock_task',
    batchId: 'mock-batch-1',
    summary: {
      totalDefects,
      waferCount: waferIds.length,
      avgOverlapRatio,
      highestOverlapPair: [topPair.waferA, topPair.waferB],
      highestOverlapRatio: topPair.overlapRatio,
    },
    waferMatrix,
    overlapPairs: overlapPairs.slice(0, 50),
    perWaferStats,
    globalHotspots,
  };
}
