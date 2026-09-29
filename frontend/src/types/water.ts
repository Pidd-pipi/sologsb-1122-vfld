/** 出水类型 */
export type InflowType = '渗水' | '滴水' | '线流' | '股状';

export const INFLOW_TYPES: InflowType[] = ['渗水', '滴水', '线流', '股状'];

/** 变化趋势 */
export type ChangeTrend = '减小' | '稳定' | '增大' | '突增';

export const CHANGE_TRENDS: ChangeTrend[] = ['减小', '稳定', '增大', '突增'];

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
}

export type WaterInflowDraft = Omit<WaterInflow, 'id' | 'measuredAt'>;

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

/** 突变点现场复测处置记录（一条涌水记录至多一条） */
export interface SurgeReview {
  id: string;
  faceId: string;
  /** 对应的涌水记录 id */
  waterId: string;
  /** 复测处置说明（必填，为空不能提交） */
  note: string;
  /** 确认负责人 */
  reviewer: string;
  confirmedAt: number;
}

export type SurgeReviewDraft = Pick<SurgeReview, 'faceId' | 'waterId' | 'note' | 'reviewer'>;

/** 突变点汇总：系统识别数、已复测确认数、待复测数（始终按当前记录重算） */
export interface SurgeSummary {
  total: number;
  confirmed: number;
  pending: number;
}

export function surgeSummary(rows: WaterInflow[], reviews: Pick<SurgeReview, 'waterId'>[]): SurgeSummary {
  const confirmedIds = new Set(reviews.map((r) => r.waterId));
  const surges = rows.filter((p) => isSurge(p, rows));
  const confirmed = surges.filter((p) => confirmedIds.has(p.id)).length;
  return { total: surges.length, confirmed, pending: surges.length - confirmed };
}
