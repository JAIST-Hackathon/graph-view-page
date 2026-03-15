// ================================================================
// 設定
// ================================================================
const AVAILABLE_YEARS = [2026, 2025];
const DEFAULT_YEAR = 2026;
const CAMPUS = "ishikawa";

function syllabusCsvPath(year) {
    return `data/${year}/jaist_syllabus_${CAMPUS}_${year}.csv`;
}
function relationCsvPath(year) {
    return `data/${year}/class_relation.csv`;
}

// ================================================================
// グローバル状態
// ================================================================
const loadingMessage = document.getElementById('loadingMessage');

let nodesAllGlobal;
let edgesGlobal;
let network;
let SyllabusArray = [];
let relationArray = [];

// ================================================================
// 開講時期 → ノード色
// ================================================================
const termColorMap = {
    "1の1期": { background: "#AED581", border: "#7CB342" },
    "1の2期": { background: "#4FC3F7", border: "#0288D1" },
    "2の1期": { background: "#FFB74D", border: "#F57C00" },
    "2の2期": { background: "#CE93D8", border: "#AB47BC" },
    "夏期集中": { background: "#FF8A65", border: "#E64A19" },
    "冬期集中": { background: "#90CAF9", border: "#1565C0" },
    "通年":    { background: "#FFF176", border: "#F9A825" },
    "非開講":  { background: "#E0E0E0", border: "#9E9E9E" },
};
const defaultNodeColor = { background: "#B0BEC5", border: "#607D8B" };

function getNodeColor(term) {
    if (termColorMap[term]) return termColorMap[term];
    const first = term.split("・")[0];
    return termColorMap[first] || defaultNodeColor;
}

// ================================================================
// エッジスタイル
// ================================================================
function edge_styles(edge) {
    if (edge.label === "required") {
        return {
            from: edge.source, to: edge.target,
            arrows: "to", label: "required",
            color: { color: "#D32F2F", highlight: "#B71C1C" },
            width: 2,
        };
    } else if (edge.label === "prerequisite") {
        return {
            from: edge.source, to: edge.target,
            arrows: "to", label: "prerequisite",
            color: { color: "#E53935", highlight: "#C62828" },
        };
    } else if (edge.label === "recommended") {
        return {
            from: edge.source, to: edge.target,
            arrows: "to", label: "recommended",
            color: { color: "#1976D2", highlight: "#0D47A1" },
        };
    } else if (edge.label === "related") {
        return {
            from: edge.source, to: edge.target,
            label: "related",
            color: { color: "#757575", highlight: "#424242" },
            dashes: true,
        };
    } else if (edge.label === "exclusive") {
        return {
            from: edge.source, to: edge.target,
            label: "exclusive",
            color: { color: "#AB47BC", highlight: "#7B1FA2" },
            width: 2,
        };
    } else {
        return {
            from: edge.source, to: edge.target,
            label: edge.label,
        };
    }
}

// ================================================================
// CSV読み込み
// ================================================================
async function loadCsv(csvFilePath) {
    try {
        loadingMessage.style.display = 'block';
        const response = await fetch(csvFilePath);
        if (!response.ok) {
            throw new Error(`HTTPエラー: ${response.status} ${response.statusText}`);
        }
        const csvText = await response.text();
        return new Promise((resolve, reject) => {
            Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => { loadingMessage.style.display = 'none'; resolve(results.data); },
                error: (err) => { reject(new Error(`CSV解析エラー: ${err.message}`)); },
            });
        });
    } catch (error) {
        console.error("致命的エラー:", error);
        loadingMessage.style.display = 'none';
        return [];
    }
}

// ================================================================
// データ変換
// ================================================================
function deduplicateByName(rows) {
    const map = new Map();
    rows.forEach(row => {
        const name = row.講義名称;
        if (map.has(name)) {
            const existing = map.get(name);
            if (!existing.開講時期.includes(row.開講時期)) {
                existing.開講時期 += "・" + row.開講時期;
            }
        } else {
            map.set(name, { ...row });
        }
    });
    return Array.from(map.values());
}

function convSyllabusArray2Nodes(ary) {
    const nodes = ary.map(node => {
        const color = getNodeColor(node.開講時期);
        return {
            id: node.講義名称,
            label: node.講義名称,
            color: {
                background: color.background,
                border: color.border,
                highlight: { background: color.background, border: "#333" },
            },
            font: { size: 14 },
        };
    });
    return new vis.DataSet(nodes);
}

function convRelationArray2Edges(ary) {
    return new vis.DataSet(ary.map(edge => edge_styles(edge)));
}

// ================================================================
// 講義情報表示
// ================================================================
function writeClassInfo(className) {
    const record = SyllabusArray.find(row => row.講義名称 === className);

    if (!record) {
        document.getElementById("className").innerText = className;
        document.getElementById("classCode").innerText = "（データなし）";
        document.getElementById("regulationSubjectName").innerText = "";
        document.getElementById("campus").innerText = "";
        document.getElementById("instructor").innerText = "";
        document.getElementById("subjectGroup").innerText = "";
        document.getElementById("subjectCode").innerText = "";
        document.getElementById("language").innerText = "";
        document.getElementById("term").innerText = "";
        document.getElementById("syllabusUrl").href = "#";
        return;
    }

    document.getElementById("className").innerText = record.講義名称;
    document.getElementById("classCode").innerText = record.講義コード;
    document.getElementById("regulationSubjectName").innerText = record.学則科目名称;
    document.getElementById("campus").innerText = record.校地;
    document.getElementById("instructor").innerText = record.代表教員;
    document.getElementById("subjectGroup").innerText = record.科目群;
    document.getElementById("subjectCode").innerText = record.科目コード;
    document.getElementById("language").innerText = record.授業実践言語;
    document.getElementById("term").innerText = record.開講時期;
    document.getElementById("syllabusUrl").href = record.URL;
}

// ================================================================
// グラフ描画
// ================================================================
function displayGraph(nodes, edges) {
    if (!nodes) nodes = nodesAllGlobal;
    if (!edges) edges = edgesGlobal;

    const container = document.getElementById("network");
    const data = { nodes, edges };
    const options = {
        interaction: { navigationButtons: true, keyboard: true },
        nodes: {
            shape: "box",
            margin: { top: 8, bottom: 8, left: 10, right: 10 },
        },
        edges: {
            font: { size: 10, align: "top" },
            smooth: { type: "cubicBezier" },
        },
        physics: {
            barnesHut: { springLength: 260, springConstant: 0.02 },
            minVelocity: 0.75,
        },
    };
    network = new vis.Network(container, data, options);

    network.on("click", function (params) {
        if (this.getNodeAt(params.pointer.DOM) == undefined) return;
        writeClassInfo(this.getNodeAt(params.pointer.DOM));
    });
    network.on("doubleClick", function (params) {
        if (this.getNodeAt(params.pointer.DOM) == undefined) return;
        const clickedNode = this.getNodeAt(params.pointer.DOM);
        writeClassInfo(clickedNode);
        showRelatedGraph(clickedNode);
    });
}

// ================================================================
// 連結ノード抽出
// ================================================================
function makeNodeObj(name) {
    const record = SyllabusArray.find(row => row.講義名称 === name);
    const term = record ? record.開講時期 : "";
    const color = getNodeColor(term);
    return {
        id: name, label: name,
        color: {
            background: color.background,
            border: color.border,
            highlight: { background: color.background, border: "#333" },
        },
    };
}

function getConnectedNodes() {
    const nodeNames = Array.from(new Set(
        relationArray.flatMap(edge => [edge.source, edge.target])
    ));
    return new vis.DataSet(nodeNames.map(makeNodeObj));
}

function displayConnectedGraph() {
    displayGraph(getConnectedNodes(), edgesGlobal);
}

function getConnectedNodesToNode(className, depth) {
    const visited = new Set();
    const queue = [{ name: className, level: 0 }];
    visited.add(className);

    while (queue.length > 0) {
        const current = queue.shift();
        if (depth > 0 && current.level >= depth) continue;

        relationArray.forEach(edge => {
            let neighbor = null;
            if (edge.source === current.name) neighbor = edge.target;
            else if (edge.target === current.name) neighbor = edge.source;

            if (neighbor && !visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push({ name: neighbor, level: current.level + 1 });
            }
        });
    }

    return Array.from(visited).map(makeNodeObj);
}

function showRelatedGraph(className) {
    const depth = parseInt(document.getElementById("depthSelect").value, 10);
    const connectedNodes = getConnectedNodesToNode(className, depth);
    displayGraph(connectedNodes, edgesGlobal);
}

// ================================================================
// 凡例
// ================================================================
function buildNodeLegend() {
    const container = document.getElementById("nodeLegend");
    container.innerHTML = "";
    Object.entries(termColorMap).forEach(([term, color]) => {
        const item = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML =
            `<span class="legend-node" style="background:${color.background};border-color:${color.border}"></span>` +
            `<span>${term}</span>`;
        container.appendChild(item);
    });
}

// ================================================================
// テキスト検索
// ================================================================
function setupSearch() {
    const searchInput = document.getElementById("classSearch");
    const searchResults = document.getElementById("searchResults");

    searchInput.addEventListener("input", function () {
        const query = this.value.trim().toLowerCase();
        searchResults.innerHTML = "";

        if (query.length === 0) {
            searchResults.style.display = "none";
            return;
        }

        const matches = SyllabusArray.filter(record => {
            const name = (record.講義名称 || "").toLowerCase();
            const code = (record.科目コード || "").toLowerCase();
            const instructor = (record.代表教員 || "").toLowerCase();
            return name.includes(query) || code.includes(query) || instructor.includes(query);
        });

        if (matches.length === 0) {
            searchResults.style.display = "none";
            return;
        }

        matches.forEach(record => {
            const item = document.createElement("div");
            item.className = "search-result-item";
            item.textContent = record.科目コード + " " + record.講義名称;
            item.addEventListener("click", () => {
                searchInput.value = record.講義名称;
                searchResults.style.display = "none";
                writeClassInfo(record.講義名称);
                showRelatedGraph(record.講義名称);
            });
            searchResults.appendChild(item);
        });
        searchResults.style.display = "block";
    });

    document.addEventListener("click", function (e) {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.style.display = "none";
        }
    });
}

// ================================================================
// 年度データの読み込みと画面更新
// ================================================================
async function loadYear(year) {
    // データ読み込み
    SyllabusArray = deduplicateByName(await loadCsv(syllabusCsvPath(year)));
    relationArray = await loadCsv(relationCsvPath(year));

    // グラフデータ構築
    nodesAllGlobal = convSyllabusArray2Nodes(SyllabusArray);
    edgesGlobal = convRelationArray2Edges(relationArray);

    // グラフ描画
    displayGraph();

    // 講義プルダウンを再構築
    const selectElement = document.getElementById("classSelect");
    // 既存オプションをクリア（最初の placeholder 以外）
    while (selectElement.options.length > 1) {
        selectElement.remove(1);
    }
    SyllabusArray.forEach(record => {
        const option = document.createElement("option");
        option.text = record.科目コード + " " + record.講義名称;
        option.value = record.講義名称;
        selectElement.appendChild(option);
    });

    // 講義情報をリセット
    document.getElementById("className").innerText = "（講義をクリック）";
    document.getElementById("classCode").innerText = "";
    document.getElementById("regulationSubjectName").innerText = "";
    document.getElementById("campus").innerText = "";
    document.getElementById("instructor").innerText = "";
    document.getElementById("subjectGroup").innerText = "";
    document.getElementById("subjectCode").innerText = "";
    document.getElementById("language").innerText = "";
    document.getElementById("term").innerText = "";
    document.getElementById("syllabusUrl").href = "#";
}

// ================================================================
// 初期化
// ================================================================
document.addEventListener('DOMContentLoaded', async () => {
    // 年度セレクターを構築
    const yearSelect = document.getElementById("yearSelect");
    AVAILABLE_YEARS.forEach(year => {
        const option = document.createElement("option");
        option.value = year;
        option.text = year + "年度";
        if (year === DEFAULT_YEAR) option.selected = true;
        yearSelect.appendChild(option);
    });

    // 初期データ読み込み
    await loadYear(DEFAULT_YEAR);

    // 凡例を生成
    buildNodeLegend();

    // 検索機能を初期化
    setupSearch();

    // --- イベントリスナー ---

    // 年度変更
    yearSelect.addEventListener("change", async function () {
        await loadYear(parseInt(this.value, 10));
    });

    // 講義選択
    document.getElementById("classSelect").addEventListener("change", function () {
        if (!this.value) return;
        writeClassInfo(this.value);
        showRelatedGraph(this.value);
    });

    // 深さ変更
    document.getElementById("depthSelect").addEventListener("change", function () {
        const currentClass = document.getElementById("className").innerText;
        if (currentClass && currentClass !== "（講義をクリック）") {
            showRelatedGraph(currentClass);
        }
    });

    // 全体表示
    document.getElementById("allGraph").addEventListener("click", () => {
        displayGraph(nodesAllGlobal, edgesGlobal);
    });

    // 連結成分のみ表示
    document.getElementById("connectedGraph").addEventListener("click", displayConnectedGraph);
});
