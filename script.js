// シラバス（URL,講義名,講義IDなど）のCSVパス
const syllabusCsvFilePath = 'jaist_syllabus_cs_ishikawa_2025.csv'
// 講義間の関係は
const relationCsvFilePath = 'class_relation.csv';

// HTML要素の参照を取得
// const csvContainer = document.getElementById('csv-container');
const loadingMessage = document.getElementById('loadingMessage');

// グローバルのノード，エッジ，ネットワーク
// これをグラフ表示に使う
let nodesAllGlobal, nodesGlobal;
let edgesGlobal;
let network;

// エッジスタイル
function edge_styles(edge) {
    // 元の受講に先の受講が「関連がある」
    if (edge.label == "related") {
        return {
            from: edge.source,
            to: edge.target,
            arrows: { to: { scaleFactor: 2 } },
            label: "related"
        };
    }
    // 元の受講には先の受講が「望ましい・理解が深まる」
    else if (edge.label == "recommended") {
        return {
            from: edge.source,
            to: edge.target,
            arrows: "to",
            label: "recommended",
            //dashes: true,
        };
    }
    // 元の受講には先の知識が「求められる（履修済みの必要はない）」
    else if (edge.label == "equivalent") {
        return {
            from: edge.source,
            to: edge.target,
            arrows: "to",
            label: "equivalent",
            color: { color: "#FF0000" },
        };
    }
    // 元の受講には先の受講が「必須」
    else if (edge.label == "required") {
        return {
            from: edge.source,
            to: edge.target,
            arrows: "to",
            label: "required",
            color: { color: "#FF0000" },
            value: 2,
            endPointOffset: { from: 5 },
        };
    }
    // 元の受講は先を受講していると「履修不可」
    else if (edge.label == "exclusive") {
        return {
            from: edge.source,
            to: edge.target,
            arrows: "from",
            color: { color: "#FF00FF" },
            label: "exclusive",
            value: 2,
        };
    }
    // その他の関係
    else {
        return {
            from: edge.source,
            to: edge.target,
            arrows: "to",
            label: edge.label
        };
    }
}

async function loadAndDisplayCsv(csvFilePath) {
    try {
        loadingMessage.style.display = 'block';
        // csvContainer.innerHTML = '';

        const response = await fetch(csvFilePath);
        if (!response.ok) {
            throw new Error(`HTTPエラー: ${response.status} ${response.statusText}`);
        }

        const csvText = await response.text();

        return new Promise((resolve, reject) => {
            Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                complete: function (results) {
                    loadingMessage.style.display = 'none';
                    console.log("CSV読み込み完了", results.data);
                    resolve(results.data);  // <-- パース結果を返す
                },
                error: function (err) {
                    reject(new Error(`CSV解析エラー: ${err.message}`));
                }
            });
        });
    } catch (error) {
        console.error("致命的エラー:", error);
        loadingMessage.style.display = 'none';
        // csvContainer.innerHTML = `<p class="error-message">読み込み失敗: ${error.message}</p>`;
        return [];
    }
}

// シラバスのCSVを読み込んで得られるArrayをvis.DataSetに変換
function convSyllabusArray2Nodes(ary) {
    const nodes = ary.map(node => {
        return {
            id: node.講義名称,
            label: node.講義名称,
        };
    });
    return new vis.DataSet(nodes);
}

function convRelationArray2Edges(ary) {
    const edges = ary.map(edge => {
        return edge_styles(edge);
    });
    return new vis.DataSet(edges);
}

// 指定の講義名称のデータを表示
function writeClassInfo(className) {
    // シラバスデータから対応する講義のデータを抽出
    const record = SyllabusArray.find(row => row.講義名称 === className);

    // HTMLの表の対応要素に値を書き込み
    document.getElementById("className").innerText = className;
    document.getElementById("classCode").innerText = record.講義コード;
    document.getElementById("className").innerText = record.講義名称;
    document.getElementById("regulationSubjectName").innerText = record.学則科目名称;
    document.getElementById("campus").innerText = record.校地;
    document.getElementById("instructor").innerText = record.代表教員;
    document.getElementById("subjectGroup").innerText = record.科目群;
    document.getElementById("subjectCode").innerText = record.科目コード;
    document.getElementById("language").innerText = record.授業実践言語;
    document.getElementById("term").innerText = record.開講時期;
    document.getElementById("syllabusUrl").href = record.URL;
    // document.getElementById("syllabusUrl").innerText = `<a href="${record.URL}">${className}</a>`;
    // console.log(
    //     "click event, getNodeAt returns: " +
    //     this.getNodeAt(params.pointer.DOM)
    // );
}

// nodesとedges（どちらもvis.DataSet型）を入力にvis.Networkを生成（＝グラフ描画）
function displayGraph(nodes = nodesAllGlobal, edges = edgesGlobal) {
    let container = document.getElementById("network");
    let data = {
        nodes: nodes,
        edges: edges,
    };
    let options = {
        interaction: {
            navigationButtons: true, keyboard: true,
        },
        nodes: {
            shape: "box",
        },
        "physics": {
            "barnesHut": {
                "springLength": 260
            },
            "minVelocity": 0.75
        }

    };
    network = new vis.Network(container, data, options);

    // ネットワークにイベントリスナーを設定
    network.on("click", function (params) {
        // params.event = "[original event]";
        // 授業をクリックした場合のみ更新
        if (this.getNodeAt(params.pointer.DOM) == undefined) { return; }
        // クリックした講義のシラバス情報を表示
        writeClassInfo(this.getNodeAt(params.pointer.DOM));
    });
    network.on("doubleClick", function (params) {
        // params.event = "[original event]";
        // 授業をクリックした場合のみ更新
        if (this.getNodeAt(params.pointer.DOM) == undefined) { return; }
        // クリックした講義のシラバス情報を表示
        writeClassInfo(this.getNodeAt(params.pointer.DOM));
        // その講義が連結したグラフのみ表示
        let connectedNodesToNode = getConnectedNodesToNode(this.getNodeAt(params.pointer.DOM));
        console.log(connectedNodesToNode);
        displayGraph(connectedNodesToNode, edgesGlobal);
    });
}

// 接続関係のArrayに含まれているノードを抽出
function getConnectedNodes() {
    // source と target を両方まとめて抽出し、Setで重複除去
    let nodes = Array.from(new Set(
        relationArray.flatMap(edge => [edge.source, edge.target])
    ));

    nodes = nodes.map(node => {
        return {
            id: node,
            label: node,
            vale: 70,
        };
    });
    return new vis.DataSet(nodes);
}

// 2個以上のノードが連結している部分のグラフだけ表示
function displayConnectedGraph() {
    //alert("hello");
    displayGraph(getConnectedNodes(), edgesGlobal);
}

// 指定した講義に関連のある講義
// （＝指定した講義がエッジでソースかターゲットになっているときの相方）を抽出
function getConnectedNodesToNode(className) {
    const relatedClassSet = new Set(); // 重複回避
    relatedClassSet.add(className); // 自分自身は必ず入れる（表示する）

    // classNameがsourceかtargetに含まれれる場合，
    // sourceとtargetの両方をsetに追加
    relationArray.forEach(edge => {
        if (edge.source === className || edge.target === className) {
            relatedClassSet.add(edge.source);
            relatedClassSet.add(edge.target);
        }
    });

    console.log(relatedClassSet);

    // Set を Array に変換し、vis.js のノード形式に変換
    const relatedLecturesArray = Array.from(relatedClassSet);
    return nodes = relatedLecturesArray.map(className => ({
        id: className,
        label: className,
    }));

}

// 読み込まれたら実行
document.addEventListener('DOMContentLoaded', async () => {
    SyllabusArray = await loadAndDisplayCsv(syllabusCsvFilePath);
    relationArray = await loadAndDisplayCsv(relationCsvFilePath);

    // 初期設定としてシラバスの全授業をノードして登録
    nodesAllGlobal = convSyllabusArray2Nodes(SyllabusArray);
    edgesGlobal = convRelationArray2Edges(relationArray);

    // 整形したデータを使って初期描画
    displayGraph();

    // 講義選択用プルダウンを追加
    const selectElement = document.getElementById("classSlect");
    SyllabusArray.forEach(record => {
        const option = document.createElement("option");
        option.text = record.科目コード + " " + record.講義名称;
        option.value = record.講義名称; // 値として講義コードを使用（必要に応じて変更）
        selectElement.appendChild(option);
    });
    selectElement.addEventListener("change", function () {
        // 選択されたoptionのvalue（講義コード）
        const selectedClassName = this.value;
        // 講義に関連している講義を抽出
        let connectedNodesToNode = getConnectedNodesToNode(selectedClassName);
        console.log(connectedNodesToNode);
        // 上のノードをもとに情報とグラフの表示
        writeClassInfo(selectedClassName);
        displayGraph(connectedNodesToNode, edgesGlobal);
    });

    // 全体グラフを表示するボタンにイベントリスナーを設定
    const connectedGraphBtn = document.getElementById("allGraph");
    connectedGraphBtn.addEventListener("click", () => {
        displayGraph(nodesAllGlobal, edgesGlobal);
    });

    // 連結成分を表示するボタンにイベントリスナーを設定
    const allGraphBtn = document.getElementById("connectedGraph");
    allGraphBtn.addEventListener("click", displayConnectedGraph);
});

