# 社会科ナゾトキ教室

班で協力する中学校社会科のクイズアプリです。Googleサービスは使いません。

- 公開URL: https://masa0705u-wq.github.io/social-studies-quiz/
- 教師画面（サーバー公開処理待ち）: https://shakai-nazotoki-quiz.handycomet2.chatgpt.site/teacher
- docs/: GitHub Pagesで配信する入口・生徒・投影画面
- backend/: Sitesのサーバーと非公開D1/R2へ接続するソース。実データを含みません。

GitHub Pagesはmainブランチの/docsを指定します。HTML/CSS/JavaScriptのみを公開し、問題の正答、教材、画像、成績、認証情報は保存しません。

教師画面で年度/クラスを登録し、問題を作成またはJSON/CSVで取り込み、教師が承認してから出題します。

ローカル自動テストはbackendで `node --test tests/*.test.mjs`。学校Chromebookの接続、公開基盤の同時負荷、自動バックアップの定期起動は別途確認が必要です。

現在は画面プレビュー公開段階です。サーバーのソース送信がCodexの実行承認ポリシーに拒否されたため、ゲームのオンライン利用はまだできません。公開処理完了後、docs/config.jsonのbackendReadyをtrueへ更新します。
