# 講義依存関係グラフ

大学のシラバス情報から講義同士の依存関係をグラフで可視化し、どの順序で受講すべきか・どの講義を事前に受けておくべきかをわかりやすくするツールです。

## ディレクトリ構造

```
graph-view/
├── index.html              # メインページ
├── css/
│   └── style.css           # スタイルシート
├── js/
│   └── script.js           # フロントエンド（vis-network）
├── data/
│   └── {year}/             # 年度ごとのデータ
│       ├── jaist_syllabus_{campus}_{year}.csv  # シラバス一覧
│       └── class_relation.csv                  # 講義間の関係
├── scripts/
│   ├── scrape_syllabus.py    # シラバスのスクレイピング
│   └── generate_relations.py # 関係データの自動生成
└── readme.md
```

## データ更新の手順

### 1. 環境準備

```bash
pip install requests beautifulsoup4
```

### 2. シラバスのスクレイピング

JAISTのシラバス検索ページから講義情報を取得し、CSVに出力します。

```bash
# 石川キャンパス 2025年度（詳細ページも取得）
python scripts/scrape_syllabus.py --year 2025 --campus 10

# 石川キャンパス 2026年度
python scripts/scrape_syllabus.py --year 2026 --campus 10

# 詳細ページをスキップ（高速だが関連科目・履修条件なし）
python scripts/scrape_syllabus.py --year 2025 --campus 10 --skip-details
```

**出力:** `data/{year}/jaist_syllabus_{campus}_{year}.csv`

| オプション | 値 | 説明 |
|---|---|---|
| `--year` | 2025 | 開講年度 |
| `--campus` | `0000`=全て, `10`=石川, `20`=東京 | 校地 |
| `--skip-details` | | 詳細ページ取得をスキップ |

サーバー負荷を考慮し、リクエスト間隔は自動で1.5〜2秒空けます。

### 3. 講義間の関係を自動生成

スクレイピングで取得した「関連科目」「履修条件」のテキストを正規表現で解析し、講義間の関係を抽出します。

```bash
python scripts/generate_relations.py --year 2025 --campus ishikawa
```

**出力:** `data/{year}/class_relation.csv`

LLM不要で動作します。科目コードの正規表現マッチングと、周辺テキストのキーワード判定で関係の種類を分類します。

### 4. フロントエンドへの反映

`js/script.js` 冒頭のCSVパスを更新します。

```javascript
const syllabusCsvFilePath = 'data/2025/jaist_syllabus_ishikawa_2025.csv'
const relationCsvFilePath = 'data/2025/class_relation.csv';
```

`index.html` をブラウザで開けばグラフが表示されます。

## 講義間の関係（エッジ）

矢印は履修順序を表します（矢印の元を先に取る → 矢印の先を後に取る）。

| label | 意味 | 表示 |
|---|---|---|
| `required` | 履修が必須 | 赤太線 → |
| `prerequisite` | 知識が前提（履修は必須でない） | 赤線 → |
| `recommended` | 先に受講すると理解が深まる | 青線 → |
| `related` | 関連がある（順序なし） | 灰色破線 |
| `exclusive` | 排他（両方は取れない） | 紫太線 |

## ノードの色（開講時期）

| 色 | 時期 |
|---|---|
| 緑 | 1の1期 |
| 青 | 1の2期 |
| 橙 | 2の1期 |
| 紫 | 2の2期 |
| 深橙 | 夏期集中 |
| 水色 | 冬期集中 |
| 黄 | 通年 |
| 灰 | 非開講 |

## 機能

- **全体を表示**: 全講義をグラフ表示
- **連結部分のみ表示**: 他の講義と関係がある講義だけ表示
- **講義検索**: 講義名・科目コード・教員名でインクリメンタル検索
- **プルダウン選択**: 講義を選択して関連グラフを表示
- **関連の深さ**: 1段階〜3段階、または全連結を選択可能
- **クリック**: 講義の詳細情報を表示
- **ダブルクリック**: その講義の関連グラフに切り替え
