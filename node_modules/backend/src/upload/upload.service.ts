import { Injectable, BadRequestException } from '@nestjs/common';
import { DefectsService } from '../defects/defects.service';
import { BatchesService } from '../batches/batches.service';
import * as fs from 'fs';
import * as readline from 'readline';

interface DefectRecord {
  waferId: string;
  dieX: number;
  dieY: number;
  defectX: number;
  defectY: number;
  defectSize?: number;
  defectClass?: string;
  geom: string;
}

@Injectable()
export class UploadService {
  constructor(
    private defectsService: DefectsService,
    private batchesService: BatchesService,
  ) {}

  async uploadWaferMap(
    batchName: string,
    productName: string,
    filePath: string,
  ): Promise<{ batchId: string; defectCount: number; waferCount: number }> {
    let batch = await this.batchesService.findByName(batchName);
    if (batch) {
      await this.defectsService.deleteByBatchId(batch.id);
    } else {
      batch = await this.batchesService.create({
        batchName,
        productName,
      });
    }

    const batchId = batch.id;
    const records = await this.parseWaferMapFile(filePath, batchId);
    await this.defectsService.batchInsert(records);

    const waferSet = new Set(records.map((r) => r.waferId));
    const waferCount = waferSet.size;
    const defectCount = records.length;

    await this.batchesService.updateStats(batchId, waferCount, defectCount);

    return { batchId, defectCount, waferCount };
  }

  private async parseWaferMapFile(
    filePath: string,
    batchId: string,
  ): Promise<Array<Partial<DefectRecord & { batchId: string }>>> {
    const records: Array<Partial<DefectRecord & { batchId: string }>> = [];

    return new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      let headerParsed = false;
      let headerMap: { [key: string]: number } = {};
      let lineCount = 0;

      rl.on('line', (line) => {
        lineCount++;
        line = line.trim();
        if (!line || line.startsWith('#')) return;

        if (!headerParsed) {
          const headers = line.split(/[,\t\s]+/);
          headers.forEach((h, idx) => {
            headerMap[h.toLowerCase()] = idx;
          });
          headerParsed = true;
          return;
        }

        const values = line.split(/[,\t\s]+/);
        try {
          const record = this.parseRecord(values, headerMap, batchId);
          if (record) records.push(record);
        } catch (e) {
          console.warn(`Line ${lineCount} parse error: ${e.message}`);
        }
      });

      rl.on('close', () => {
        resolve(records);
      });

      rl.on('error', (err) => {
        reject(new BadRequestException(`File parse error: ${err.message}`));
      });
    });
  }

  private parseRecord(
    values: string[],
    headerMap: { [key: string]: number },
    batchId: string,
  ): Partial<DefectRecord & { batchId: string }> | null {
    const getVal = (key: string): string | undefined => {
      const idx = headerMap[key.toLowerCase()];
      return idx !== undefined ? values[idx] : undefined;
    };

    const waferId = getVal('wafer_id') || getVal('wafer') || getVal('waferid');
    let defectX = parseFloat(getVal('defect_x') || getVal('x') || getVal('posx') || '');
    let defectY = parseFloat(getVal('defect_y') || getVal('y') || getVal('posy') || '');

    if (!waferId || isNaN(defectX) || isNaN(defectY)) {
      return null;
    }

    const dieX = parseInt(getVal('die_x') || getVal('diex') || '0');
    const dieY = parseInt(getVal('die_y') || getVal('diey') || '0');
    const defectSize = parseFloat(getVal('defect_size') || getVal('size') || '0');
    const defectClass = getVal('defect_class') || getVal('class') || getVal('classname');

    return {
      batchId,
      waferId,
      dieX,
      dieY,
      defectX,
      defectY,
      defectSize: isNaN(defectSize) ? 0 : defectSize,
      defectClass: defectClass || '',
      geom: `SRID=0;POINT(${defectX} ${defectY})`,
    };
  }

  generateSampleData(batchName: string, waferCount: number, defectsPerWafer: number) {
    const wafers = [];
    const waferRadius = 150;

    for (let w = 0; w < waferCount; w++) {
      const waferId = `${batchName}_W${String(w + 1).padStart(2, '0')}`;
      const defects = [];

      for (let i = 0; i < defectsPerWafer; i++) {
        const angle = Math.random() * 2 * Math.PI;
        const r = Math.sqrt(Math.random()) * waferRadius;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;

        defects.push({
          x,
          y,
          size: Math.random() * 2 + 0.1,
          defectClass: Math.random() > 0.7 ? 'Particle' : Math.random() > 0.5 ? 'Scratch' : 'Defect',
        });
      }

      wafers.push({ waferId, defects });
    }

    return wafers;
  }
}
