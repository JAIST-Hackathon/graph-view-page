#!/usr/bin/env python3
"""
シラバスCSVから講義間の関係を抽出して class_relation.csv を生成する。

使い方:
    python generate_relations.py [--year 2025] [--campus ishikawa]

入力:
    data/{year}/jaist_syllabus_{campus}_{year}.csv

出力:
    data/{year}/class_relation.csv

LLM不要 — 正規表現とルールベースで科目コードを検出し、
周辺テキストのキーワードから関係の種類を分類する。
"""

import argparse
import csv
import os
import re
import sys


# ================================================================
# 科目コードの正規表現
# ================================================================
# I226, M414, K228, I465S, K236EJ, M285E, N003, G211, S101 など
CODE_RE = re.compile(r"[A-Z]\d{3}[A-Z]{0,2}\d?")


# ================================================================
# 関係分類キーワード（優先度順に判定）
# ================================================================

# exclusive: 「履修不可」
EXCLUSIVE_KEYWORDS = [
    "履修不可",
    "履修できない",
    "cannot register",
    "cannot take",
    "cannot enroll",
]

# required: 「単位を修得していること」「履修済み」「必須」
REQUIRED_KEYWORDS = [
    "単位を修得していること",
    "単位修得済み",
    "修得済み",
    "を履修済み",
    "履修していること",
    "を修了",
    "いずれか1科目以上の単位",
    "is required to take",
    "must have",
    "are required",
    "have already earned",
    "継続しての履修を必要とする",
]

# prerequisite: 「知識を前提」「理解を前提」「知識が必要」
PREREQUISITE_KEYWORDS = [
    "知識を前提",
    "前提とする",
    "理解を前提",
    "内容を修得している",
    "の知識が必要",
    "基礎知識を有する",
    "相当する知識を有する",
    "相当の知識",
    "knowledge is required",
    "knowledge of",
    "is prerequisite",
    "or equivalent",
    "are expected",
    "を基礎とする",
    "レベルを基礎とする",
]

# recommended: 「望ましい」「望まれる」「勧める」
RECOMMENDED_KEYWORDS = [
    "望ましい",
    "望まれる",
    "ことが望まれ",
    "が望まし",
    "を薦める",
    "を勧める",
    "履修を薦める",
    "履修することが望",
    "is recommended",
    "is preferred",
    "is desirable",
    "is helpful",
    "it is recommended",
    "should have",
]


# ================================================================
# ヘルパー関数
# ================================================================


def load_syllabus(csv_path):
    """シラバスCSVを読み込み、リストとして返す"""
    with open(csv_path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def build_code_to_names(syllabus):
    """
    科目コード → 講義名称リスト のマッピングを構築。
    同一コードに複数講義（JP版とE版）がある場合はリストで保持する。
    """
    mapping = {}
    for row in syllabus:
        code = row.get("科目コード", "").strip()
        name = row.get("講義名称", "").strip()
        if code and name:
            mapping.setdefault(code, []).append(name)
    return mapping


def build_name_set(syllabus):
    """全講義名称の集合を構築"""
    return {row["講義名称"].strip() for row in syllabus if row.get("講義名称")}


def extract_codes_from_text(text):
    """テキストから科目コードを抽出"""
    return CODE_RE.findall(text)


def extract_names_from_text(text, all_names):
    """
    テキストから講義名称を直接マッチで探す。
    科目コードが付いていない場合（例: 異分野「超」体験セッションⅠ）用。
    長い名前から先にマッチさせて部分一致を防ぐ。
    """
    found = []
    for name in sorted(all_names, key=len, reverse=True):
        if name in text:
            found.append(name)
    return found


def classify_relation(text, course_code, course_name):
    """
    テキストとその中の科目参照から関係の種類を判定する。
    科目コードまたは科目名の周辺テキスト（前後80文字）を見てキーワード判定。
    """
    # 科目コードまたは科目名の位置を探す
    search_terms = [course_code] if course_code else []
    if course_name:
        search_terms.append(course_name)

    # 周辺テキストを抽出（前後80文字）
    context = text  # フォールバック
    for term in search_terms:
        idx = text.find(term)
        if idx >= 0:
            start = max(0, idx - 80)
            end = min(len(text), idx + len(term) + 80)
            context = text[start:end]
            break

    # 優先度順に判定
    context_lower = context.lower()

    for kw in EXCLUSIVE_KEYWORDS:
        if kw.lower() in context_lower:
            return "exclusive"

    for kw in REQUIRED_KEYWORDS:
        if kw.lower() in context_lower:
            return "required"

    for kw in PREREQUISITE_KEYWORDS:
        if kw.lower() in context_lower:
            return "prerequisite"

    for kw in RECOMMENDED_KEYWORDS:
        if kw.lower() in context_lower:
            return "recommended"

    return "related"


def is_skip_text(text):
    """スキップすべきテキストか判定"""
    skip_values = {"なし", "特になし", "無し", "None", "", "令和8年度開講予定"}
    return text.strip() in skip_values


def resolve_names(code, code_to_names, source_name):
    """
    科目コードから講義名称を解決する。
    自分自身は除外。(E)/(EJ)版は元の日本語版が存在すればそちらを優先。
    """
    names = code_to_names.get(code, [])
    # 自分自身を除外
    names = [n for n in names if n != source_name]
    if not names:
        return []

    # (E)/(EJ) でない版があればそちらを優先
    jp_names = [n for n in names if not re.search(r"\(E\)|\(EJ\)|\(J/E\)|\(E/J\)", n)]
    if jp_names:
        return jp_names

    return names


# ================================================================
# メイン処理
# ================================================================


def extract_relations(syllabus):
    """
    全講義から関係を抽出する。
    戻り値: [(source, target, label), ...]
    """
    code_to_names = build_code_to_names(syllabus)
    all_names = build_name_set(syllabus)
    relations = []
    skipped_codes = set()

    for row in syllabus:
        source = row["講義名称"].strip()
        kanren = row.get("関連科目", "")
        jouken = row.get("履修条件", "")

        # (E)/(EJ) 版はスキップ（JP版で同じ関係が抽出されるため重複回避）
        if re.search(r"\(E\)$|\(EJ\)$|\(J/E\)$|\(E/J\)$", source):
            continue

        # 両フィールドの処理
        for field_text, field_name in [(kanren, "関連科目"), (jouken, "履修条件")]:
            if is_skip_text(field_text):
                continue

            # (1) テキスト中の科目コードを抽出
            codes_found = extract_codes_from_text(field_text)
            referenced_targets = []  # [(target_name, code, field_text)]

            for code in codes_found:
                target_names = resolve_names(code, code_to_names, source)
                if target_names:
                    for t in target_names:
                        referenced_targets.append((t, code, field_text))
                else:
                    # マッピングにないコード（他領域など）はスキップ記録
                    skipped_codes.add(code)

            # (2) 科目コードなしで講義名称だけ出現する場合を補完
            names_found = extract_names_from_text(field_text, all_names)
            already_found = {t[0] for t in referenced_targets}
            for name in names_found:
                if name != source and name not in already_found:
                    # (E)版の名前マッチはスキップ
                    if re.search(r"\(E\)$|\(EJ\)$", name):
                        continue
                    referenced_targets.append((name, "", field_text))

            # (3) 各参照について関係を分類
            for target_name, code, text in referenced_targets:
                label = classify_relation(text, code, target_name)

                # 履修条件フィールドのデフォルトは prerequisite（関連科目は related）
                if label == "related" and field_name == "履修条件":
                    label = "prerequisite"

                # CSV の source/target は履修順序に合わせる:
                #   source = 前提講義（先に取る）, target = 当該講義（後に取る）
                # ここでの source（シラバス解析元）は「後に取る側」なので反転
                if label in ("required", "prerequisite", "recommended"):
                    relations.append((target_name, source, label))
                else:
                    # related / exclusive は方向性なし（アルファベット順で統一）
                    a, b = sorted([source, target_name])
                    relations.append((a, b, label))

    # 重複を除去（同一の source-target-label は1つだけ）
    relations = list(dict.fromkeys(relations))

    # 同じ source-target で label が異なる場合、より強い方を残す
    # 優先度: exclusive > required > prerequisite > recommended > related
    priority = {"exclusive": 5, "required": 4, "prerequisite": 3, "recommended": 2, "related": 1}
    best = {}
    for src, tgt, label in relations:
        key = (src, tgt)
        if key not in best or priority.get(label, 0) > priority.get(best[key], 0):
            best[key] = label

    final = [(src, tgt, label) for (src, tgt), label in best.items()]
    final.sort(key=lambda x: (x[0], x[1]))

    if skipped_codes:
        print(f"\n[情報] マッピングにない科目コード（他分野等）: {', '.join(sorted(skipped_codes))}")

    return final


def save_relations(relations, output_path):
    """class_relation.csv に出力する"""
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["source", "target", "label"])
        for src, tgt, label in relations:
            writer.writerow([src, tgt, label])


def print_summary(relations):
    """結果サマリーを表示"""
    from collections import Counter
    label_counts = Counter(label for _, _, label in relations)
    print("\n=== 抽出結果 ===")
    print(f"合計: {len(relations)} 件の関係")
    for label in ["required", "prerequisite", "recommended", "related", "exclusive"]:
        count = label_counts.get(label, 0)
        if count:
            print(f"  {label}: {count} 件")


def main():
    parser = argparse.ArgumentParser(
        description="シラバスCSVから講義間の関係を抽出する"
    )
    parser.add_argument(
        "--year", type=int, default=2025,
        help="年度 (default: 2025)"
    )
    parser.add_argument(
        "--campus", type=str, default="ishikawa",
        help="キャンパス名 (default: ishikawa)"
    )
    args = parser.parse_args()

    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(project_dir, "data", str(args.year))
    csv_filename = f"jaist_syllabus_{args.campus}_{args.year}.csv"
    csv_path = os.path.join(data_dir, csv_filename)

    if not os.path.exists(csv_path):
        print(f"エラー: {csv_path} が見つかりません。")
        print(f"先に scrape_syllabus.py を実行してください。")
        sys.exit(1)

    print(f"入力: {csv_path}")

    syllabus = load_syllabus(csv_path)
    print(f"講義数: {len(syllabus)} 件")

    relations = extract_relations(syllabus)
    print_summary(relations)

    output_path = os.path.join(data_dir, "class_relation.csv")
    save_relations(relations, output_path)
    print(f"\n出力: {output_path}")


if __name__ == "__main__":
    main()
