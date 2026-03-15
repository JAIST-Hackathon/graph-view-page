#!/usr/bin/env python3
"""
JAISTシラバス スクレイピングスクリプト

使い方:
    python scrape_syllabus.py [--year 2025] [--campus 10]

必要なライブラリ:
    pip install requests beautifulsoup4

出力:
    data/{year}/jaist_syllabus_{campus}_{year}.csv   -- シラバス一覧
"""

import argparse
import csv
import os
import re
import sys
import time

import requests
from bs4 import BeautifulSoup

# ================================================================
# 設定
# ================================================================

BASE_URL = "https://syllabus.jaist.ac.jp"
SEARCH_URL = (
    f"{BASE_URL}/public/web/Syllabus/"
    "WebSyllabusKensaku/UI/WSL_SyllabusKensaku.aspx"
)
DETAIL_BASE = (
    f"{BASE_URL}/public/web/Syllabus/"
    "WebSyllabusSansho/UI/WSL_SyllabusSansho.aspx"
)

# リクエスト間隔（秒） — サーバー負荷を考慮
SEARCH_DELAY = 2.0       # 検索・ページ遷移間
DETAIL_DELAY = 1.5        # 詳細ページ間
YEAR_CHANGE_DELAY = 2.0   # 年度変更PostBack後

CAMPUS_NAMES = {"0000": "all", "10": "ishikawa", "20": "tokyo"}

# ================================================================
# ASP.NET ヘルパー
# ================================================================


def get_hidden_fields(soup):
    """ASP.NET の hidden field を辞書で返す"""
    names = [
        "__VIEWSTATE",
        "__VIEWSTATEGENERATOR",
        "__VIEWSTATEENCRYPTED",
        "__EVENTVALIDATION",
        "__EVENTTARGET",
        "__EVENTARGUMENT",
    ]
    fields = {}
    for name in names:
        tag = soup.find("input", {"name": name})
        if tag:
            fields[name] = tag.get("value", "")
    return fields


def build_base_form(hidden, year, campus):
    """検索フォームの共通フィールドを構築"""
    return {
        **hidden,
        "ddlKaikoNendo": str(year),
        "txtKogiCD": "",
        "txtKyoinName": "",
        "txtKogiName": "",
        "txtGakusokuKamoku": "",
        "ddlYobi": "0000",
        "ddlJigen": "0000",
        "ddlKochi": str(campus),
        "txtKeyword": "",
    }


# ================================================================
# 検索結果パーサー
# ================================================================


def parse_grid_rows(soup):
    """DKogiGrid テーブルからデータ行をパースする"""
    grid = soup.find("table", id="DKogiGrid")
    if not grid:
        return []

    rows = []
    for tr in grid.find_all("tr"):
        tds = tr.find_all("td")
        # データ行は 10 カラム（ボタン + 9項目）
        if len(tds) != 10:
            continue

        btn = tds[0].find("input", {"type": "submit"})
        if not btn:
            continue

        # onclick から詳細ページURLのパラメータを抽出
        onclick = btn.get("onclick", "")
        url_match = re.search(
            r"P1=([^&]+)&P2=([^&]+)&P3=([^'\"&]+)", onclick
        )
        if url_match:
            p1, p2, p3 = url_match.group(1), url_match.group(2), url_match.group(3)
            detail_url = f"{DETAIL_BASE}?P1={p1}&P2={p2}&P3={p3}"
        else:
            detail_url = ""

        row = {
            "URL": detail_url,
            "講義コード": tds[1].get_text(strip=True),
            "講義名称": tds[2].get_text(strip=True),
            "学則科目名称": tds[3].get_text(strip=True),
            "校地": tds[4].get_text(strip=True),
            "代表教員": tds[5].get_text(strip=True),
            "科目群": tds[6].get_text(strip=True),
            "科目コード": tds[7].get_text(strip=True),
            "授業実践言語": tds[8].get_text(strip=True),
            "開講時期": tds[9].get_text(strip=True),
        }
        rows.append(row)

    return rows


def find_next_page_target(soup):
    """「次ページ＞」リンクの __doPostBack ターゲットを返す（なければ None）"""
    grid = soup.find("table", id="DKogiGrid")
    if not grid:
        return None

    for tr in grid.find_all("tr"):
        td = tr.find("td", colspan="10")
        if not td:
            continue
        for a in td.find_all("a"):
            text = a.get_text(strip=True)
            if "次ページ" in text:
                href = a.get("href", "")
                match = re.search(r"__doPostBack\('([^']+)'", href)
                if match:
                    return match.group(1)
        # 最初のページャー行だけ確認すれば十分
        break

    return None


# ================================================================
# 検索結果の取得（全ページ）
# ================================================================


def scrape_search_results(session, year, campus):
    """指定年度・校地の全講義を検索結果から取得する"""
    print(f"[1/3] 検索ページにアクセス中...")

    # (a) GET: 検索ページの初期表示
    resp = session.get(SEARCH_URL)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    time.sleep(YEAR_CHANGE_DELAY)

    # (b) POST: 年度変更（AutoPostBack を再現）
    #     ViewState が年度に依存するため、先に年度を合わせる
    hidden = get_hidden_fields(soup)
    form_data = build_base_form(hidden, year, "0000")
    form_data["__EVENTTARGET"] = "ddlKaikoNendo"
    form_data["__EVENTARGUMENT"] = ""

    print(f"     年度を {year} に変更中...")
    resp = session.post(SEARCH_URL, data=form_data)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    time.sleep(SEARCH_DELAY)

    # (c) POST: 検索実行（btnSearch クリック）
    hidden = get_hidden_fields(soup)
    form_data = build_base_form(hidden, year, campus)
    form_data["__EVENTTARGET"] = ""
    form_data["__EVENTARGUMENT"] = ""
    form_data["btnSearch"] = "以上の条件で検索"

    campus_label = {"0000": "全て", "10": "石川", "20": "東京"}.get(campus, campus)
    print(f"     検索実行中... (年度: {year}, 校地: {campus_label})")
    resp = session.post(SEARCH_URL, data=form_data)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # (d) 全ページを巡回してデータを収集
    all_rows = []
    page = 1

    while True:
        rows = parse_grid_rows(soup)
        all_rows.extend(rows)
        print(f"     ページ {page}: {len(rows)} 件取得（累計: {len(all_rows)} 件）")

        next_target = find_next_page_target(soup)
        if not next_target:
            break

        time.sleep(SEARCH_DELAY)

        hidden = get_hidden_fields(soup)
        form_data = build_base_form(hidden, year, campus)
        form_data["__EVENTTARGET"] = next_target
        form_data["__EVENTARGUMENT"] = ""

        resp = session.post(SEARCH_URL, data=form_data)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        page += 1

    return all_rows


# ================================================================
# 詳細ページの取得
# ================================================================


def scrape_detail_page(session, url):
    """シラバス詳細ページから関連科目・履修条件を取得する"""
    resp = session.get(url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    detail = {
        "関連科目": "",
        "履修条件": "",
    }

    # 関連科目: ASP.NET内部IDは lblOfficeHour
    tag = soup.find("span", id="lblOfficeHour")
    if tag:
        detail["関連科目"] = tag.get_text(strip=True)

    # 履修条件: ASP.NET内部IDは lblGakuseiMessage
    tag = soup.find("span", id="lblGakuseiMessage")
    if tag:
        detail["履修条件"] = tag.get_text(strip=True)

    return detail


def scrape_all_details(session, rows):
    """全講義の詳細ページを取得して関連科目・履修条件を追加する"""
    total = len(rows)
    est_min = total * DETAIL_DELAY / 60
    print(f"[2/3] 詳細ページを取得中... ({total} 件、約 {est_min:.1f} 分)")

    for i, row in enumerate(rows):
        if not row["URL"]:
            continue
        time.sleep(DETAIL_DELAY)
        try:
            detail = scrape_detail_page(session, row["URL"])
            row.update(detail)
        except Exception as e:
            print(f"     [{i+1}/{total}] エラー: {row['講義名称']} - {e}")
            continue

        # 進捗を10件ごとに表示
        if (i + 1) % 10 == 0 or (i + 1) == total:
            print(f"     [{i+1}/{total}] {row['講義名称']}")


# ================================================================
# CSV出力
# ================================================================


def save_csv(rows, output_path, include_details):
    """CSVファイルに出力する"""
    fieldnames = [
        "URL", "講義コード", "講義名称", "学則科目名称", "校地",
        "代表教員", "科目群", "科目コード", "授業実践言語", "開講時期",
    ]
    if include_details:
        fieldnames += ["関連科目", "履修条件"]

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


# ================================================================
# メイン
# ================================================================


def main():
    parser = argparse.ArgumentParser(
        description="JAISTシラバスをスクレイピングしてCSVに出力する"
    )
    parser.add_argument(
        "--year", type=int, default=2025,
        help="開講年度 (default: 2025)"
    )
    parser.add_argument(
        "--campus", type=str, default="0000",
        choices=["0000", "10", "20"],
        help="校地: 0000=全て, 10=石川, 20=東京 (default: 0000=全て)"
    )
    parser.add_argument(
        "--skip-details", action="store_true",
        help="詳細ページのスクレイピングをスキップ（関連科目・履修条件を取得しない）"
    )
    args = parser.parse_args()

    # 出力先ディレクトリ: data/{year}/
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(project_dir, "data", str(args.year))
    os.makedirs(data_dir, exist_ok=True)

    # セッション作成
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (compatible; JAIST-Syllabus-Scraper/1.0)",
    })

    # ---- 検索結果の取得 ----
    rows = scrape_search_results(session, args.year, args.campus)

    if not rows:
        print("検索結果が 0 件でした。年度や校地の指定を確認してください。")
        sys.exit(1)

    print(f"\n     合計 {len(rows)} 件の講義を取得しました。")

    # ---- 詳細ページの取得（オプション） ----
    if not args.skip_details:
        scrape_all_details(session, rows)

    # ---- CSV 出力 ----
    campus_name = CAMPUS_NAMES.get(args.campus, args.campus)
    csv_filename = f"jaist_syllabus_{campus_name}_{args.year}.csv"
    csv_path = os.path.join(data_dir, csv_filename)

    save_csv(rows, csv_path, include_details=not args.skip_details)
    print(f"\n[3/3] CSVを出力しました: {csv_path}")
    print(f"     {len(rows)} 件のレコードを書き込みました。")


if __name__ == "__main__":
    main()
