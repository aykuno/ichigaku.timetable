# 2026年度 時間割検索（パスワード暗号化）

添付の時間割コードを登録しています（61クラス・教職員173名）。
パスワードで開くと、クラス・教職員の時間割、所属や担当、授業条件検索を利用できます。
クラス名で検索した結果は「クラス時間割 → 担任 → 副担任」の順に表示します。
閲覧用パスワードは管理者のチャットにだけ伝え、このリポジトリやCIには保存しません。
404ページはデータ未登録のまま、入力・閲覧を無効にしています。

## 2画面で比較

通常は1画面です。上部の「2画面で比較」を押すと、PCでは横並び、スマホなど幅760px以下では縦並びになります。
各画面でクラス・教員や授業条件を別々に検索・選択できます。
「1画面に戻す」で通常表示に戻り、再び2画面にすると両方の選択を保持しています。
画面サイズを変えても選択は維持し、ログアウト・再読み込み時は両方を消して1画面に戻ります。

## 追加した仕組み

- 時間割HTML全体をAES-256-GCMで暗号化します。
- 鍵はPBKDF2-HMAC-SHA-256（600,000回）でパスワードから作ります。
- 元のHTMLやパスワードを公開リポジトリに置かず、生成した暗号文を登録します。
- 正しいパスワードでのみ復号し、操作しない状態が30分続くと表示を消します。
- パスワード・平文データをlocalStorage、sessionStorage、Cookieに保存しません。
- 復号したHTMLはsandbox iframe内で実行し、外部通信をCSPで制限します。

## 検索結果への掲載を避ける設定

index.html、404.html、生成テンプレートに次のタグを設定しています。

    <meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
    <meta name="googlebot" content="noindex,nofollow,nosnippet">

robots.txtによるクロール拒否は併用していません。
Googleにnoindexを読み取ってもらう必要があるためです。
GitHub Pagesのプロジェクトサイトでは、サブディレクトリのrobots.txtはサイト全体の制御にもなりません。

noindexは、対応する検索エンジンに掲載しないよう指示する設定です。
URLを秘密にする機能でも、アクセス制限でもありません。
リポジトリ自体は現在publicです。GitHub上のリポジトリの検索掲載はこのタグでは制御できません。
時間割の中身は別途パスワード暗号化で保護します。
正規の閲覧者によるコピー・転送は防げません。
暗号文へのオフラインのパスワード推測や、保存済みの過去の暗号文を失効させることにも対応できません。

## 公開

この変更ではPagesを有効化する操作はしていません。
公開する場合はSettings → Pagesを開き、以下を選びます。

- Source: Deploy from a branch
- Branch: main
- Folder: / (root)

## 後でデータを登録する場合

Node.js 22以上で、管理者のPCから実行します。
元のコードはGitの対象外であるprivate/timetable.txtに保存します。

    node tools/build.mjs private/timetable.txt

暗号化済みindex.html、index.txtと、準備中のままの404.htmlを生成します。
新しいパスワードはローカル端末に表示します。公開ログやコミットに記録しないでください。
パスワードを指定する場合はTIMETABLE_PASSWORD環境変数へ24文字以上の長い値を設定します。
未指定時は暗号学的乱数から32文字のパスワードを生成します。
CI上で実行しようとすると、秘密情報を公開ログへ出さないため停止します。

## コードと検証

index.txtはindex.htmlと同じ内容の、コード保存用のファイルです。
HTMLのプレビューは不要です。

    npm install --ignore-scripts --no-audit --no-fund
    npm test
    npx playwright install --with-deps chromium webkit
    npm run test:browser
    npm run test:timetable

検証には架空のテストデータだけを使います。

## 公式資料

- https://developers.google.com/search/docs/crawling-indexing/block-indexing
- https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt
