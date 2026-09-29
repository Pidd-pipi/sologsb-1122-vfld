import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { RockMassGrade, RockMassGradeDraft } from '../types/grade';
import type { WaterInflow, WaterInflowDraft, WaterRetest } from '../types/water';
import { getWaterSurgeSummary } from '../types/water';

interface GradeState {
  items: RockMassGrade[];
  waters: WaterInflow[];
  loaded: boolean;
}

export const useGradeStore = defineStore('grade', {
  state: (): GradeState => ({ items: [], waters: [], loaded: false }),
  getters: {
    byFace: (state) => (faceId: string) =>
      state.items.filter((it) => it.faceId === faceId).sort((a, b) => b.judgedAt - a.judgedAt),
    latestByFace: (state) => (faceId: string) =>
      state.items.filter((it) => it.faceId === faceId).sort((a, b) => b.judgedAt - a.judgedAt)[0],
    watersByFace: (state) => (faceId: string) =>
      state.waters.filter((it) => it.faceId === faceId).sort((a, b) => a.chainage - b.chainage),
    waterSurgeSummary: (state) => (faceId: string) =>
      getWaterSurgeSummary(state.waters.filter((it) => it.faceId === faceId)),
  },
  actions: {
    async load() {
      const grades = await db.grades.toArray();
      this.items = grades.sort((a, b) => b.judgedAt - a.judgedAt);
      const waters = await db.waters.toArray();
      this.waters = waters.sort((a, b) => a.chainage - b.chainage);
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
    async confirmWaterRetest(id: string, retest: WaterRetest) {
      const current = this.waters.find((it) => it.id === id);
      if (!current) throw new Error('未找到涌水记录');
      const note = retest.note.trim();
      const personInCharge = retest.personInCharge.trim();
      if (!personInCharge) throw new Error('请填写复测确认负责人');
      if (!note) throw new Error('请填写复测处置说明');
      const record: WaterInflow = {
        ...current,
        retest: { ...toPlain(retest), note, personInCharge },
      };
      await db.waters.put(toPlain(record));
      this.waters = this.waters.map((it) => (it.id === id ? record : it));
      return record;
    },
    async removeWater(id: string) {
      await db.waters.delete(id);
      this.waters = this.waters.filter((it) => it.id !== id);
    },
  },
});
