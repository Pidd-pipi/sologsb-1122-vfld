<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useFaceStore } from '../stores/faceStore';
import { useGradeStore } from '../stores/gradeStore';
import {
  CHANGE_TRENDS,
  INFLOW_TYPES,
  currentWaterSurges,
  getWaterSurgeStatus,
  getWaterSurgeSummary,
  isSurge,
  type ChangeTrend,
  type InflowType,
  type WaterInflow,
  type WaterInflowDraft,
} from '../types/water';
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

const retestDialogVisible = ref(false);
const retestError = ref('');
const activeRetestWater = ref<WaterInflow | null>(null);
const retestForm = reactive({
  personInCharge: '',
  note: '',
});

const W = 620;
const H = 220;
const PAD = 40;

interface WaterChart {
  path: string;
  area: string;
  dots: { x: number; y: number; surge: boolean; handled: boolean; label: string }[];
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
    handled: isSurge(p, points) && Boolean(p.retest),
    label: `${formatChainage(p.chainage)} ${p.type} ${p.estimatedFlow} L/min`,
  }));
  return { path, area, dots, max, W, H, PAD };
});

/** 里程文本解析回调（命名函数，避免模板内联箭头参数丢类型） */
function onChainageText(value: string): void {
  form.chainage = parseChainage(value);
}

const surges = computed(() => currentWaterSurges(rows.value));
const summary = computed(() => getWaterSurgeSummary(rows.value));
const totalFlow = computed(() => rows.value.reduce((s, p) => s + p.estimatedFlow, 0));

const retestReadonly = computed(() => Boolean(activeRetestWater.value?.retest));
const retestConfirmedAt = computed(() => activeRetestWater.value?.retest?.confirmedAt);
const retestDialogTitle = computed(() =>
  retestReadonly.value ? '查看复测处置' : '突变点现场复测处置',
);

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

function openRetestDialog(row: WaterInflow): void {
  activeRetestWater.value = row;
  retestError.value = '';
  retestForm.personInCharge = row.retest?.personInCharge ?? face.value?.geologist ?? '';
  retestForm.note = row.retest?.note ?? '';
  retestDialogVisible.value = true;
}

async function submitRetest(): Promise<void> {
  if (!activeRetestWater.value) return;
  retestError.value = '';
  const personInCharge = retestForm.personInCharge.trim();
  const note = retestForm.note.trim();
  if (!personInCharge) {
    retestError.value = '请填写复测确认负责人';
    return;
  }
  if (!note) {
    retestError.value = '请填写复测处置说明，说明为空不能提交';
    return;
  }

  const current = activeRetestWater.value;
  await gradeStore.confirmWaterRetest(current.id, {
    personInCharge,
    note,
    confirmedAt: current.retest?.confirmedAt ?? Date.now(),
  });
  ElMessage.success('复测处置已确认');
  retestDialogVisible.value = false;
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
      <el-tag type="warning">当前突变 {{ summary.total }} 处</el-tag>
      <el-tag type="danger">待复测 {{ summary.pending }} 处</el-tag>
      <el-tag type="success">已处置 {{ summary.handled }} 处</el-tag>
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
              <g v-if="d.handled" class="handled-badge">
                <circle :cx="d.x + 6" :cy="d.y - 6" r="5" fill="#2f8f5b" stroke="#ffffff" stroke-width="1.2" />
                <text :x="d.x + 6" :y="d.y - 5.7" font-size="8" fill="#ffffff" text-anchor="middle">✓</text>
              </g>
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
              <strong>突变点、复测处置与建议措施</strong>
              <el-tag type="danger" size="small">待复测 {{ summary.pending }} 处</el-tag>
              <el-tag type="success" size="small">已处置 {{ summary.handled }} 处</el-tag>
            </div>
          </template>
          <el-alert
            title="系统仍按既有规则识别突变；确认复测后保留趋势和建议，仅从待复测数量中扣减。"
            type="info"
            :closable="false"
            style="margin-bottom: 10px"
          />
          <el-table :data="surges" size="small" border>
            <el-table-column label="里程" width="120">
              <template #default="{ row }">{{ formatChainage(row.chainage) }}</template>
            </el-table-column>
            <el-table-column prop="position" label="部位" min-width="130" />
            <el-table-column prop="type" label="类型" width="80" />
            <el-table-column prop="estimatedFlow" label="涌水量" width="80" />
            <el-table-column prop="changeTrend" label="趋势" width="80" />
            <el-table-column label="建议措施" min-width="230">
              <template #default="{ row }">{{ waterMeasure(row.estimatedFlow, row.type) }}</template>
            </el-table-column>
            <el-table-column label="复测状态" width="110">
              <template #default="{ row }">
                <el-tag v-if="row.retest" type="success" size="small">已复测处置</el-tag>
                <el-tag v-else type="danger" size="small">待复测</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="复测说明" min-width="160">
              <template #default="{ row }">
                <span v-if="row.retest" class="retest-note">{{ row.retest.note }}</span>
                <span v-else class="muted">待现场确认</span>
              </template>
            </el-table-column>
            <el-table-column label="负责人 / 时间" min-width="150">
              <template #default="{ row }">
                <div v-if="row.retest" class="retest-meta">
                  <span>{{ row.retest.personInCharge }}</span>
                  <span class="muted">{{ new Date(row.retest.confirmedAt).toLocaleString('zh-CN') }}</span>
                </div>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="105" fixed="right">
              <template #default="{ row }">
                <el-button size="small" :type="row.retest ? 'default' : 'primary'" @click="openRetestDialog(row)">
                  {{ row.retest ? '查看' : '复测处置' }}
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
            <el-table-column label="异常状态" width="110">
              <template #default="{ row }">
                <el-tag v-if="getWaterSurgeStatus(row, rows) === 'pending'" type="danger" size="small">待复测</el-tag>
                <el-tag v-else-if="getWaterSurgeStatus(row, rows) === 'handled'" type="success" size="small">已处置</el-tag>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="90">
              <template #default="{ row }">
                <el-button size="small" danger @click="gradeStore.removeWater(row.id)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </div>
    </div>

    <el-dialog v-model="retestDialogVisible" :title="retestDialogTitle" width="560px">
      <el-alert v-if="retestError" :title="retestError" type="error" :closable="false" style="margin-bottom: 12px" />
      <el-descriptions v-if="activeRetestWater" :column="1" border size="small" style="margin-bottom: 14px">
        <el-descriptions-item label="异常位置">
          {{ formatChainage(activeRetestWater.chainage) }} · {{ activeRetestWater.position }}
        </el-descriptions-item>
        <el-descriptions-item label="趋势 / 涌水量">
          {{ activeRetestWater.changeTrend }} / {{ activeRetestWater.estimatedFlow }} L/min
        </el-descriptions-item>
        <el-descriptions-item label="建议措施">
          {{ waterMeasure(activeRetestWater.estimatedFlow, activeRetestWater.type) }}
        </el-descriptions-item>
      </el-descriptions>
      <el-form :model="retestForm" label-width="120px">
        <el-form-item label="负责人" required>
          <el-input
            v-model="retestForm.personInCharge"
            :disabled="retestReadonly"
            placeholder="现场复测确认负责人"
          />
        </el-form-item>
        <el-form-item label="复测处置说明" required>
          <el-input
            v-model="retestForm.note"
            type="textarea"
            :rows="4"
            :disabled="retestReadonly"
            placeholder="请填写现场复测情况和处置措施"
          />
        </el-form-item>
        <el-form-item v-if="retestConfirmedAt" label="确认时间">
          <span class="muted">{{ new Date(retestConfirmedAt).toLocaleString('zh-CN') }}</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="retestDialogVisible = false">{{ retestReadonly ? '关闭' : '取消' }}</el-button>
        <el-button v-if="!retestReadonly" type="primary" @click="submitRetest">确认提交</el-button>
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
.retest-note {
  color: #2f3a46;
}
.retest-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: #2f3a46;
}
.handled-badge text {
  dominant-baseline: central;
  font-weight: 700;
}
</style>
