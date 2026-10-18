# 社会科ナゾトキ教室 — Web版

Googleを使わずに、班で社会科の謎解きをするWebアプリ。GitHub Pagesに入口・生徒・投影画面、Sitesに教師画面とサーバーを配置します。D1に問題/ゲーム/回答履歴、R2に非公開の資料/画像/バックアップを保存します。

## 起動・検証

Node.js 22.13以上。公式Sitesヘルパーで依存取得・ビルド・公開します。

```sh
npm run db:generate  # スキーマを変更したときだけ
node --test tests/*.test.mjs
npm run build
npm run dev
```

- `app/api/quiz/route.ts`: 認可、CORS、レート制限、API入口
- `app/mcp/route.ts`: 所有者専用のバックアップ確認/期限チェック
- `lib/quiz/`: 永続化、ゲーム、採点、ファイルと復元
- `public/`: GitHub Pagesにも使う画面（正答データは含まない）
- `db/`, `drizzle/`: 版管理するスキーマとマイグレーション
- `tests/`: 架空データだけのSQLite/R2テスト

## サーバー設定

秘密値をファイルやGitHubへ保存せず、Sitesのruntime設定で指定します。

- `QUIZ_TEACHER_IDS` / `QUIZ_TEACHER_EMAILS`: Sitesが確認した教師の本人情報の許可リスト。空の場合は拒否。
- `QUIZ_ALLOWED_ORIGIN`: 生徒・投影を公開するGitHub Pagesのorigin。
- `.openai/hosting.json`のDB/BUCKETは論理バインディング。実データはリポジトリ外。

ローカル`.dev.vars`は検証用のみでGit除外します。本番はSites側の認証を使います。ローカルの認証モックを本番へ転用しません。

## 授業の流れ

先生画面 → 年度/クラス登録 → 問題登録/承認 → ゲーム設定/候補確認 → 受付 → 生徒がコードと班を選択 → 開始 → 締切 → 正解/段階解説 → 次問 → 逆順順位 → 振返り。

問題は生成/取込/編集/複製/画像変更の後に未確認となります。教師が正答の一意性・出典・画像の利用条件を確認してから承認します。教材・正答・実記録はGitHubへコミットしません。

手動バックアップと隔離したテスト復元に対応します。自動バックアップの定期起動、学校実機、公開環境の同時負荷は個別の検証が必要です。未検証項目は完成扱いにしません。
