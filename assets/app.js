import {
  buildClassScoreAoA,
  parseCoefficientRules,
  summarizeWorkbook,
} from "./scoring-core.js";
import * as XLSX from "../vendor/xlsx.mjs";

const elements = {
  dropZone: document.querySelector("#dropZone"),
  fileInput: document.querySelector("#fileInput"),
  fileList: document.querySelector("#fileList"),
  results: document.querySelector("#results"),
  runButton: document.querySelector("#runButton"),
  clearButton: document.querySelector("#clearButton"),
  statusText: document.querySelector("#statusText"),
  resultTemplate: document.querySelector("#resultTemplate"),
  targetCounty: document.querySelector("#targetCounty"),
  passRatio: document.querySelector("#passRatio"),
  excellentRatio: document.querySelector("#excellentRatio"),
  scoreWeight: document.querySelector("#scoreWeight"),
  passWeight: document.querySelector("#passWeight"),
  excellentWeight: document.querySelector("#excellentWeight"),
  gradeName: document.querySelector("#gradeName"),
  fallbackCoefficient: document.querySelector("#fallbackCoefficient"),
  coefficientRules: document.querySelector("#coefficientRules"),
};

let selectedFiles = [];

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Number(value).toFixed(digits);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setStatus(text) {
  elements.statusText.textContent = text;
}

function renderFileList() {
  elements.fileList.innerHTML = "";
  if (!selectedFiles.length) {
    elements.fileList.hidden = true;
    return;
  }
  elements.fileList.hidden = false;
  selectedFiles.forEach((file) => {
    const row = document.createElement("div");
    row.className = "file-pill";
    row.innerHTML = `<span>${file.name}</span><span>${formatBytes(file.size)}</span>`;
    elements.fileList.append(row);
  });
}

function readConfig() {
  return {
    targetCounty: elements.targetCounty.value.trim(),
    passRatio: Number(elements.passRatio.value),
    excellentRatio: Number(elements.excellentRatio.value),
    scoreWeight: Number(elements.scoreWeight.value),
    passWeight: Number(elements.passWeight.value),
    excellentWeight: Number(elements.excellentWeight.value),
    gradeName: elements.gradeName.value.trim() || "六",
    fallbackCoefficient: Number(elements.fallbackCoefficient.value) || 1,
    coefficientRules: parseCoefficientRules(elements.coefficientRules.value),
  };
}

function workbookFromAoAs(summary, originalAoA) {
  const workbook = XLSX.utils.book_new();
  const appendSheet = (name, aoa) => {
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
    return sheet;
  };

  const originalSheet = appendSheet("原始成绩", originalAoA);
  originalSheet["!cols"] = Array.from({ length: originalAoA[0]?.length || 12 }, () => ({ wch: 14 }));

  const cleanSheet = appendSheet("计算用成绩", summary.cleanAoA);
  cleanSheet["!cols"] = [{ wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, ...summary.subjects.map(() => ({ wch: 10 })), { wch: 10 }];

  const detailSheet = appendSheet("三率计分表", summary.detailAoA);
  detailSheet["!cols"] = Array.from({ length: summary.detailAoA[0].length }, (_, index) => ({ wch: index < 2 ? 18 : 12 }));

  const scoreSheet = appendSheet("班级各科评分表", summary.classScoreAoA);
  const lastColIndex = 4 + summary.subjects.length * 3 + 1;
  scoreSheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastColIndex } },
    ...summary.subjects.map((_, index) => {
      const start = 5 + index * 3;
      return { s: { r: 1, c: start }, e: { r: 1, c: start + 2 } };
    }),
  ];
  scoreSheet["!cols"] = [
    { wch: 8 },
    { wch: 18 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    ...summary.subjects.flatMap(() => [{ wch: 11 }, { wch: 8 }, { wch: 12 }]),
    { wch: 10 },
  ];

  const rulesSheet = appendSheet("规则说明", summary.rulesAoA);
  rulesSheet["!cols"] = [{ wch: 18 }, { wch: 80 }];

  return workbook;
}

function downloadWorkbook(summary, originalAoA, fileName) {
  const workbook = workbookFromAoAs(summary, originalAoA);
  const cleanName = fileName.replace(/\.(xlsx|xls)$/i, "");
  XLSX.writeFile(workbook, `${cleanName}-班级各科评分表.xlsx`, { compression: true });
}

function renderStats(container, summary) {
  const stats = [
    ["原始记录", summary.sourceRows.length],
    ["计算记录", summary.filteredRows.length],
    ["班级数", summary.classes.length],
    ["科目数", summary.subjects.length],
  ];
  container.innerHTML = "";
  stats.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "stat";
    item.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
    container.append(item);
  });
}

function renderPreview(table, summary) {
  const scoreAoA = buildClassScoreAoA(summary.classes, summary.subjects, {
    title: "",
    gradeName: elements.gradeName.value.trim() || "六",
  }).slice(1);
  const headers = ["年级", "学校", "班次", "学籍人数", "参考人数"];
  summary.subjects.forEach((subject) => headers.push(`${subject.label}得分`, `${subject.label}名次`));
  headers.push("办学系数");

  const rows = scoreAoA.slice(2).map((row) => {
    const base = row.slice(0, 5);
    const subjectCells = [];
    summary.subjects.forEach((_, index) => {
      const start = 5 + index * 3;
      subjectCells.push(formatNumber(row[start]), row[start + 1]);
    });
    return [...base, ...subjectCells, formatNumber(row[row.length - 1])];
  });

  table.querySelector("thead").innerHTML = `<tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>`;
  table.querySelector("tbody").innerHTML = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell ?? ""}</td>`).join("")}</tr>`)
    .join("");
}

function renderResult(file, summary, originalAoA) {
  const node = elements.resultTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector("h3").textContent = file.name;
  node.querySelector(".result-meta").textContent = `${summary.sourceSheetName || "成绩表"} | ${summary.subjects.map((subject) => `${subject.label}${subject.fullScore}`).join("、")} | ${summary.filteredRows.length} 条纳入计算`;
  renderStats(node.querySelector(".stats-row"), summary);
  renderPreview(node.querySelector("table"), summary);
  node.querySelector(".download-action").addEventListener("click", () => downloadWorkbook(summary, originalAoA, file.name));
  elements.results.append(node);
}

async function processFile(file, config) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  let lastError = null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const values = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    try {
      const summary = summarizeWorkbook(values, config);
      summary.sourceSheetName = sheetName;
      renderResult(file, summary, values);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("没有找到可计算的成绩 sheet。");
}

function renderMessage(text, type = "warning") {
  const message = document.createElement("div");
  message.className = `message ${type}`;
  message.textContent = text;
  elements.results.append(message);
}

async function run() {
  elements.results.innerHTML = "";
  if (!selectedFiles.length) {
    renderMessage("请先选择 Excel 文件。");
    setStatus("等待上传");
    return;
  }

  const config = readConfig();
  elements.runButton.disabled = true;
  setStatus("正在计算");

  let successCount = 0;
  for (const file of selectedFiles) {
    try {
      await processFile(file, config);
      successCount += 1;
    } catch (error) {
      renderMessage(`${file.name}: ${error.message}`, "error");
    }
  }

  elements.runButton.disabled = false;
  setStatus(successCount ? `已完成 ${successCount} 个文件` : "没有生成结果");
}

function addFiles(fileList) {
  const incoming = Array.from(fileList).filter((file) => /\.(xlsx|xls)$/i.test(file.name));
  const existingKeys = new Set(selectedFiles.map((file) => `${file.name}:${file.size}`));
  incoming.forEach((file) => {
    const key = `${file.name}:${file.size}`;
    if (!existingKeys.has(key)) selectedFiles.push(file);
  });
  renderFileList();
  setStatus(selectedFiles.length ? `已选择 ${selectedFiles.length} 个文件` : "等待上传");
}

elements.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
elements.runButton.addEventListener("click", run);
elements.clearButton.addEventListener("click", () => {
  selectedFiles = [];
  elements.fileInput.value = "";
  elements.results.innerHTML = "";
  renderFileList();
  setStatus("等待上传");
});

["dragenter", "dragover"].forEach((name) => {
  elements.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((name) => {
  elements.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
});

elements.dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
renderFileList();
