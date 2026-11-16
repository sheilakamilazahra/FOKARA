
import { mountShell } from "../core/shell.js";
import { CONFIG } from "../core/config.js";
import { getAuthHeaders } from "../core/auth.js";

const $ = (id) => document.getElementById(id);

const API_URL = (CONFIG.apiBase || "http://127.0.0.1:8000")
  .replace(/\/+$/, "");

let sessions = [];
let selectedRole = "all";
let selectedVisualSessionId = "";
let charts = {};

let spearmanAnalytics = null;
let clusterAnalytics = null;

const COLORS = {
  teal: "#0d9f91",
  tealLight: "rgba(13, 159, 145, 0.12)",
  purple: "#8875d6",
  slate: "#64748b",
  orange: "#e49b3d",
  blue: "#5c8fd6",
  pink: "#d77da5",
  gray: "#aab5c2"
};

const DISTRIBUTION_COLORS = [
  COLORS.teal,
  COLORS.slate,
  COLORS.orange,
  COLORS.purple,
  COLORS.blue,
  COLORS.pink,
  COLORS.gray
];

document.addEventListener("DOMContentLoaded", init);

// =====================================================
// INITIALIZATION
// =====================================================

async function init() {
  try {
    await mountShell({
      page: "history",
      title: "Perkembangan latihan",
      subtitle: "Pantau perkembangan hasil wawancara dan indikator visual."
    });

    bindEvents();
    await loadHistory();

  } catch (error) {
    console.error("[HISTORY] Initialization error:", error);
    showMessage("Halaman riwayat gagal dimuat. Silakan muat ulang halaman.");
  }
}

function bindEvents() {
  $("roleSel")?.addEventListener("change", (event) => {
    selectedRole = event.target.value;
    selectedVisualSessionId = "";
    renderHistory();
  });

  $("visualSessionSel")?.addEventListener("change", (event) => {
    selectedVisualSessionId = event.target.value;
    renderSelectedVisuals(getFilteredSessions());
  });
}

// =====================================================
// API
// =====================================================

async function loadHistory() {
  showMessage("Memuat riwayat latihan...");

  try {
    const authHeaders = await getAuthHeaders();

    const response = await fetch(`${API_URL}/api/sessions`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...authHeaders
      }
    });

    if (response.status === 401 || response.status === 403) {
      showMessage("Sesi login berakhir. Silakan login kembali.");
      return;
    }

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result.detail ||
        result.message ||
        "Gagal mengambil data riwayat."
      );
    }

    if (result.success === false) {
      throw new Error(
        result.message ||
        result.detail ||
        "Gagal mengambil data riwayat."
      );
    }

    sessions = Array.isArray(result)
      ? result
      : Array.isArray(result.data)
        ? result.data
        : Array.isArray(result.sessions)
          ? result.sessions
          : [];

    renderHistory();
    await loadAdvancedAnalytics();

  } catch (error) {
    console.error("[HISTORY] Error:", error);
    showMessage(error.message || "Terjadi kesalahan saat memuat riwayat.");
  }
}

// =====================================================
// ADVANCED ANALYTICS API
// =====================================================

async function fetchAnalytics(endpoint) {
  const authHeaders = await getAuthHeaders();

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...authHeaders
    }
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result.detail ||
      result.message ||
      `Gagal mengambil data dari ${endpoint}.`
    );
  }

  if (result.success === false) {
    throw new Error(
      result.message ||
      result.detail ||
      `Analisis ${endpoint} gagal.`
    );
  }

  return result;
}

async function loadAdvancedAnalytics() {
  const results = await Promise.allSettled([
    fetchAnalytics("/api/analytics/spearman"),
    fetchAnalytics("/api/analytics/clusters")
  ]);

  if (results[0].status === "fulfilled") {
    spearmanAnalytics = results[0].value;
    console.log("[ANALYTICS] Spearman berhasil dimuat:", spearmanAnalytics);
  } else {
    spearmanAnalytics = null;
    console.error("[ANALYTICS] Spearman gagal:", results[0].reason);
  }

  if (results[1].status === "fulfilled") {
    clusterAnalytics = results[1].value;
    console.log("[ANALYTICS] HDBSCAN berhasil dimuat:", clusterAnalytics);
  } else {
    clusterAnalytics = null;
    console.error("[ANALYTICS] HDBSCAN gagal:", results[1].reason);
  }

  renderSpearmanAnalytics();
  renderHdbscanAnalytics();
}


function renderSpearmanAnalytics() {
  const meta = $("spearmanMeta");
  const message = $("spearmanMessage");
  const tableBody = $("spearmanTableBody");

  if (!meta || !message || !tableBody) return;

  if (!spearmanAnalytics) {
    meta.textContent = "Data analitik Spearman tidak tersedia.";
    message.hidden = false;
    message.textContent =
      "Terjadi kendala saat mengambil hasil korelasi dari server.";
    tableBody.innerHTML = `
      <tr><td colspan="5">Data tidak dapat dimuat.</td></tr>
    `;
    return;
  }

  const results = spearmanAnalytics.correlations || [];

  meta.textContent =
    `Total sesi: ${spearmanAnalytics.total_sessions ?? 0} | ` +
    `Sesi dengan skor: ${spearmanAnalytics.scored_sessions ?? 0}`;

  message.hidden = true;

  const featureLabels = {
    gaze_center_ratio: "Pandangan ke tengah",
    gaze_down_ratio: "Pandangan ke bawah",
    gaze_left_ratio: "Pandangan ke kiri",
    gaze_right_ratio: "Pandangan ke kanan",
    gaze_up_ratio: "Pandangan ke atas",

    head_motion_atas_ratio: "Gerakan kepala ke atas",
    head_motion_bawah_ratio: "Gerakan kepala ke bawah",
    head_motion_depan_ratio: "Gerakan kepala ke depan",
    head_motion_kanan_ratio: "Gerakan kepala ke kanan",
    head_motion_kiri_ratio: "Gerakan kepala ke kiri",

    expression_surprise_ratio: "Ekspresi terkejut",
    expression_fear_ratio: "Ekspresi takut",
    expression_disgust_ratio: "Ekspresi jijik",
    expression_happy_ratio: "Ekspresi senang",
    expression_sad_ratio: "Ekspresi sedih",
    expression_angry_ratio: "Ekspresi marah",
    expression_neutral_ratio: "Ekspresi netral"
  };

  const statusLabels = {
    calculated: "Berhasil dihitung",
    insufficient_data: "Data belum cukup",
    constant_values: "Nilai tidak bervariasi"
  };

  if (!results.length) {
    tableBody.innerHTML = `
      <tr><td colspan="5">Belum ada hasil korelasi.</td></tr>
    `;
    return;
  }

  tableBody.innerHTML = results.map((item) => {
    const rho = Number.isFinite(item.rho)
      ? item.rho.toFixed(3)
      : "—";

    const pValue = Number.isFinite(item.p_value)
      ? item.p_value.toFixed(4)
      : "—";

    const status =
      statusLabels[item.status] || item.status || "Tidak diketahui";

    return `
      <tr>
        <td>${escapeHTML(featureLabels[item.feature] || item.feature)}</td>
        <td>${item.sample_size ?? 0}</td>
        <td>${rho}</td>
        <td>${pValue}</td>
        <td>${escapeHTML(status)}</td>
      </tr>
    `;
  }).join("");
}


function renderHdbscanAnalytics() {
  const meta = $("clusterMeta");
  const message = $("clusterMessage");
  const summary = $("clusterSummary");

  if (!meta || !message || !summary) return;

  destroyChart("cluster");

  if (!clusterAnalytics) {
    meta.textContent = "Data analitik HDBSCAN tidak tersedia.";
    message.hidden = false;
    message.textContent =
      "Terjadi kendala saat mengambil hasil clustering dari server.";

    summary.innerHTML = "";
    setChartEmpty("clusterChart", "clusterEmpty", true);
    return;
  }

  const result = clusterAnalytics;
  const data = Array.isArray(result.data) ? result.data : [];

  meta.textContent =
    `Total sesi: ${result.total_sessions ?? 0} | ` +
    `Sesi dengan skor: ${result.scored_sessions ?? 0} | ` +
    `Sesi lengkap: ${result.complete_sessions ?? 0}`;

  if (result.status !== "completed") {
    message.hidden = false;
    message.textContent =
      result.message || "Data belum mencukupi untuk clustering.";

    summary.innerHTML = "";
    setChartEmpty("clusterChart", "clusterEmpty", true);
    $("clusterEmpty").textContent =
      "Visualisasi akan tersedia setelah data mencukupi.";
    return;
  }

  message.hidden = true;

  const clusterGroups = new Map();

  data.forEach((item) => {
    const clusterId = Number(item.cluster);
    const key = clusterId === -1 ? "noise" : String(clusterId);

    if (!clusterGroups.has(key)) {
      clusterGroups.set(key, []);
    }

    clusterGroups.get(key).push(item);
  });

  const palette = [
    "#0d9f91",
    "#8875d6",
    "#e49b3d",
    "#5c8fd6",
    "#d77da5",
    "#64748b"
  ];

  const datasets = [...clusterGroups.entries()].map(
    ([key, items], index) => {
      const isNoise = key === "noise";

      return {
        label: isNoise ? "Noise" : `Cluster ${key}`,
        data: items.map((item, pointIndex) => ({
          x: data.indexOf(item) + 1,
          y: Number(item.rubric_score),
          sessionId: item.session_id,
          startedAt: item.started_at
        })),
        backgroundColor: isNoise
          ? "#aab5c2"
          : palette[Number(key) % palette.length],
        borderColor: isNoise
          ? "#8794a3"
          : palette[Number(key) % palette.length],
        pointRadius: 6,
        pointHoverRadius: 8
      };
    }
  );

  summary.innerHTML = `
    <div class="analytics-cluster-stat">
      <strong>${result.total_clusters ?? 0}</strong>
      <span>Cluster terbentuk</span>
    </div>
    <div class="analytics-cluster-stat">
      <strong>${result.noise_count ?? 0}</strong>
      <span>Sesi noise</span>
    </div>
    <div class="analytics-cluster-stat">
      <strong>${result.complete_sessions ?? 0}</strong>
      <span>Sesi dianalisis</span>
    </div>
  `;

  setChartEmpty("clusterChart", "clusterEmpty", false);

  const canvas = $("clusterChart");

  if (!canvas || typeof Chart === "undefined") {
    console.error("[ANALYTICS] Chart.js atau canvas tidak tersedia.");
    setChartEmpty("clusterChart", "clusterEmpty", true);
    return;
  }

  charts.cluster = new Chart(canvas, {
    type: "scatter",
    data: {
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,

      plugins: {
        legend: {
          display: true,
          position: "bottom"
        },
        tooltip: {
          callbacks: {
            label(context) {
              const point = context.raw;

              return [
                context.dataset.label,
                `Sesi ke-${point.x}`,
                `Skor performa: ${point.y}`,
                `ID sesi: ${point.sessionId}`
              ];
            }
          }
        }
      },

      scales: {
        x: {
          type: "linear",
          title: {
            display: true,
            text: "Urutan sesi"
          },
          ticks: {
            precision: 0
          }
        },
        y: {
          title: {
            display: true,
            text: "Skor performa"
          }
        }
      }
    }
  });

  $("clusterNote").textContent =
    result.interpretation_note ||
    "Label -1 menunjukkan observasi noise, bukan performa buruk.";
}

// =====================================================
// EMPTY / ERROR
// =====================================================

function showMessage(message) {
  const empty = $("empty");
  const wrap = $("wrap");

  if (empty) {
    empty.hidden = false;

    const paragraph = empty.querySelector(".muted");

    if (paragraph) {
      paragraph.textContent = message;
    }
  }

  if (wrap) {
    wrap.hidden = true;
  }
}

function showEmpty() {
  showMessage("Belum ada sesi latihan tersimpan.");
}

// =====================================================
// GENERAL HELPERS
// =====================================================

function getValue(object, keys, fallback = null) {
  for (const key of keys) {
    const value = object?.[key];

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return fallback;
}

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return entities[char];
  });
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getRole(session) {
  return (
    session.role ||
    session.job_role ||
    session.position ||
    "Tidak diketahui"
  );
}

function getExperienceLevel(session) {
  const performance = session.performance || {};

  const value = getValue(
    session,
    [
      "experience_level",
      "difficulty",
      "level"
    ],
    getValue(
      performance,
      [
        "experience_level",
        "difficulty",
        "level"
      ]
    )
  );

  if (!value) return "-";

  const normalized = String(value).trim().toLowerCase();

  const labels = {
    beginner: "Beginner",
    intermediate: "Intermediate",
    advanced: "Advanced"
  };

  return labels[normalized] ||
    normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getSessionDate(session) {
  return (
    session.started_at ||
    session.created_at ||
    session.session_date ||
    session.date ||
    session.performance?.started_at ||
    null
  );
}

function getRubricScore(session) {
  const performance = session.performance || {};

  const value = getValue(
    session,
    [
      "rubric_score",
      "rubric_percentage",
      "performance_score",
      "overall_score"
    ],
    getValue(
      performance,
      [
        "rubric_score",
        "score",
        "percentage",
        "overall_score",
        "weighted_percentage"
      ]
    )
  );

  return toNumber(value);
}

function getAttempt(session, index) {
  const value = toNumber(
    session.attempt_number ??
    session.performance?.attempt_number ??
    session.attempt
  );

  return value !== null && value > 0
    ? Math.floor(value)
    : index + 1;
}

// Label lengkap untuk tooltip, selector, dan informasi sesi.
function getAttemptLabel(session, index) {
  return `Percobaan ${getAttempt(session, index)}`;
}

// Label singkat khusus untuk sumbu X grafik.
function getAttemptAxisLabel(session, index) {
  return `P${getAttempt(session, index)}`;
}

function getDurationSeconds(session) {
  const value = toNumber(
    session.duration_seconds ??
    session.performance?.duration_seconds ??
    session.duration
  );

  return value !== null && value > 0 ? value : null;
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) {
    return "-";
  }

  const value = Number(seconds);

  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }

  const minutes = Math.floor(value / 60);
  const remainingSeconds = Math.floor(value % 60);

  return `${minutes} menit ${remainingSeconds} detik`;
}

function formatDurationAxis(seconds) {
  const value = Math.max(0, Number(seconds) || 0);

  if (value === 0) return "0";

  const minutes = value / 60;

  return Number.isInteger(minutes)
    ? String(minutes)
    : String(Math.round(minutes));
}

function getSessionStatus(session) {
  const status = String(session.status || "").toLowerCase();

  const labels = {
    pending: "Menunggu",
    processing: "Sedang diproses",
    running: "Sedang berlangsung",
    completed: "Selesai",
    selesai: "Selesai",
    partial: "Selesai sebagian",
    failed: "Gagal",
    cancelled: "Dibatalkan",
    canceled: "Dibatalkan"
  };

  return labels[status] || status || "Tidak diketahui";
}

function getChronologicalData(data) {
  return [...data].sort((a, b) => {
    const dateA = new Date(getSessionDate(a) || 0).getTime();
    const dateB = new Date(getSessionDate(b) || 0).getTime();

    return dateA - dateB;
  });
}

function getSessionId(session) {
  return String(session.id || session.session_id || "");
}

function getFilteredSessions() {
  const filtered = selectedRole === "all"
    ? sessions
    : sessions.filter(
        (session) => getRole(session) === selectedRole
      );

  return getChronologicalData(filtered);
}

// =====================================================
// ROLE FILTER
// =====================================================

function renderRoleFilter(data) {
  const select = $("roleSel");

  if (!select) return;

  const roles = [
    ...new Set(
      data
        .map(getRole)
        .filter((role) => role && role !== "Tidak diketahui")
    )
  ];

  select.innerHTML = `
    <option value="all">Semua posisi</option>
    ${roles.map((role) => `
      <option value="${escapeHTML(role)}">
        ${escapeHTML(role)}
      </option>
    `).join("")}
  `;

  if (selectedRole === "all" || roles.includes(selectedRole)) {
    select.value = selectedRole;
  } else {
    selectedRole = "all";
    select.value = "all";
  }
}

// =====================================================
// MAIN RENDER
// =====================================================

function renderHistory() {
  if (!sessions.length) {
    destroyAllCharts();
    showEmpty();
    return;
  }

  $("empty").hidden = true;
  $("wrap").hidden = false;

  renderRoleFilter(sessions);

  const sortedSessions = getFilteredSessions();

  if (!sortedSessions.length) {
    destroyAllCharts();
    renderStats([]);
    renderTable([]);
    renderVisualSessionSelector([]);
    return;
  }

  renderStats(sortedSessions);
  renderPerformanceCharts(sortedSessions);
  renderVisualSessionSelector(sortedSessions);
  renderTable(sortedSessions);
  renderSpearmanAnalytics();
}

// =====================================================
// SUMMARY CARDS
// =====================================================

function renderStats(data) {
  $("statTotal").textContent = data.length;

  const validScores = data
    .map((session, index) => ({
      score: getRubricScore(session),
      session,
      index
    }))
    .filter((item) => item.score !== null);

  if (!validScores.length) {
    $("statLatest").textContent = "-";
    $("statLatestNote").textContent = "Belum ada evaluasi";
    $("statChange").textContent = "-";
    $("statChangeNote").textContent = "Belum ada pembanding";
    $("statChange").className = "";
    return;
  }

  const latest = validScores[validScores.length - 1];

  $("statLatest").textContent =
    `${latest.score.toFixed(1).replace(".", ",")}%`;

  $("statLatestNote").textContent =
    getAttemptLabel(latest.session, latest.index);

  if (validScores.length < 2) {
    $("statChange").textContent = "-";
    $("statChangeNote").textContent = "Butuh minimal dua evaluasi";
    $("statChange").className = "";
    return;
  }

  const previous = validScores[validScores.length - 2];
  const difference = latest.score - previous.score;

  const prefix = difference > 0 ? "+" : "";
  const formatted =
    `${prefix}${difference.toFixed(1).replace(".", ",")}`;

  $("statChange").textContent = formatted;

  if (difference > 0) {
    $("statChange").className = "positive";
    $("statChangeNote").textContent =
      "Poin lebih tinggi dari percobaan sebelumnya";
  } else if (difference < 0) {
    $("statChange").className = "negative";
    $("statChangeNote").textContent =
      "Poin lebih rendah dari percobaan sebelumnya";
  } else {
    $("statChange").className = "neutral";
    $("statChangeNote").textContent =
      "Tidak ada perubahan dari percobaan sebelumnya";
  }
}

// =====================================================
// CHART MANAGEMENT
// =====================================================

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

function destroyAllCharts() {
  Object.keys(charts).forEach(destroyChart);
}

function setChartEmpty(canvasId, emptyId, isEmpty) {
  const canvas = $(canvasId);
  const empty = $(emptyId);

  if (canvas) canvas.hidden = isEmpty;
  if (empty) empty.hidden = !isEmpty;
}

function getChartBaseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,

    layout: {
      autoPadding: true,
      padding: {
        top: 14,
        right: 22,
        bottom: 16,
        left: 14
      }
    },

    interaction: {
      mode: "index",
      intersect: false
    },

    plugins: {
      legend: {
        display: true,
        position: "bottom",
        labels: {
          usePointStyle: true,
          pointStyle: "circle",
          boxWidth: 8,
          padding: 18
        }
      },

      tooltip: {
        enabled: true,
        backgroundColor: "#173d3a",
        titleColor: "#ffffff",
        bodyColor: "#ffffff",
        padding: 12,
        cornerRadius: 10
      }
    },

    scales: {
      x: {
        grid: {
          display: false
        },
        border: {
          display: false
        },
        ticks: {
          color: "#718096",
          maxRotation: 0,
          minRotation: 0,
          autoSkip: true,
          maxTicksLimit: 10,
          padding: 8
        }
      },

      y: {
        beginAtZero: true,
        min: 0,
        grid: {
          color: "rgba(100, 116, 139, 0.13)"
        },
        border: {
          display: false
        },
        ticks: {
          color: "#718096",
          padding: 8,
          precision: 0
        }
      }
    }
  };
}

function getPercentageScale() {
  return {
    min: 0,
    max: 100,
    beginAtZero: true,
    grid: {
      color: "rgba(100, 116, 139, 0.13)"
    },
    border: {
      display: false
    },
    ticks: {
      color: "#718096",
      padding: 8,
      stepSize: 20,
      precision: 0,
      callback(value) {
        return `${Math.round(Number(value))}%`;
      }
    }
  };
}

function getChartTooltipTitle(data, context) {
  const dataIndex = context[0]?.dataIndex;
  const session = data[dataIndex];

  if (!session) return "";

  return `${getAttemptLabel(session, dataIndex)} · ${formatDate(getSessionDate(session))}`;
}

function renderPerformanceCharts(data) {
  if (typeof Chart === "undefined") {
    console.error("[HISTORY] Chart.js belum berhasil dimuat.");
    return;
  }

  renderRubricChart(data);
  renderDurationChart(data);
}

// =====================================================
// CHART 1: RUBRIC TREND
// =====================================================

function renderRubricChart(data) {
  destroyChart("rubric");

  const values = data.map(getRubricScore);
  const hasData = values.some((value) => value !== null);

  setChartEmpty("rubricChart", "rubricEmpty", !hasData);

  if (!hasData) return;

  const options = getChartBaseOptions();

  charts.rubric = new Chart($("rubricChart"), {
    type: "line",

    data: {
      labels: data.map((session, index) =>
        getAttemptAxisLabel(session, index)
      ),

      datasets: [{
        label: "Nilai rubrik",
        data: values,
        borderColor: COLORS.teal,
        backgroundColor: COLORS.tealLight,
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        spanGaps: false,
        pointRadius: 5,
        pointHoverRadius: 8,
        pointBackgroundColor: "#ffffff",
        pointBorderColor: COLORS.teal,
        pointBorderWidth: 3
      }]
    },

    options: {
      ...options,

      plugins: {
        ...options.plugins,

        tooltip: {
          ...options.plugins.tooltip,

          callbacks: {
            title(context) {
              return getChartTooltipTitle(data, context);
            },

            label(context) {
              return context.parsed.y === null
                ? "Nilai rubrik: belum tersedia"
                : `Nilai rubrik: ${context.parsed.y.toFixed(1).replace(".", ",")}%`;
            },

            afterLabel(context) {
              const session = data[context.dataIndex];

              return [
                `Posisi: ${getRole(session)}`,
                `Level: ${getExperienceLevel(session)}`
              ];
            }
          }
        }
      },

      scales: {
        ...options.scales,
        y: getPercentageScale()
      }
    }
  });
}

// =====================================================
// CHART 2: DURATION
// =====================================================

function getDurationStep(maxSeconds) {
  const maxMinutes = maxSeconds / 60;

  if (maxMinutes <= 5) return 60;
  if (maxMinutes <= 10) return 120;
  if (maxMinutes <= 30) return 300;
  if (maxMinutes <= 60) return 600;

  return 1800;
}

function renderDurationChart(data) {
  destroyChart("duration");

  const values = data.map((session) => getDurationSeconds(session));
  const validValues = values.filter((value) => value !== null);

  const hasData = validValues.length > 0;

  setChartEmpty("durationChart", "durationEmpty", !hasData);

  if (!hasData) return;

  const maxValue = Math.max(...validValues);
  const stepSize = getDurationStep(maxValue);
  const maxAxis = Math.max(
    stepSize,
    Math.ceil(maxValue / stepSize) * stepSize
  );

  const options = getChartBaseOptions();

  charts.duration = new Chart($("durationChart"), {
    type: "bar",

    data: {
      labels: data.map((session, index) =>
        getAttemptAxisLabel(session, index)
      ),

      datasets: [{
        label: "Durasi latihan",
        data: values,
        backgroundColor: "rgba(92, 143, 214, 0.78)",
        hoverBackgroundColor: COLORS.blue,
        borderRadius: 8,
        maxBarThickness: 38
      }]
    },

    options: {
      ...options,

      plugins: {
        ...options.plugins,

        tooltip: {
          ...options.plugins.tooltip,

          callbacks: {
            title(context) {
              return getChartTooltipTitle(data, context);
            },

            label(context) {
              return `Durasi: ${formatDuration(context.parsed.y)}`;
            },

            afterLabel(context) {
              const session = data[context.dataIndex];

              return [
                `Posisi: ${getRole(session)}`,
                `Level: ${getExperienceLevel(session)}`
              ];
            }
          }
        }
      },

      scales: {
        x: options.scales.x,

        y: {
          beginAtZero: true,
          min: 0,
          max: maxAxis,
          grid: {
            color: "rgba(100, 116, 139, 0.13)"
          },
          border: {
            display: false
          },
          ticks: {
            color: "#718096",
            padding: 8,
            stepSize,
            precision: 0,
            callback(value) {
              return formatDurationAxis(value);
            }
          },
          title: {
            display: true,
            text: "Durasi (menit)",
            color: "#718096",
            padding: {
              top: 8,
              bottom: 4
            },
            font: {
              size: 11,
              weight: "600"
            }
          }
        }
      }
    }
  });
}

// =====================================================
// VISUAL SESSION SELECTOR
// =====================================================

function renderVisualSessionSelector(data) {
  const select = $("visualSessionSel");

  if (!select) return;

  if (!data.length) {
    select.innerHTML = `<option value="">Tidak ada sesi</option>`;
    renderSelectedVisuals([]);
    return;
  }

  const previousId = selectedVisualSessionId;

  const selectedStillExists = data.some(
    (session) => getSessionId(session) === previousId
  );

  if (!selectedStillExists) {
    selectedVisualSessionId = getSessionId(data[data.length - 1]);
  }

  select.innerHTML = data.map((session, index) => {
    const id = getSessionId(session);
    const date = formatDate(getSessionDate(session));
    const attemptLabel = getAttemptLabel(session, index);

    return `
      <option
        value="${escapeHTML(id)}"
        ${id === selectedVisualSessionId ? "selected" : ""}
      >
        ${escapeHTML(attemptLabel)} · ${escapeHTML(date)}
      </option>
    `;
  }).join("");

  select.value = selectedVisualSessionId;

  renderSelectedVisuals(data);
}

function getSelectedVisualSession(data) {
  if (!data.length) return null;

  return data.find(
    (session) => getSessionId(session) === selectedVisualSessionId
  ) || null;
}

function renderSelectedVisuals(data) {
  const selected = getSelectedVisualSession(data);
  const info = $("visualSessionInfo");

  if (!selected) {
    if (info) {
      info.textContent =
        "Belum ada sesi yang dapat digunakan untuk analisis visual.";
    }

    renderGazeChart(null);
    renderHeadMotionChart(null);
    renderExpressionChart(null);

    return;
  }

  const index = data.findIndex(
    (session) => getSessionId(session) === selectedVisualSessionId
  );

  const attemptLabel = getAttemptLabel(selected, index);
  const date = formatDate(getSessionDate(selected));

  if (info) {
    info.textContent =
      `Menampilkan data visual ${attemptLabel} · ${date}. ` +
      "Seluruh grafik analisis visual menggunakan sesi yang sama.";
  }

  renderGazeChart(selected);
  renderHeadMotionChart(selected);
  renderExpressionChart(selected);
}

// =====================================================
// VISUAL DATA HELPERS
// =====================================================

function getIndicatorSummary(session, indicator) {
  return session?.cv_summary?.[indicator] || null;
}

function getLabelEntries(session, indicator) {
  const summary = getIndicatorSummary(session, indicator);
  const labels = summary?.labels || {};

  return Object.entries(labels)
    .map(([label, count]) => ({
      label,
      count: toNumber(count) || 0
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
}

// =====================================================
// DISTRIBUTION SUMMARY
// =====================================================

function renderDistributionSummary(containerId, entries, colors) {
  const container = $(containerId);

  if (!container) return;

  if (!entries.length) {
    container.innerHTML = `
      <p class="muted small">
        Belum ada data distribusi pada sesi ini.
      </p>
    `;

    return;
  }

  const total = entries.reduce(
    (sum, item) => sum + item.count,
    0
  );

  container.innerHTML = entries.map((item, index) => {
    const percentage = total > 0
      ? (item.count / total * 100)
      : 0;

    const color = colors[index % colors.length];

    return `
      <div class="distribution-item">
        <div class="distribution-item-top">
          <span>
            <i style="background:${color}"></i>
            ${escapeHTML(item.label)}
          </span>
          <strong>${item.count}</strong>
        </div>

        <div class="distribution-track">
          <span
            style="
              width:${percentage}%;
              background:${color}
            "
          ></span>
        </div>
      </div>
    `;
  }).join("");
}

// =====================================================
// DOUGHNUT CHART
// =====================================================

function renderDoughnutChart({
  chartId,
  emptyId,
  summaryId,
  entries,
  label,
  chartKey
}) {
  destroyChart(chartKey);

  const hasData = entries.length > 0;

  setChartEmpty(chartId, emptyId, !hasData);

  renderDistributionSummary(
    summaryId,
    entries,
    DISTRIBUTION_COLORS
  );

  if (!hasData) return;

  charts[chartKey] = new Chart($(chartId), {
    type: "doughnut",

    data: {
      labels: entries.map((item) => item.label),

      datasets: [{
        label,
        data: entries.map((item) => item.count),
        backgroundColor: entries.map(
          (_, index) =>
            DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length]
        ),
        borderColor: "#ffffff",
        borderWidth: 2,
        hoverOffset: 7,
        spacing: 2
      }]
    },

    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "66%",

      layout: {
        padding: 8
      },

      plugins: {
        legend: {
          display: false
        },

        tooltip: {
          enabled: true,
          backgroundColor: "#173d3a",
          padding: 12,

          callbacks: {
            label(context) {
              const total = context.dataset.data.reduce(
                (sum, value) => sum + value,
                0
              );

              const percentage = total
                ? Math.round(context.parsed / total * 100)
                : 0;

              return `${context.label}: ${context.parsed} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}

// =====================================================
// CHART 3: GAZE DISTRIBUTION
// =====================================================

function renderGazeChart(session) {
  const entries = getLabelEntries(session, "gaze");

  const subtitle = $("gazeSubtitle");

  if (subtitle) {
    subtitle.textContent = session
      ? "Distribusi label pandangan pada percobaan terpilih."
      : "Belum ada sesi terpilih.";
  }

  renderDoughnutChart({
    chartId: "gazeChart",
    emptyId: "gazeEmpty",
    summaryId: "gazeSummary",
    entries,
    label: "Pandangan",
    chartKey: "gaze"
  });
}

// =====================================================
// CHART 4: HEAD MOTION DISTRIBUTION
// =====================================================

function renderHeadMotionChart(session) {
  const entries = getLabelEntries(session, "head_motion");

  const subtitle = $("headMotionSubtitle");

  if (subtitle) {
    subtitle.textContent = session
      ? "Distribusi label arah kepala pada percobaan terpilih."
      : "Belum ada sesi terpilih.";
  }

  renderDoughnutChart({
    chartId: "headMotionChart",
    emptyId: "headMotionEmpty",
    summaryId: "headMotionSummary",
    entries,
    label: "Arah kepala",
    chartKey: "headMotion"
  });
}

// =====================================================
// CHART 5: EXPRESSION DISTRIBUTION
// =====================================================

function renderExpressionChart(session) {
  const entries = getLabelEntries(session, "expression");

  const subtitle = $("expressionSubtitle");

  if (subtitle) {
    subtitle.textContent = session
      ? "Distribusi label ekspresi pada percobaan terpilih."
      : "Belum ada sesi terpilih.";
  }

  renderDoughnutChart({
    chartId: "expressionChart",
    emptyId: "expressionEmpty",
    summaryId: "expressionSummary",
    entries,
    label: "Ekspresi wajah",
    chartKey: "expression"
  });
}

// =====================================================
// SESSION TABLE
// =====================================================

function renderTable(data) {
  const table = $("tbl");

  if (!table) return;

  $("tableCount").textContent = `${data.length} sesi`;

  if (!data.length) {
    table.innerHTML = `
      <tbody>
        <tr>
          <td class="muted">Belum ada sesi untuk posisi ini.</td>
        </tr>
      </tbody>
    `;

    return;
  }

  const rows = [...data].reverse();

  table.innerHTML = `
    <thead>
      <tr>
        <th>No.</th>
        <th>Percobaan</th>
        <th>Posisi</th>
        <th>Level</th>
        <th>Tanggal</th>
        <th>Durasi</th>
        <th>Status</th>
        <th>Nilai rubrik</th>
        <th>Aksi</th>
      </tr>
    </thead>

    <tbody>
      ${rows.map((session, index) => {
        const id = getSessionId(session);
        const rubric = getRubricScore(session);
        const originalIndex = data.indexOf(session);
        const status = getSessionStatus(session);

        return `
          <tr>
            <td>${index + 1}</td>

            <td>
              ${escapeHTML(getAttemptLabel(session, originalIndex))}
            </td>

            <td>${escapeHTML(getRole(session))}</td>

            <td>
              <span class="history-level">
                ${escapeHTML(getExperienceLevel(session))}
              </span>
            </td>

            <td>
              ${escapeHTML(formatDate(getSessionDate(session)))}
            </td>

            <td>
              ${escapeHTML(
                formatDuration(getDurationSeconds(session))
              )}
            </td>

            <td>
              <span class="history-status">
                ${escapeHTML(status)}
              </span>
            </td>

            <td>
              ${
                rubric === null
                  ? "-"
                  : `${rubric.toFixed(1).replace(".", ",")}%`
              }
            </td>

            <td>
              ${
                id
                  ? `<a class="btn" href="report.html?id=${encodeURIComponent(id)}">Lihat laporan</a>`
                  : "-"
              }
            </td>
          </tr>
        `;
      }).join("")}
    </tbody>
  `;
}
