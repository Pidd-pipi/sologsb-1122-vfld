<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useFaceStore } from '../stores/faceStore';
import { useGradeStore } from '../stores/gradeStore';
import { CHANGE_TRENDS, INFLOW_TYPES, isSurge, type ChangeTrend, type InflowType, type WaterInflow, type WaterInflowDraft } from '../types/water';
import { waterMeasure } from '../types/grade';
import { formatChainage, parseChainage } from '../utils/geoMath';

const route = useRoute();
const router = useRouter();
const faceStore = useFaceStore();
const gradeStore = useGradeStore();

const faceId = computed(() => String(route.params.id ?? ''));
const face = computed(() => faceStore.byId(faceId.value));
const rows = computed(() => gradeStore.watersByFace(faceId.value));

const error = ref('');

const form = reactive<WaterInflowDraft>({
  faceId: '',
  position: '',
  type: '滴水',
  estimatedFlow: 5,
  waterTemp: 15,
  waterPressure: 0.1,
  changeTrend: '稳定',
  chainage: 0,
});

const W = 620;
const H = 220;
const PAD = 40;

interface WaterChart {
  path: string;
  area: string;
  dots: { x: number; y: number; surge: boolean; confirmed: boolean; label: string }[];
  max: number;
  W: number;
  H: number;
  PAD: number;
}

const chart = computed<WaterChart>(() => {
  const points = rows.value;
  if (points.length === 0) {
    return { path: '', area: '', dots: [], max: 0, W, H, PAD };
  }
  const flows = points.map((p) => p.estimatedFlow);
  const max = Math.max(10, ...flows);
  const minC = Math.min(...points.map((p) => p.chainage));
  const maxC = Math.max(...points.map((p) => p.chainage));
  const spanC = maxC - minC || 1;
  const x = (c: number) => PAD + ((c - minC) / spanC) * (W - PAD * 2);
  const y = (f: number) => H - PAD - (f / max) * (H - PAD * 2);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.chainage)} ${y(p.estimatedFlow)}`).join(' ');
  const area = `${path} L${x(points[points.length - 1].chainage)} ${H - PAD} L${x(points[0].chainage)} ${H - PAD} Z`;
  const dots = points.map((p) => ({
    x: x(p.chainage),
    y: y(p.estimatedFlow),
    surge: isSurge(p, points),
    confirmed: Boolean(gradeStore.reviewByWaterId(p.id)),
    label: `${formatChainage(p.chainage)} ${p.type} ${p.estimatedFlow} L/min`,
  }));
  return { path, area, dots, max, W, H, PAD };
});

/** 里程文本解析回调（命名函数，避免模板内联箭头参数丢类型） */
function onChainageText(value: string): void {
  form.chainage = parseChainage(value);
}

const surges = computed(() => rows.value.filter((p) => isSurge(p, rows.value)));
/** 突变点汇总按当前记录实时重算：已确认的从待复测中扣减，异常消失后不再占用待办 */
const stats = computed(() => gradeStore.surgeStats(faceId.value));
const totalFlow = computed(() => rows.value.reduce((s, p) => s + p.estimatedFlow, 0));

async function submit() {
  error.value = '';
  if (!form.faceId) {
    error.value = '未指定掌子面';
    return;
  }
  if (!form.position.trim()) {
    error.value = '出水部位必填';
    return;
  }
  if (form.estimatedFlow < 0 || form.estimatedFlow > 1000) {
    error.value = '估算涌水量需在 0 ~ 1000 L/min 之间';
    return;
  }
  const created = await gradeStore.addWater({ ...form, position: form.position.trim() });
  ElMessage.success(`已记录 ${created.position}：${created.type} ${created.estimatedFlow} L/min`);
  form.position = '';
}

/* ---------- 现场复测处置确认 ---------- */

const reviewDialogVisible = ref(false);
const reviewTarget = ref<WaterInflow | null>(null);
const reviewNote = ref('');
const reviewer = ref('');
const reviewError = ref('');

function openReview(row: WaterInflow): void {
  reviewTarget.value = row;
  const existing = gradeStore.reviewByWaterId(row.id);
  reviewNote.value = existing?.note ?? '';
  reviewer.value = existing?.reviewer ?? face.value?.geologist ?? '';
  reviewError.value = '';
  reviewDialogVisible.value = true;
}

async function submitReview() {
  if (!reviewTarget.value) return;
  reviewError.value = '';
  if (!reviewNote.value.trim()) {
    reviewError.value = '请填写现场复测处置说明，说明为空不能提交';
    return;
  }
  await gradeStore.confirmReview({
    faceId: faceId.value,
    waterId: reviewTarget.value.id,
    note: reviewNote.value,
    reviewer: reviewer.value,
  });
  ElMessage.success('复测处置已确认，待复测数量已扣减');
  reviewDialogVisible.value = false;
  reviewTarget.value = null;
}

onMounted(async () => {
  await faceStore.load();
  await gradeStore.load();
  if (face.value) {
    form.faceId = face.value.id;
    form.chainage = face.value.chainage;
  }
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>涌水记录与趋势 · {{ face?.faceNo ?? '未知' }}</h2>
      <el-tag type="info" effect="plain">记录 {{ rows.length }} 条</el-tag>
      <el-tag type="warning">突变点 {{ stats.total }} 处</el-tag>
      <el-tag :type="stats.pending > 0 ? 'danger' : 'success'">
        待复测 {{ stats.pending }} 处 · 已确认 {{ stats.confirmed }} 处
      </el-tag>
      <div class="spacer" />
      <el-button @click="router.push(`/faces/${faceId}`)">返回掌子面详情</el-button>
      <el-button @click="router.push(`/faces/${faceId}/joints`)">节理录入</el-button>
    </div>

    <div class="grid">
      <el-card shadow="never">
        <template #header><strong>新增涌水记录</strong></template>
        <el-alert v-if="error" :title="error" type="error" :closable="false" style="margin-bottom: 10px" />
        <el-form :model="form" label-width="120px">
          <el-form-item label="出水部位" required>
            <el-input v-model="form.position" placeholder="如 拱顶右侧 3 m" />
          </el-form-item>
          <el-form-item label="出水类型">
            <el-select v-model="form.type">
              <el-option v-for="t in INFLOW_TYPES" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="估算涌水量">
            <el-input-number v-model="form.estimatedFlow" :min="0" :max="1000" :step="1" />
            <span class="hint">L/min</span>
          </el-form-item>
          <el-form-item label="水温 ℃">
            <el-input-number v-model="form.waterTemp" :min="0" :max="60" :step="0.5" :precision="1" />
          </el-form-item>
          <el-form-item label="水压 MPa">
            <el-input-number v-model="form.waterPressure" :min="0" :max="10" :step="0.01" :precision="2" />
          </el-form-item>
          <el-form-item label="变化趋势">
            <el-select v-model="form.changeTrend">
              <el-option v-for="c in CHANGE_TRENDS" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item>
          <el-form-item label="里程位置">
            <el-input-number v-model="form.chainage" :min="0" :max="999999" :step="1" />
            <span class="hint">{{ formatChainage(form.chainage) }}</span>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="submit">保存记录</el-button>
          </el-form-item>
        </el-form>
        <el-divider />
        <el-form label-width="120px">
          <el-form-item label="里程文本解析">
            <el-input
              placeholder="输入 K12+480 可解析为米制"
              @change="onChainageText"
            />
          </el-form-item>
        </el-form>
      </el-card>

      <div class="right">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>沿里程涌水量趋势</strong>
              <span class="muted">合计 {{ totalFlow }} L/min · 峰值 {{ chart.max }} L/min</span>
            </div>
          </template>
          <svg v-if="rows.length" :viewBox="`0 0 ${chart.W} ${chart.H}`" width="100%" height="220" data-testid="water-trend">
            <line :x1="chart.PAD" :y1="chart.H - chart.PAD" :x2="chart.W - chart.PAD" :y2="chart.H - chart.PAD" stroke="#c8d0da" />
            <line :x1="chart.PAD" :y1="chart.PAD" :x2="chart.PAD" :y2="chart.H - chart.PAD" stroke="#c8d0da" />
            <path :d="chart.area" fill="#dbeafe" opacity="0.7" />
            <path :d="chart.path" fill="none" stroke="#1f4f8a" stroke-width="2.5" />
            <g v-for="(d, i) in chart.dots" :key="i">
              <circle :cx="d.x" :cy="d.y" :r="d.surge ? 6 : 4" :fill="d.surge ? '#d3542f' : '#1f4f8a'" />
              <!-- 已复测确认的突变点加绿色对勾，红点与趋势保留 -->
              <text v-if="d.surge && d.confirmed" :x="d.x" :y="d.y + 3.5" font-size="9" fill="#1f9d57" text-anchor="middle" font-weight="bold">✓</text>
              <text :x="d.x + 8" :y="d.y - 6" font-size="10" :fill="d.surge ? '#d3542f' : '#5b6470'">{{ d.label }}</text>
            </g>
            <text :x="chart.PAD" :y="16" font-size="11" fill="#7b8592">涌水量 L/min ↑</text>
            <text :x="chart.W - chart.PAD" :y="chart.H - chart.PAD + 20" text-anchor="end" font-size="11" fill="#7b8592">
              里程 →
            </text>
          </svg>
          <el-empty v-else description="暂无涌水记录" :image-size="60" />
        </el-card>

        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>突变点与建议措施</strong>
              <span class="muted">系统按规则自动识别；现场复测后由负责人确认，趋势与建议保留</span>
            </div>
          </template>
          <el-table :data="surges" size="small" border>
            <el-table-column label="里程" width="120">
              <template #default="{ row }">{{ formatChainage(row.chainage) }}</template>
            </el-table-column>
            <el-table-column prop="position" label="部位" min-width="120" />
            <el-table-column prop="type" label="类型" width="80" />
            <el-table-column prop="estimatedFlow" label="涌水量" width="80" />
            <el-table-column prop="changeTrend" label="趋势" width="70" />
            <el-table-column label="建议措施" min-width="220">
              <template #default="{ row }">{{ waterMeasure(row.estimatedFlow, row.type) }}</template>
            </el-table-column>
            <el-table-column label="复测状态" width="100">
              <template #default="{ row }">
                <el-tag v-if="gradeStore.reviewByWaterId(row.id)" type="success" size="small">已复测确认</el-tag>
                <el-tag v-else type="danger" size="small">待复测</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="复测处置说明 / 负责人" min-width="200">
              <template #default="{ row }">
                <template v-if="gradeStore.reviewByWaterId(row.id)">
                  <div>{{ gradeStore.reviewByWaterId(row.id)?.note }}</div>
                  <div class="muted">
                    {{ gradeStore.reviewByWaterId(row.id)?.reviewer || '未填负责人' }} ·
                    {{ new Date(gradeStore.reviewByWaterId(row.id)?.confirmedAt ?? 0).toLocaleString('zh-CN') }}
                  </div>
                </template>
                <span v-else class="muted">现场复测后填写说明并确认</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="110" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" link @click="openReview(row)">
                  {{ gradeStore.reviewByWaterId(row.id) ? '查看/更新' : '复测确认' }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="surges.length === 0" description="未检出突变点" :image-size="60" />
        </el-card>

        <el-card shadow="never">
          <template #header><strong>涌水记录清单</strong></template>
          <el-table :data="rows" size="small" border>
            <el-table-column label="里程" width="110">
              <template #default="{ row }">{{ formatChainage(row.chainage) }}</template>
            </el-table-column>
            <el-table-column prop="position" label="出水部位" min-width="140" />
            <el-table-column prop="type" label="类型" width="90" />
            <el-table-column prop="estimatedFlow" label="L/min" width="90" />
            <el-table-column prop="waterTemp" label="水温" width="80" />
            <el-table-column prop="waterPressure" label="水压" width="80" />
            <el-table-column prop="changeTrend" label="趋势" width="90" />
            <el-table-column label="操作" width="90">
              <template #default="{ row }">
                <el-button size="small" danger @click="gradeStore.removeWater(row.id)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </div>
    </div>

    <el-dialog v-model="reviewDialogVisible" :title="reviewTarget ? `现场复测处置确认 · ${formatChainage(reviewTarget.chainage)} ${reviewTarget.position}` : ''" width="560px">
      <el-alert v-if="reviewError" :title="reviewError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-alert
        v-if="reviewTarget"
        type="warning"
        :closable="false"
        style="margin-bottom: 12px"
        :title="`系统识别：${reviewTarget.type} ${reviewTarget.estimatedFlow} L/min，趋势「${reviewTarget.changeTrend}」；建议措施：${waterMeasure(reviewTarget.estimatedFlow, reviewTarget.type)}`"
      />
      <el-form label-width="110px">
        <el-form-item label="处置说明" required>
          <el-input
            v-model="reviewNote"
            type="textarea"
            :rows="3"
            placeholder="填写现场复测结果与处置情况（必填，为空不能提交）"
          />
        </el-form-item>
        <el-form-item label="负责人">
          <el-input v-model="reviewer" placeholder="复测确认负责人姓名" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitReview">确认复测处置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.grid {
  display: grid;
  grid-template-columns: 420px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.right {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.hint {
  margin-left: 8px;
  color: #97a0ad;
  font-size: 12px;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
</style>
