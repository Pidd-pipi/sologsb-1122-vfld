import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { RockMassGrade, RockMassGradeDraft } from '../types/grade';
import {
  surgeSummary,
  type SurgeReview,
  type SurgeReviewDraft,
  type SurgeSummary,
  type WaterInflow,
  type WaterInflowDraft,
} from '../types/water';

interface GradeState {
  items: RockMassGrade[];
  waters: WaterInflow[];
  reviews: SurgeReview[];
  loaded: boolean;
}

export const useGradeStore = defineStore('grade', {
  state: (): GradeState => ({ items: [], waters: [], reviews: [], loaded: false }),
  getters: {
    byFace: (state) => (faceId: string) =>
      state.items.filter((it) => it.faceId === faceId).sort((a, b) => b.judgedAt - a.judgedAt),
    latestByFace: (state) => (faceId: string) =>
      state.items.filter((it) => it.faceId === faceId).sort((a, b) => b.judgedAt - a.judgedAt)[0],
    watersByFace: (state) => (faceId: string) =>
      state.waters.filter((it) => it.faceId === faceId).sort((a, b) => a.chainage - b.chainage),
    reviewsByFace: (state) => (faceId: string) =>
      state.reviews.filter((it) => it.faceId === faceId).sort((a, b) => b.confirmedAt - a.confirmedAt),
    reviewByWaterId: (state) => (waterId: string) =>
      state.reviews.find((it) => it.waterId === waterId),
    /** 突变点汇总（按当前涌水记录实时重算，已消失的异常不会继续计入待办） */
    surgeStats: (state) => (faceId: string): SurgeSummary => {
      const rows = state.waters
        .filter((it) => it.faceId === faceId)
        .sort((a, b) => a.chainage - b.chainage);
      return surgeSummary(rows, state.reviews.filter((it) => it.faceId === faceId));
    },
  },
  actions: {
    async load() {
      const grades = await db.grades.toArray();
      this.items = grades.sort((a, b) => b.judgedAt - a.judgedAt);
      const waters = await db.waters.toArray();
      this.waters = waters.sort((a, b) => a.chainage - b.chainage);
      const reviews = await db.surgeReviews.toArray();
      // 清理对应涌水记录已不存在的复测确认，重开页面后也不残留待办
      const waterIds = new Set(this.waters.map((w) => w.id));
      const dangling = reviews.filter((r) => !waterIds.has(r.waterId));
      if (dangling.length > 0) {
        await db.surgeReviews.bulkDelete(dangling.map((r) => r.id));
      }
      this.reviews = reviews
        .filter((r) => waterIds.has(r.waterId))
        .sort((a, b) => b.confirmedAt - a.confirmedAt);
      this.loaded = true;
    },
    async addGrade(draft: RockMassGradeDraft) {
      const record: RockMassGrade = { ...toPlain(draft), id: newId('grade'), judgedAt: Date.now() };
      await db.grades.put(toPlain(record));
      this.items = [record, ...this.items];
      return record;
    },
    async addWater(draft: WaterInflowDraft) {
      const record: WaterInflow = { ...toPlain(draft), id: newId('water'), measuredAt: Date.now() };
      await db.waters.put(toPlain(record));
      this.waters = [...this.waters, record].sort((a, b) => a.chainage - b.chainage);
      return record;
    },
    /** 确认现场复测处置；说明为空不能提交 */
    async confirmReview(draft: SurgeReviewDraft) {
      const note = draft.note.trim();
      if (!note) throw new Error('复测处置说明必填');
      const existing = this.reviews.find((it) => it.waterId === draft.waterId);
      const record: SurgeReview = existing
        ? {
            ...existing,
            note,
            reviewer: draft.reviewer.trim(),
            confirmedAt: Date.now(),
          }
        : {
            id: newId('review'),
            faceId: draft.faceId,
            waterId: draft.waterId,
            note,
            reviewer: draft.reviewer.trim(),
            confirmedAt: Date.now(),
          };
      await db.surgeReviews.put(toPlain(record));
      this.reviews = [record, ...this.reviews.filter((it) => it.id !== record.id)].sort(
        (a, b) => b.confirmedAt - a.confirmedAt,
      );
      return record;
    },
    async removeWater(id: string) {
      await db.transaction('rw', db.waters, db.surgeReviews, async () => {
        await db.waters.delete(id);
        await db.surgeReviews.where('waterId').equals(id).delete();
      });
      this.waters = this.waters.filter((it) => it.id !== id);
      this.reviews = this.reviews.filter((it) => it.waterId !== id);
    },
  },
});
