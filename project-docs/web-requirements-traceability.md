# Web版 仕様→実装→テスト→結果

2026-10-18。ユーザー承認によりGoogleからGitHub Pages＋Sites＋D1＋R2へ構成変更。元のゲーム機能は全て対象に保持。従来の追跡表はGAS基盤の履歴であり、最新のWeb版は本表を参照する。

|対応|実装|検証|現在の結果|
|---|---|---|---|
|T01–03 承認済抽選/不足の明示承認/クラス未使用優先|web/lib/quiz/rules.mjs,engine.mjs、候補確認UI|旧純粋関数テスト＋Webゲーム作成|ローカル成功。学校運用未確認|
|T04–09 正規化/別解/ヒント前後/最終回答/得点|rules.mjs,engine.mjs|既存単体＋Webエンジン|成功|
|T10 requestId再送の冪等性|store.mjs,engine.mjs|実SQLiteで競合再送、Worker HTTPで同じ受理ID返却|ローカル成功|
|T11–12 サーバー締切/ヒント/停止再開延長|engine.mjs、UIタイマー|エンジンで境界/停止/延長、実HTTP締切|ローカル成功|
|T13 同時送信|D1 CAS＋同一batch内の条件付き履歴保存|8班同時、同じIDの並列再送、実Worker/D1 HTTP|ローカル成功。公開負荷未検証|
|T14 代理回答/採点修正/再集計/監査|engine.command, teacher UI|代理回答/理由/再計算/履歴|サーバー成功。UI一連の確認は残る|
|T15 同点同順位/複数優勝|engine.standings、順位UI|8班5問、実HTTPの6班同時優勝|成功|
|T16 教師/生徒/投影権限と情報漏洩|API認可、検証済みID/メール許可リスト、役割別view|教師API未認証403、他班回答/発表前正答・得点の非表示|ローカル成功。Sites本番認証未検証|
|T17 二重参加拒否/端末解除と再割当|join/participant/command.reassign|重複拒否、旧トークン失効、進行中に再参加|エンジン成功|
|T18 再読込/再接続/下書き/送信状態|public/quiz-app.js、state API、localStorage|教師認証・設定・ゲーム作成・受付をブラウザ確認、API再接続|3画面全体のブラウザ通しは未完|
|T19 複数画像/並替/参照保護|Files.attach/remove/read、画像管理UI|型/サイズ、参照中削除拒否、原本と復元ファイルの照合|ローカル成功。実投影画像/全画面は未確認|
|T20 問題登録/編集/複製/検索/承認/取込/出典/類似|engine.mjs,rules.mjs、問題バンクUI、CSV/JSON|一括検証、未確認強制、ID/版、編集・アーカイブ維持|サーバー成功。全UI操作の受入確認は残る|
|T21 年度/クラス/班/過年度保持/共通問題|catalog、年度UI|年度追記、既存ゲームの不変スナップショット|ローカル成功|
|T22 手動/自動バックアップ・復元|files.mjs、MCP、scheduled、管理UI|SQLite＋R2モック、実ローカルWorkerの手動保存/隔離復元|手動・テスト復元成功。定期起動/本番復旧手順は残課題|
|T23 音声/音量/ミュート/スキップ/演出|WebAudio、紙吹雪、opening/ranking操作|コード/サーバー遷移確認|実音声、Chromebook、画面の全操作未確認|
|T24 実績から隔離した8班シミュレーション|isSimulation、tests/engine.test.mjs|8班5問で満点/ヒント後/回答変更/無回答/切断/代理/修正/逆順順位|サーバー通し成功。3画面同時通しは別ゲート|
|T25 プリセット/前回設定/所要時間内訳|teacher設定、estimate|単体＋実ブラウザで入力/内訳更新/候補生成|ローカル成功|
|T26 開始〜逆順順位発表の通し|engine、API、3画面|8班5問エンジン＋実HTTP1問8班がendedまで完走|サーバー成功。3画面を含む完成ゲート未達|
|公開/GitHub|main/docsからGitHub Pages、backend/にソース|GitHub保存、HTTPS200、公開画面と準備中表示をブラウザ確認|画面プレビューのみ公開。Sites送信は承認ポリシーで停止|
|秘密・資料・成績のGit除外|明示的な公開用エクスポート、.gitignore|67ファイルの送信対象検査、.dev.vars/.wrangler/work等を除外|実データ・正答・画像・認証情報を送信していない（試験問題は架空）|
|問題作成Skill|skills/question-generator/SKILL.md（既存）|内容確認、出典/未確認JSONとの取込互換|実教材の生成・教師承認は未実施|
|学校実機|学校用チェックリスト|教師PC/投影/Chromebook/学校ネットワーク|未実施、授業前必須|

## 公開を停止している具体的な条件

Sites公式source helperは起動できるが、認証情報を標準入力で渡すwrite_stdinが `approval required by policy, but ... sandbox_approval is false` と拒否される。フォルダ・Git領域・ネットワークの明示的な権限申請後も同じ拒否。送信は実行されていない。別手段で承認を迂回しない。

Site ID: appgprj_6ad4890539308191982cedcdf5dbd16d。再開時に新しいSiteを作成しない。短期ソース認証情報は期限切れを確認して同じSiteで再発行し、公式手順に従い保存・公開する。

GitHub Pagesのconfig.backendReady=falseを保持し、公開サーバーと認証/CORSを検証してからtrueにする。現時点の画面を授業利用可能とは扱わない。
