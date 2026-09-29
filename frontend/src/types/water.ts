/** 出水类型 */
export type InflowType = '渗水' | '滴水' | '线流' | '股状';

export const INFLOW_TYPES: InflowType[] = ['渗水', '滴水', '线流', '股状'];

/** 变化趋势 */
export type ChangeTrend = '减小' | '稳定' | '增大' | '突增';

export const CHANGE_TRENDS: ChangeTrend[] = ['减小', '稳定', '增大', '突增'];

/** 现场复测处置信息 */
export interface WaterRetest {
  /** 复测确认负责人 */
  personInCharge: string;
  /** 复测处置说明 */
  note: string;
  confirmedAt: number;
}

/** 涌水记录 */
export interface WaterInflow {
  id: string;
  faceId: string;
  /** 出水部位 */
  position: string;
  type: InflowType;
  /** 估算涌水量 L/min */
  estimatedFlow: number;
  /** 水温 ℃ */
  waterTemp: number;
  /** 水压 MPa */
  waterPressure: number;
  changeTrend: ChangeTrend;
  measuredAt: number;
  /** 沿里程位置（米），用于趋势折线 */
  chainage: number;
  /** 突变点经现场复测后的处置确认；仅在当前仍被识别为突变点时计入已处置 */
  retest?: WaterRetest;
}

export type WaterInflowDraft = Omit<WaterInflow, 'id' | 'measuredAt' | 'retest'>;

/** 是否突变点（趋势突增或涌水量超过阈值） */
export function isSurge(point: WaterInflow, all: WaterInflow[]): boolean {
  if (point.changeTrend === '突增') return true;
  const sorted = [...all].sort((a, b) => a.chainage - b.chainage);
  const index = sorted.findIndex((p) => p.id === point.id);
  if (index <= 0) return false;
  const prev = sorted[index - 1];
  if (prev.estimatedFlow <= 0) return false;
  return point.estimatedFlow / prev.estimatedFlow >= 2;
}

/** 当前仍按既有规则识别出的突变点，按里程排序 */
export function currentWaterSurges(all: WaterInflow[]): WaterInflow[] {
  const sorted = [...all].sort((a, b) => a.chainage - b.chainage);
  return sorted.filter((point) => isSurge(point, sorted));
}

export interface WaterSurgeSummary {
  total: number;
  pending: number;
  handled: number;
}

/** 待复测数量只统计当前异常中未确认的记录，删除或新增后随剩余数据重算 */
export function getWaterSurgeSummary(all: WaterInflow[]): WaterSurgeSummary {
  const surges = currentWaterSurges(all);
  return {
    total: surges.length,
    pending: surges.filter((point) => !point.retest).length,
    handled: surges.filter((point) => Boolean(point.retest)).length,
  };
}

export type WaterSurgeStatus = 'none' | 'pending' | 'handled';

export function getWaterSurgeStatus(point: WaterInflow, all: WaterInflow[]): WaterSurgeStatus {
  if (!isSurge(point, all)) return 'none';
  return point.retest ? 'handled' : 'pending';
}
