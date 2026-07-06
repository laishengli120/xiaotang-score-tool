export const DEFAULT_SUBJECTS = [
  { key: "chinese", label: "语文", aliases: ["语文", "语文100"], defaultFullScore: 100 },
  { key: "math", label: "数学", aliases: ["数学", "数学100"], defaultFullScore: 100 },
  { key: "english", label: "英语", aliases: ["英语", "英语100"], defaultFullScore: 100 },
  { key: "science", label: "科学", aliases: ["科学", "科学50"], defaultFullScore: 50 },
  { key: "moral", label: "道德", aliases: ["道德", "道德50"], defaultFullScore: 50 },
];

export function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function normalizeClass(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  const text = String(value).trim();
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

function normalizeCountyKey(value) {
  return normalizeText(value).replace(/^\d+/, "");
}

export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseCoefficientRules(rawText) {
  return normalizeText(rawText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pattern, value] = line.split("=").map((part) => part.trim());
      return { pattern, value: Number(value) };
    })
    .filter((rule) => rule.pattern && Number.isFinite(rule.value));
}

export function coefficientForSchool(school, rules, fallbackCoefficient = 1) {
  const normalizedSchool = normalizeText(school);
  const matched = rules.find((rule) => normalizedSchool.includes(rule.pattern));
  return matched ? matched.value : fallbackCoefficient;
}

function findHeaderIndex(headers, aliases) {
  return headers.findIndex((header) => aliases.some((alias) => header === alias || header.replace(/\s/g, "") === alias));
}

function fullScoreFromHeader(header, defaultFullScore) {
  const match = normalizeText(header).match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : defaultFullScore;
}

export function parseScoreRows(values, options) {
  const headerRowIndex = values.findIndex((row) => row.some((cell) => ["准考证号", "准考证"].includes(normalizeText(cell))));
  if (headerRowIndex === -1) throw new Error("找不到表头行：缺少“准考证号”或“准考证”。");

  const headers = values[headerRowIndex].map(normalizeText);
  const getColumn = (names) => {
    const aliases = Array.isArray(names) ? names : [names];
    const index = headers.findIndex((header) => aliases.includes(header));
    if (index === -1) throw new Error(`缺少必要列：${aliases.join(" / ")}`);
    return index;
  };

  const indexMap = {
    examNo: getColumn(["准考证号", "准考证"]),
    county: getColumn(["县区", "乡镇"]),
    school: getColumn("学校"),
    className: getColumn("班级"),
    name: getColumn("姓名"),
  };

  const subjects = DEFAULT_SUBJECTS.map((subject) => {
    const index = findHeaderIndex(headers, subject.aliases);
    if (index === -1) return null;
    return {
      key: subject.key,
      label: subject.label,
      sourceHeader: headers[index],
      columnIndex: index,
      fullScore: fullScoreFromHeader(headers[index], subject.defaultFullScore),
    };
  }).filter(Boolean);

  if (!subjects.length) throw new Error("没有找到可计算的科目列。");

  const totalIndex = headers.indexOf("总分");
  const sourceRows = values
    .slice(headerRowIndex + 1)
    .filter((row) => normalizeText(row[indexMap.examNo]) !== "");

  const targetCounty = normalizeText(options.targetCounty);
  const targetCountyKey = normalizeCountyKey(targetCounty);
  const filteredRows = sourceRows
    .map((row) => {
      const record = {
        examNo: normalizeText(row[indexMap.examNo]),
        county: normalizeText(row[indexMap.county]),
        school: normalizeText(row[indexMap.school]),
        className: normalizeClass(row[indexMap.className]),
        name: normalizeText(row[indexMap.name]),
        total: totalIndex >= 0 ? toNumber(row[totalIndex]) : null,
        scores: {},
      };
      subjects.forEach((subject) => {
        record.scores[subject.key] = toNumber(row[subject.columnIndex]);
      });
      return record;
    })
    .filter((row) => !targetCounty || row.county === targetCounty || normalizeCountyKey(row.county) === targetCountyKey);

  if (!filteredRows.length) {
    throw new Error(targetCounty ? `没有找到县区为“${targetCounty}”的记录。` : "没有可计算的成绩记录。");
  }

  return {
    title: normalizeText(values[0]?.[0]) || "成绩表",
    headerRowIndex,
    headers,
    subjects,
    sourceRows,
    filteredRows,
  };
}

function rankDescending(items, accessor) {
  return items.map((item) => 1 + items.filter((other) => accessor(other) > accessor(item)).length);
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarizeClasses(records, subjects, config) {
  const groups = new Map();
  records.forEach((record) => {
    const key = `${record.school}\u0000${record.className}`;
    if (!groups.has(key)) {
      groups.set(key, {
        school: record.school,
        className: record.className,
        rows: [],
        coefficient: coefficientForSchool(record.school, config.coefficientRules, config.fallbackCoefficient),
        metrics: {},
      });
    }
    groups.get(key).rows.push(record);
  });

  const classes = Array.from(groups.values()).sort((a, b) => {
    const schoolCompare = a.school.localeCompare(b.school, "zh-Hans-CN");
    if (schoolCompare !== 0) return schoolCompare;
    return a.className.localeCompare(b.className, "zh-Hans-CN", { numeric: true });
  });

  classes.forEach((classItem) => {
    const referenceCount = classItem.rows.length;
    subjects.forEach((subject) => {
      const scores = classItem.rows
        .map((row) => row.scores[subject.key])
        .filter((value) => value !== null);
      const average = mean(scores);
      const passThreshold = subject.fullScore * (config.passRatio / 100);
      const excellentThreshold = subject.fullScore * (config.excellentRatio / 100);
      const passCount = scores.filter((value) => value >= passThreshold).length;
      const excellentCount = scores.filter((value) => value >= excellentThreshold).length;
      classItem.metrics[subject.key] = {
        average,
        scoreRate: subject.fullScore ? average / subject.fullScore : 0,
        passCount,
        passRate: referenceCount ? passCount / referenceCount : 0,
        excellentCount,
        excellentRate: referenceCount ? excellentCount / referenceCount : 0,
      };
    });
  });

  subjects.forEach((subject) => {
    const maxScoreRate = Math.max(...classes.map((item) => item.metrics[subject.key].scoreRate), 0);
    const maxPassRate = Math.max(...classes.map((item) => item.metrics[subject.key].passRate), 0);
    const maxExcellentRate = Math.max(...classes.map((item) => item.metrics[subject.key].excellentRate), 0);

    classes.forEach((classItem) => {
      const metric = classItem.metrics[subject.key];
      metric.scoreRatePoints = maxScoreRate ? (metric.scoreRate / maxScoreRate) * config.scoreWeight : 0;
      metric.passRatePoints = maxPassRate ? (metric.passRate / maxPassRate) * config.passWeight : 0;
      metric.excellentRatePoints = maxExcellentRate ? (metric.excellentRate / maxExcellentRate) * config.excellentWeight : 0;
      metric.rawSubjectScore = metric.scoreRatePoints + metric.passRatePoints + metric.excellentRatePoints;
      metric.finalSubjectScore = metric.rawSubjectScore * classItem.coefficient;
    });

    const ranks = rankDescending(classes, (classItem) => classItem.metrics[subject.key].finalSubjectScore);
    classes.forEach((classItem, index) => {
      classItem.metrics[subject.key].rank = ranks[index];
    });
  });

  return classes;
}

export function buildCleanScoreAoA(records, subjects) {
  return [
    ["县区", "学校", "班级", "姓名", ...subjects.map((subject) => subject.label), "总分"],
    ...records.map((record) => [
      record.county,
      record.school,
      record.className,
      record.name,
      ...subjects.map((subject) => record.scores[subject.key]),
      record.total,
    ]),
  ];
}

export function buildDetailAoA(classes, subjects) {
  const headers = ["学校", "班级", "参考人数", "办学系数"];
  subjects.forEach((subject) => {
    headers.push(
      `${subject.label}平均分`,
      `${subject.label}得分率`,
      `${subject.label}得分率计分`,
      `${subject.label}合格人数`,
      `${subject.label}合格率`,
      `${subject.label}合格率计分`,
      `${subject.label}优秀人数`,
      `${subject.label}优秀率`,
      `${subject.label}优秀率计分`,
      `${subject.label}总分`,
    );
  });

  return [
    headers,
    ...classes.map((classItem) => {
      const row = [classItem.school, classItem.className, classItem.rows.length, classItem.coefficient];
      subjects.forEach((subject) => {
        const metric = classItem.metrics[subject.key];
        row.push(
          metric.average,
          metric.scoreRate,
          metric.scoreRatePoints,
          metric.passCount,
          metric.passRate,
          metric.passRatePoints,
          metric.excellentCount,
          metric.excellentRate,
          metric.excellentRatePoints,
          metric.rawSubjectScore,
        );
      });
      return row;
    }),
  ];
}

export function buildClassScoreAoA(classes, subjects, options) {
  const firstHeader = ["年级", "学校", "班次", "学籍人数", "参考人数"];
  subjects.forEach((subject) => firstHeader.push(subject.label, "", ""));
  firstHeader.push("办学系数");

  const secondHeader = ["", "", "", "", ""];
  subjects.forEach(() => secondHeader.push("得分", "名次", "教师"));
  secondHeader.push("");

  return [
    [options.title],
    firstHeader,
    secondHeader,
    ...classes.map((classItem) => {
      const row = [
        options.gradeName,
        classItem.school,
        classItem.className,
        classItem.rows.length,
        classItem.rows.length,
      ];
      subjects.forEach((subject) => {
        const metric = classItem.metrics[subject.key];
        row.push(metric.finalSubjectScore, metric.rank, "");
      });
      row.push(classItem.coefficient);
      return row;
    }),
  ];
}

export function buildRulesAoA(stats, config) {
  return [
    ["项目", "说明"],
    ["数据范围", config.targetCounty ? `仅纳入县区 = ${config.targetCounty} 的记录。` : "纳入全部记录。"],
    ["班级归并", "班级代码按文本归一，数字 61 与文本 61 归为同一班。"],
    ["得分率", "各科平均分 / 科目满分。"],
    ["合格率", `各科分数 >= 满分的 ${config.passRatio}% 的人数 / 参考人数。`],
    ["优秀率", `各科分数 >= 满分的 ${config.excellentRatio}% 的人数 / 参考人数。`],
    ["各科计分", `得分率 ${config.scoreWeight} 分、合格率 ${config.passWeight} 分、优秀率 ${config.excellentWeight} 分，并按本表各班最高率归一。`],
    ["最终得分", "各科三率计分合计 × 办学系数。"],
    ["记录数", `原始成绩记录 ${stats.sourceCount} 条；纳入计算 ${stats.filteredCount} 条；班级 ${stats.classCount} 个。`],
  ];
}

export function summarizeWorkbook(values, config) {
  const parsed = parseScoreRows(values, config);
  const classes = summarizeClasses(parsed.filteredRows, parsed.subjects, config);
  return {
    ...parsed,
    classes,
    cleanAoA: buildCleanScoreAoA(parsed.filteredRows, parsed.subjects),
    detailAoA: buildDetailAoA(classes, parsed.subjects),
    classScoreAoA: buildClassScoreAoA(classes, parsed.subjects, {
      title: parsed.title.replace("成绩表", "班级各科评分表"),
      gradeName: config.gradeName,
    }),
    rulesAoA: buildRulesAoA(
      {
        sourceCount: parsed.sourceRows.length,
        filteredCount: parsed.filteredRows.length,
        classCount: classes.length,
      },
      config,
    ),
  };
}
