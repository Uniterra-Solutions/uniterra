# PRD — #15 / #27 / #28：update 進度契約、Skill Market built-in、單一 surface 啟動

| 欄位       | 值                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 計劃名稱   | `issues-15-27-28`：更新進度與完成指示、Skill Market、單一 surface 啟動                                                                                                                                                                                                                                                                                                                                                                    |
| 日期       | 2026-09-13                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 對應 issue | [#15 Implement Progress and Completion Indicators for the Update Process](https://github.com/Uniterra-Solutions/uniterra/issues/15)（enhancement）／[#27 製作 Skill Market：讓用戶搜尋並一鍵安裝 skill](https://github.com/Uniterra-Solutions/uniterra/issues/27)（enhancement, priority: P1）／[#28 修復 uniterra update 後同時開啟 web UI 與 desktop UI](https://github.com/Uniterra-Solutions/uniterra/issues/28)（bug, priority: P0） |
| 狀態       | **計劃完成，尚未實作**（plan only；本文件所屬的變更集不含任何應用程式碼、測試或既有檔案的修改）                                                                                                                                                                                                                                                                                                                                           |
| 作者       | dsh session（本工作單的唯一執行者）                                                                                                                                                                                                                                                                                                                                                                                                       |
| 來源       | 工作單「為 GitHub issues #15 / #27 / #28 產出計劃文檔（PRD.md + ACCEPTANCE.md）」                                                                                                                                                                                                                                                                                                                                                         |
| 相關文件   | `ISSUE-REFS.md`（issue 逐字引用 + 已查證事實 V-01～V-44 + open questions）、`ACCEPTANCE.md`（逐條 REQ 的屬性測試策略）                                                                                                                                                                                                                                                                                                                    |

**本計劃只到計劃為止。** 這份 PRD 描述「要什麼、行為是什麼、邊界在哪」，不描述「改哪一行」。唯一允許出現的接近實作的內容，是 [§0.2 最小契約邊界](#02-為使本計劃可被-pbt-鎖定所需的最小契約邊界) 列出的**必須存在的純函式/契約邊界**——沒有它們，`ACCEPTANCE.md` 的屬性測試就無處施力。任何 `REQ-*` 的「現況」斷言都可追回 `ISSUE-REFS.md` 的 V-編號；沒有 V-編號支撐的句子不得寫成事實。

## 0.1 決策前提（使用者已拍板，不再詢問）

- **D1** 三個 issue 合成**一份**計劃，路徑 `.plan/13-09-2026/issues-15-27-28/`（`ISSUE-REFS.md` + 本檔 + `ACCEPTANCE.md`）。
- **D2** #15 的需求本體是**兩層**：「CLI 先產出機器可讀的進度事件」＋「desktop 承接並渲染」。不是只有終端輸出，也不是只有 GUI。
- **D3** #27 把「**既有 profile 升級後也要長出 skill market**」列為驗收項（走既有 built-in heal/provision 迴圈），不只全新 profile。
- **D4** 檔名為 `PRD.md`、`ACCEPTANCE.md`（大寫）。
- **D5** 本變更集只產出計劃文檔：不寫任何應用程式碼、不新增測試檔、不改任何既有檔案。

另外三條由本計劃**逕行選定並寫成需求**（工作單要求「選定一個方案並寫成需求，不要留給實作者決定」）：

- **D6（#15 的承接機制）** 更新期間 desktop 已經退出（V-14：Update Now 先 detached spawn updater，再 `app.quit()`），所以「進行中」的 GUI 渲染在單一 app 的前提下不可能存在。本計劃選定：**CLI 產出機器可讀事件到 stdout，並在 desktop 指定的路徑留下一份 append-only 的持久記錄；desktop 於下一次啟動時讀取該記錄、渲染一次結果**。不選「常駐 supervisor」「更新期間的第二個視窗」「Electron IPC」。
- **D7（#27 的 pin 與 divergence）** pin **`QQ-M/dsh-skill-market` 的 `main` @ `8fa51ed574c10f978df85798cc48fbebc8d5d406`**（V-19）；**不 pin tag `v0.1.0`**（指向較舊的 `96cd6909…`，V-20）。divergence 以 repo 既有的 `dsh-shortcuts` **LOCAL PATCH** 形式處理（拿掉指向已移除套件的 `dsh.client.inject` row，記 pending-upstream 與 removal condition）。
- **D8（#28 的立場）** 本計劃**不宣稱**「雙開已修好」，也**不宣稱**「雙開仍存在」：HEAD 上 `startDsh()` 已帶 `--no-open`（V-09）且已有 spawn 斷言（V-10），而 issue 開單日（2026-09-01）早於該 flag 進入程式碼的 commit `6b69fad6`（V-11）。因此成因寫成 **OQ-28-1**（見文末），並在 `REQ-28-4` 明訂「成因未確認前不得宣告達成」。

## 0.2 為使本計劃可被 PBT 鎖定所需的最小契約邊界

> 這一節是本 PRD 唯一允許觸及「程式碼形狀」的地方。它不指定檔案、不指定實作步驟，只指定**必須存在的純函式邊界**；沒有這些邊界，「單調性」「冪等性」「唯一性」這類不變式就無法被屬性測試表達。

| 契約 | 邊界                                                                                                        | 為什麼必須是純函式                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| C1   | **事件編碼**：`stage/status/seq/… → 一行位元組`。時鐘與 run id 由呼叫端注入，編碼器本身不讀時鐘、不讀環境。 | 否則 `PROGRESS-SCHEMA`/`PROGRESS-SEQ` 的生成式輸入無法對照輸出。           |
| C2   | **事件解碼**：`一行位元組 → 事件 \| undefined`。對任何輸入都不得拋出（全函式）。                            | `PROGRESS-TOTAL` 的生成域必須包含損壞與惡意輸入。                          |
| C3   | **進度歸約**：`事件序列 → 更新狀態`。單調、冪等（以 `(run, seq)` 去重）、對任意前綴都是合法狀態。           | `PROGRESS-MONO`/`PROGRESS-IDEMPOTENT` 的被測對象。                         |
| C4   | **結果摘要**：`更新狀態 → 可呈現的結果 \| undefined`。只在存在「未消費的終態」時回傳 payload。              | `PROGRESS-RENDER-ONCE` 的被測對象；Electron 對話框是它的不純外殼。         |
| C5   | **surface 計畫**：`(command, open, dryRun, platform, destination) → 會被啟動的 surface 清單`。              | `SURFACE-UNIQUE`/`SURFACE-NOOPEN` 的被測對象。                             |
| C6   | **skill 安裝目錄解析**：`(home, dshHome, 明確設定) → skill root`。                                          | `SKILLROOT-DEFAULT` 的被測對象；也讓「不得帶入作者路徑」成為可證偽的斷言。 |

## #15 Implement Progress and Completion Indicators for the Update Process

### 現況

- 更新流程的階段計畫在 `packages/uniterra-cli/src/install-logic.ts` 的 `installPlan()`：`update` = `update-cli` → `build-install-app` →（`open` 時）`launch-app`；`--dry-run` 回傳空計畫（V-04）。`update` 的階段由 `packages/uniterra-cli/src/cli.ts` 的 `runInstallPlan()` 逐條執行，`launch-app` 呼叫 `openApp()`（V-05、V-06）。
- 進度回饋目前只有零散的 `process.stdout.write`（`cli.ts` 的 287／299／306／500／513／515／519／534／543／557／575／625／641／673 行附近），**沒有結構化事件、沒有階段狀態、沒有完成/失敗的總結行**（V-08）。
- 子程序輸出被 `run()`（`cli.ts:124`，內部用 `execFile`）**整段緩衝**，只有子程序結束後才回傳 `{ stdout, stderr }`——所以 `pnpm install` 進行的數分鐘內，終端沒有任何輸出可看，desktop 端也無從得知（V-07）。這就是 #15 第 2 節「Opaque Execution」的機械原因。
- desktop 端：更新檢查與提示在 `packages/uniterra-desktop/src/main.ts` 的 `runUniterraStartupUpdateCheck()`（`main.ts:268`，`dialog.showMessageBox` 在 278），`Update Now` 會 detached spawn `updateInvocation()`（`packages/uniterra-updater/src/decision.ts`，預設 `npx --yes @uniterra-solutions/uniterra@latest update`），然後 `app.quit()`（`main.ts:288-309`）。**在這段期間與之後直到重新啟動前，desktop 不存在**（V-14）。
- desktop 既有的「跨執行期留下診斷」先例：`reportStartupFailure` 把錯誤 append 到 `<userData>/startup-error.log`（`main.ts:437-459`）；既有「每 profile 的偏好檔」是 `<DSH_HOME>/profiles/<profile>/.uniterra.json`（V-31）。本計劃選定的持久記錄沿用 `userData` 這個既有概念（D6）。

### 需求

#### REQ-15-1 CLI 產出機器可讀進度事件

- **陳述**：`uniterra setup` 與 `uniterra update` 執行期間，除了現有的人類可讀行之外，必須在 **stdout** 逐行輸出 NDJSON 進度事件；每一行以固定前綴 `@@uniterra ` 起頭，物件鍵集合固定為 `v`/`run`/`seq`/`at`/`event`/`stage`/`status`/`message`（不得多、不得少），其中 `event ∈ {run-start, stage-start, stage-end, run-end}`、`stage ∈ {null, update-cli, build-install-app, launch-app}`、`status` 在 `stage-start`/`run-start` 為 `null`、在 `stage-end` 為 `ok`|`failed`、在 `run-end` 為 `ok`|`failed`|`dry-run`；同一個 run 內 `seq` 從 0 起、每次嚴格加 1。
- **理由**：#15 第 2 節「Users cannot determine the current state of the system (e.g., whether the update is initializing, downloading, installing, or stalled)」，以及第 3.2 節要求「continuous visual feedback」。機器可讀事件是「任何 surface 都能渲染」的唯一前提（D2）。
- **In scope**：事件種類、欄位語意、固定前綴、seq 嚴格遞增、寫到 stdout、run 邊界（一次 CLI 執行 = 一個 run）。
- **Out of scope**：具體渲染（spinner／進度條／百分比）；把 pnpm/electron-builder 的逐行輸出轉成自己的事件；事件頻率上限或節流；把事件寫到檔案以外的通道（見 REQ-15-4）。
- **可測性**：屬性測試 `PROGRESS-SCHEMA`（生成 stage/status/seq/message → 編碼 → 解碼回同一個事件，鍵集合完全相等）與 `PROGRESS-SEQ`（生成任意階段序列 → 輸出的 seq 是 0..n-1 的排列且相鄰差恰為 1）。

#### REQ-15-2 事件與人類可讀輸出共存

- **陳述**：人類可讀行**不得**以 `@@uniterra ` 起頭；事件行不得被人類輸出管線當成一般文字呈現。兩者混在同一 stdout 時，事件序列必須能被完整還原（逐行以前綴完全比對過濾即可），且人類可讀行的序列不得因為事件的存在而改變。
- **理由**：#15 第 3.1/3.3 節的範例是 `[INFO] ...`／`[SUCCESS] ...` 這類人類行，必須與機器事件並存（issue 從未要求取代它們）。
- **In scope**：同一 stream、前綴唯一性、可還原性、人類行不受污染。
- **Out of scope**：分流到 stderr、新增 `--progress-json` 之類的旗標開關（本計劃的決定是：事件**一律存在**，因為 desktop 的承接不能依賴使用者有沒有帶旗標）。
- **可測性**：屬性測試 `PROGRESS-PARTITION`（生成人類行與事件行的任意交錯序列 → 過濾後的事件序列等於原事件序列，且剩下的人類行序列不含任何事件行）。

#### REQ-15-3 非 TTY 與 `NO_COLOR` 下的行為

- **陳述**：事件輸出不得依賴 TTY：在非 TTY（例如被 detached spawn、管線、CI）與 `NO_COLOR=1` 下，事件序列與人類可讀行的語意必須與 TTY 下一致；兩種輸出都不得含任何 ANSI escape（`0x1b`）。
- **理由**：#15 第 4 節的 CLI 呈現建議在 GUI/無人終端情境仍須成立；repo 既有慣例是 `NO_COLOR=1` 讓輸出可解析（`packages/uniterra-desktop/src/dsh-process.ts:136`）。
- **In scope**：無 ANSI、TTY/非 TTY 同構、`NO_COLOR` 不改變事件。
- **Out of scope**：上色、進度條動畫、終端寬度適配。
- **可測性**：屬性測試 `PROGRESS-NOANSI`（生成任意事件序列 → 編碼後位元組中不得出現 `0x1b`；且 TTY／非 TTY、有／無 `NO_COLOR` 四種組合下的位元組完全相同）。

#### REQ-15-4 CLI 留下一份可被承接的持久記錄

- **陳述**：當環境變數 `UNITERRA_UPDATE_PROGRESS_FILE` 有值、且該次 run 不是 `--dry-run` 時，CLI 必須把**與 stdout 相同的事件行**逐行 append 到該路徑（父目錄不存在時建立）；寫入失敗只能警告，不得讓更新失敗、不得改變退出碼、不得中斷事件流。變數未設或為 `--dry-run` 時，**不得**建立任何檔案或目錄。desktop 端在 spawn updater 時把該變數設為 `<userData>/update-progress.ndjson`（沿用既有的 `UNITERRA_UPDATE_*` 環境覆寫慣例）。
- **理由**：D6。desktop 在更新期間已經退出（V-14），唯一能在更新結束後把結果交回使用者的承接點，是 CLI 留下的持久記錄；這也是「desktop 端承接」之所以可能的前提。
- **In scope**：環境變數名稱與語意、append-only、dry-run/未設時的零副作用、寫入失敗 fail-soft、desktop 設定該變數的路徑語意。
- **Out of scope**：常駐 supervisor、IPC、輪詢、更新進行中的即時 GUI、記錄的輪替/壓縮。
- **可測性**：屬性測試 `PROGRESS-SINK`（生成事件序列 → 寫進拋棄式 temp 目錄 → 檔案內容逐行等於 stdout 的事件行；(a) 未設變數與 (b) `--dry-run` 兩種情況下檔案件數為 0）＋ `PROGRESS-SINK-IDEMPOTENT`（同一 run 重複 append 不產生重複 `(run, seq)`）。

#### REQ-15-5 desktop 承接並渲染結果

- **陳述**：desktop 每次 boot 時讀取 `<userData>/update-progress.ndjson`（若存在），以純歸約器還原**最近一次 run 的終態**；若該終態是 `run-end/ok` 或 `run-end/failed` 且尚未被消費，必須**恰好呈現一次**原生結果：成功 → 明確告知更新完成且 app 已重新啟動；失敗 → 指名失敗的 stage 與訊息，並給出可行動的後續指示。呈現後必須標記為已消費（同一次終態不再呈現）。無檔案、檔案不可解析、或沒有未消費的終態時，不得顯示任何東西、不得拋出、不得阻塞 boot。
- **理由**：#15 第 3.3 節「Output a definitive success or failure message upon conclusion of the update process. Include instructions for subsequent user actions if necessary.」＋ D2 的 desktop 層。
- **In scope**：讀取位置的語意、終態判定、恰好呈現一次、fail-soft、成功與失敗兩種結果的內容要求。
- **Out of scope**：更新進行中的即時視窗、把完整 pnpm 日誌搬到 GUI、跨裝置/跨使用者同步。
- **可測性**：屬性測試 `PROGRESS-RENDER-ONCE`（生成任意行序列 → C4 摘要只在存在未消費終態時回傳 payload；對同一狀態連續呼叫兩次，第二次必為 undefined）。真實對話框的呈現屬知覺項，見 `ACCEPTANCE.md` 的（非 PBT）替代證據 A-15-1。

#### REQ-15-6 三個階段的使用者可見語意

- **陳述**：(a) **初始化**：在 update 開始之前，使用者必須看到明確告知（將更新 CLI、重建並重新安裝 app、需要數分鐘、app 會關閉）；(b) **進行中**：每一個實際執行的 stage 的開始與結束，人類可讀輸出中至少各有一行，且必須在該 stage 執行**之前/之後**出現，不得全部延後到最後一次列出；(c) **完成/失敗**：run 結束時必須有恰好一個總結行；失敗行必須指名 stage，成功行必須說明「app 會被（或已被）重新啟動」或提示使用者要執行的動作。
- **理由**：#15 第 3.1／3.2／3.3 節的三個階段（issue 的 `[INFO]`／進行中／`[SUCCESS]` 對應物），以及第 2 節「Risk of Premature Termination」——使用者必須在 `pnpm install` 的數分鐘內持續看到進展（V-07 是目前做不到的原因）。
- **In scope**：三個階段的可觀察保證（行數與時序語意），不規定字面文案。
- **Out of scope**：文案潤飾、排版、顏色、動畫、i18n。
- **可測性**：屬性測試 `PROGRESS-PHASES`（生成任意非空 stage 子序列 → 人類行中每個 stage 恰有一次「開始」與一次「結束」且順序正確；run 尾恰有一個總結行）。終端上的「人眼看到進展」屬知覺項，見 `ACCEPTANCE.md` 的（非 PBT）替代證據 A-15-2。

#### REQ-15-7 既有旗標的行為不得改變

- **陳述**：`--no-open`、`--dry-run`、`--source <dir>`、`--move-source`、`--version`／`-v`、`--help`／`-h` 的既有可觀察行為（命令判定、階段計畫、退出碼、既有人類輸出的語意）不得因為本需求改變。特別是：`--dry-run` 仍然完全不執行任何 stage、**不得有任何檔案副作用**（含 REQ-15-4 的記錄）；`--no-open` 只決定 `launch-app` 是否存在。
- **理由**：#15 只在講「回饋」，不授權改變旗標語意；既有的 `parseArgs`／`installPlan` 已被屬性測試鎖住（V-37）。
- **In scope**：六個既有旗標的語意與零副作用。
- **Out of scope**：新增旗標、改變既有輸出文案、改變 stage 順序。
- **可測性**：既有 `packages/uniterra-cli/test/pbt.test.mts` 的 `PARSE`／`PLAN` 不變式（生成任意旗標組合）＋ `PROGRESS-SINK` 的 dry-run 零副作用分支。

#### REQ-15-8 進度歸約必須單調、冪等、全函式

- **陳述**：給定任意行序列，進度歸約必須滿足：(a) **全函式**——不得拋出，未知事件種類、缺欄位、超長行、非 UTF-8 位元組、外來前綴都只能被忽略或解碼為 undefined；(b) **冪等**——重複出現的 `(run, seq)` 不得改變結果；(c) **單調**——已確認完成的階段不得回到未完成，`seq` 較小的事件不得覆蓋較大的；(d) **前綴封閉**——任意前綴的歸約結果必須是完整序列歸約結果的「較早狀態」，不得跳過尚未觀察到的階段。
- **理由**：這是 REQ-15-5 能被可靠鎖定的前提；也是 #15 第 2 節「不確定系統現在在哪個狀態」的直接反面。
- **In scope**：歸約語意（對應 C3）。
- **Out of scope**：I/O、Electron、時鐘、把狀態持久化成 GUI 狀態。
- **可測性**：屬性測試 `PROGRESS-MONO`、`PROGRESS-IDEMPOTENT`、`PROGRESS-TOTAL`（生成域與反例形狀見 `ACCEPTANCE.md` 的 Property 目錄）。

## #27 製作 Skill Market：讓用戶搜尋並一鍵安裝 skill (vendor QQ-M/dsh-skill-market)

### 現況

- vendored plugin 放在 `vendor/dsh-plugins/`，以 `builtin.ts` 的 `registerBuiltinPlugin({ kind: 'vendor', dir, package })` 宣告，經 `copyBuiltins('vendor')` / `copyBuiltinsStale()` / `ensureBuiltinPlugins()` 的既有迴圈複製進 profile；每個 divergence 記在 `vendor/dsh-plugins/VENDOR.md` 的 pin ledger（V-17、V-42）。
- 現有 3 筆 vendored（`dsh-shortcuts`／`dsh-workflow`／`ego-browser`，V-18），pin ledger 有 4 筆列（含 optional 的 `dsh-deep-whale`，V-17）。
- **既有的 LOCAL PATCH 先例**：`dsh-shortcuts` 的 `dsh.client.inject` 與 `peerDependencies` 中指向 `@deepseek-ai/dsh-client-runtime` 的條目，因為該套件在 pinned 家族被移除而被拿掉，並在 ledger 記 pending-upstream（V-18 的 `dsh-shortcuts` 列）。
- 上游 `QQ-M/dsh-skill-market`：`main` @ `8fa51ed5…`（V-19），tag `v0.1.0` 較舊（V-20），8 個執行期/文件檔案（V-21），`package.json` 宣告 `dsh.bundle.patch`／`dsh.client.inject` 三個套件（V-22），`cordis.patch.yml` 硬寫作者環境路徑（V-23），host 半靜態 import `@deepseek-ai/schemastery`（V-24）。
- dsh 的使用者 skill root 是 `<DSH_HOME>/skills`（`~/.dsh/skills`，V-16）；目前 `~/.dsh/skills` 不存在（V-33）。
- profile 可以安裝額外的執行期依賴，機制是既有的 `PROFILE_RUNTIME_DEPS`（`dsh plugin --profile <p> add <spec>`，V-30）。
- 使用者的真實 profile **已經**裝了第三方 `@michengai/dsh-skills-manager`（V-32）——這不是 uniterra registry 的一員，本計劃不會動它，但它是「兩個 skill 入口」的產品風險（F-4、OQ-27-3）。

### 需求

#### REQ-27-1 vendored 鎖 pin 與 trim 範圍

- **陳述**：`vendor/dsh-plugins/dsh-skill-market/` 必須是 `QQ-M/dsh-skill-market` **`main @ 8fa51ed574c10f978df85798cc48fbebc8d5d406`** 的副本（不採 npm latest、不採 tag `v0.1.0`），只保留執行期與授權/說明檔案（`index.js`、`client.js`、`package.json`、`cordis.patch.yml`、`LICENSE`、`README.md`、`README.zh.md`；上游的 `.gitignore` 不帶入），且該目錄必須能追出處與 pin。
- **理由**：#27 契約第 1 條、驗收 1、「鎖 pin 出處，不直接沿用 npm latest」；V-19／V-20／V-21。
- **In scope**：pin commit、trim 檔案清單、provenance 可追溯、授權檔保留（上游 MIT，V-22）。
- **Out of scope**：對上游程式碼的任何「整理」；把上游的 git 歷史帶進 repo。
- **可測性**：屬性測試 `VENDOR-PIN`（對 vendored 樹的檔案清單做全稱斷言：集合恰好等於允許清單；並以生成字串驗證 matcher 不是空泛的）。

#### REQ-27-2 pin ledger 與模組文件的列

- **陳述**：`vendor/dsh-plugins/VENDOR.md` 的 pin ledger 必須新增一列（沿用既有 `\| Directory \| Upstream \| Pinned commit \| Notes \|` 格式），內容必須同時包含：pin commit、trim 範圍、**LOCAL PATCH** 標記（若本計劃要求任何 divergence）、**pending-upstream** 註記、以及**移除條件**。`docs/modules/vendor-plugins.md` 的 vendored 表也必須新增對應一列。
- **理由**：#27 驗收 1；AGENTS.md 的 vendored plugin 政策（divergence 記在 ledger **與** docs row）。
- **In scope**：兩處文件列的必備元素。
- **Out of scope**：改寫既有列、重排 ledger 結構。
- **可測性**：屬性測試 `VENDOR-LEDGER`（把 ledger 解析成列集合 → 任一 `dsh-skill-market` 列必須具備四個元素；以生成字串驗證「缺少 pending-upstream 的列必須被判紅」）。

#### REQ-27-3 以 `kind: 'vendor'` 宣告並走既有 provisioning 迴圈

- **陳述**：`builtin.ts` 必須以 `registerBuiltinPlugin({ kind: 'vendor', dir: 'dsh-skill-market', package: 'dsh-skill-market' })` 的形式宣告（package 名以上游 `package.json` 的 `name` 為準，V-22）；它必須進入 `copyBuiltins('vendor')`、`expectedBuiltinBundles()`，並被 `copyBuiltinsStale()` 的內容指紋規則涵蓋；**不得**新增第二條 provisioning 路徑。
- **理由**：#27 契約第 2 條、驗收 2、約束「走既有 vendored built-in 機制，不另建新 provisioning 路徑」。
- **In scope**：registry 宣告、bundle row、staleness 涵蓋。
- **Out of scope**：optional 化、toggle、新的 ensure 函式。
- **可測性**：既有 `packages/uniterra-desktop/test/builtin-pbt.test.mjs` 的 `REGISTRY`／`SET`／`VENDOR`／`STALE` 不變式（生成式 registry 與 profile fixture）。

#### REQ-27-4 既有 profile 的 heal（D3）

- **陳述**：一個**已經 provision 過**的 profile（有 `profiles/web/package.json` 與 `node_modules`，但沒有任何 skill market 的 bundle row 或副本）在**下一次 boot** 時，必須長出新的 bundle row 與 `node_modules/dsh-skill-market/` 副本；整個 ensure pass 必須是**冪等**的（第二次執行不再改動），且**不得**改動任何不屬於本 registry 的 bundle row、dependency 或 `node_modules` 副本（例如使用者自行安裝的第三方 plugin）。
- **理由**：D3（使用者拍板）；#27 的「既有 profile 升級後也要長出 skill market」。
- **In scope**：heal 的收斂性、冪等性、對外來列的不可侵犯性。
- **Out of scope**：遷移/清理使用者既有的第三方 skill manager（見 OQ-27-3）。
- **可測性**：屬性測試 `PROVISION-HEAL-IDEMPOTENT` 與 `PROVISION-FOREIGN-UNTOUCHED`——**只在 temp fixture 目錄**上跑，永不觸碰 `~/.dsh`。真實 profile 的 boot heal 面屬知覺項，見 `ACCEPTANCE.md` 的（非 PBT）替代證據 A-27-1。

#### REQ-27-5 安裝目標是 dsh 的 user skill root

- **陳述**：從市場安裝的 skill 必須落在 dsh 的 user skill root `<DSH_HOME>/skills`（V-16），使模型端的 skill tool 能讀到；profile 內實際生效的設定不得把作者環境的絕對路徑當成預設值。
- **理由**：#27 契約第 3 條、驗收 3、預期「一鍵安裝進 `~/.dsh/skills`（或 profile 對應的 skill root）」。
- **In scope**：`installDir` 的**解析語意**（未設定 → `<DSH_HOME>/skills`；明確設定 → 以設定為準）、以及「模型 skill tool 讀得到」的可驗證路徑。
- **Out of scope**：skill 內容格式驗證、搜尋結果的排序/分頁（上游職責）。
- **可測性**：屬性測試 `SKILLROOT-DEFAULT`（生成 `home`/`dshHome`／明確設定 → C6 解析結果必須是絕對路徑、必須等於 `<DSH_HOME>/skills`（未設定時）、永不為 `/root/...`、永不為相對路徑）；模型 skill tool 實際讀取面屬知覺項，見 `ACCEPTANCE.md` 的（非 PBT）替代證據 A-27-2。

#### REQ-27-6 不重造 `dshmarket`

- **陳述**：本 built-in 不得修改、移除或取代 `dshmarket`（它仍是 `kind: 'npm'` 的 plugin 市場 built-in）；skill market 不得承擔 plugin 安裝/市集職責；也不得動使用者 profile 內不屬於本 registry 的列。
- **理由**：#27 約束「不重造 dshmarket（其仍負責 plugin 市場）」。
- **In scope**：npm registry 集合不變、職責邊界。
- **Out of scope**：plugin 市場的任何功能。
- **可測性**：既有 `builtin-pbt.test.mjs` 的 `REGISTRY: npm specs are pinned exact` 家族（生成式 spec）＋ `PROVISION-FOREIGN-UNTOUCHED`。

#### REQ-27-7 pinned 家族 divergence 的處置

- **陳述**：`dsh.client.inject` 與 `peerDependencies` 中指向 `@deepseek-ai/dsh-client-runtime` 的條目必須被處置——該套件在 pinned 0.1.5-rc.2 家族不存在（V-25），處置形式必須沿用 repo 既有先例（`dsh-shortcuts` 的 LOCAL PATCH：拿掉該 row，並在 ledger 記 pending-upstream 與移除條件）；**另外兩個** inject row（`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-settings`）在 pinned 家族存在（V-26），必須保留。host 半對 `@deepseek-ai/schemastery` 的依賴（V-24）必須在 profile 內可解析；解法只能走**既有的 profile 執行期依賴機制**（V-30）或在 vendored 副本內以 LOCAL PATCH 處理，**不得**為了這件事在 repo 的任何 `package.json` 新增 dependency。
- **理由**：V-25／V-26／V-27／V-28／V-30；AGENTS.md「Never loosen the dsh pins」與「Do not vendor a plugin you will not modify」。
- **In scope**：inject row／peerDependencies 的收斂、host 半依賴在 profile 內的可解析性、**repo 依賴集合不變**。
- **Out of scope**：更動 dsh pin 家族；把 `@deepseek-ai/schemastery` 加進 repo 的 dev/dependencies。
- **可測性**：屬性測試 `INJECT-ROWS`（生成 package.json fixture → 只允許 pinned 家族存在的套件名；`dsh-client-runtime` 必須被判紅）＋ `NO-NEW-REPO-DEP`（比對 5 個 `package.json` 的 dependency 鍵集合與今天相同）。profile 內的實際解析結果是 OQ-27-1，需 live 驗證。

#### REQ-27-8 不得把作者環境假設帶進使用者 profile

- **陳述**：vendored 副本、以及 provision 進 profile 的內容，都不得含有作者環境的絕對路徑或假設：不得出現 `/root/.dsh/skills`（V-23 的硬編 `installDir`）、不得出現 `/opt/dsh-work/gh-token`（V-23 的 `githubTokenFile`）；GitHub token 在未明確設定時必須是「不讀取」，而不是去讀作者路徑；也不得把作者的 UI 語言當成使用者預設。
- **理由**：V-23；這些值若原封帶入，會在別人的機器上指向不存在的路徑。
- **In scope**：vendored 樹的全域掃描語意、`installDir`/`githubTokenFile` 的預設語意。
- **Out of scope**：實作 token 讀取策略（上游職責）與任何 UI 文案調整。
- **可測性**：屬性測試 `NO-AUTHOR-PATH`（對 vendored 樹的每一行做全稱掃描；並以生成字串驗證 matcher 的語意：含 `/root/.dsh/skills` 的行必須判紅、含 `~/.dsh/skills` 的行不得判紅）。

## #28 修復 uniterra update 後同時開啟 web UI 與 desktop UI（應僅開啟後者）

### 現況

- CLI 端：`installPlan()` 對 `update` 產出 `update-cli` → `build-install-app` →（`open` 時）`launch-app`（V-04）；`runInstallPlan()` 是唯一的 stage dispatch，`openApp()` 只有在 `case 'launch-app'` 被呼叫一次（V-06）；`openApp()` 在 macOS 走 `/usr/bin/open <destination>`、Windows 走 detached spawn `Uniterra.exe`（V-05）；`launchTarget()` 只回傳 app 路徑/執行檔（V-03）。**CLI 端沒有一條會開瀏覽器的路徑。**
- desktop 端：只有兩個 spawn 點——Update Now 的 detached updater（`main.ts:299`）與 dsh runtime（`dsh-process.ts:128`）（V-14）；唯一的 `shell.openExternal` 在 updater spawn 失敗的 fallback（`main.ts:306`，V-15）；`startDsh()` 的 argv 已含 `--no-open`（V-09），且已有 spawn 斷言（V-10）。
- 上游語意：`dsh web` 的 ordinary invocation **預設會**把就緒 URL 交給作業系統開啟器，`--no-open` 關閉它（V-12）。
- `--no-open` 是 commit `6b69fad6` 才加進 `dsh-process.ts` 的（V-11），而 issue #28 開於 2026-09-01。
- **因此「雙開從哪來」在 HEAD 上是一條未確認事項（OQ-28-1），不是已確認事實。** 候選（都尚未證實）：packaged app 實際解析到的 dsh CLI 版本、以及 `builtin.ts:669`／`726`／`735` 三處沒有帶 `--no-open` 的 dsh 呼叫（V-13）。

### 需求

#### REQ-28-1 `uniterra update` 恰好一個 launch 路徑，且指向 Electron desktop app

- **陳述**：對 `uniterra update`（含 desktop `Update Now` 觸發的更新）的每一步，**啟動 desktop app 的動作恰好一次**，且目標是 Electron desktop app（macOS 為安裝後的 `.app`、Windows 為安裝目錄下的 `Uniterra.exe`）；CLI 的階段計畫中不得存在第二條會啟動應用或開啟瀏覽器的路徑。
- **理由**：#28 契約第 1 條與驗收 1；V-03／V-04／V-05／V-06。
- **In scope**：launch 動作的基數（≤1 且 `open` 時 ==1）、目標的種類（Electron app 而非 URL）、計畫層級的排他性。
- **Out of scope**：安裝/建置流程本身；macOS 與 Windows 的實作差異（只要求兩者都指向 Electron app）。
- **可測性**：屬性測試 `SURFACE-UNIQUE`（生成 `command`/`open`/`dryRun`/`platform`/`destination` → C5 的 surface 清單：Electron 啟動數 ≤ 1 且 == 1 若且唯若 `open`；瀏覽器開啟數恰好 0）。

#### REQ-28-2 `--no-open` 的既有行為不變

- **陳述**：`uniterra update --no-open`（以及 `setup --no-open`）仍然完全不啟動 app：`launch-app` 不得進入計畫，也不得被任何「替代形式」的啟動（例如改用瀏覽器、改用系統開啟器、改成 spawn 但不帶旗標的等價物）取代。
- **理由**：#28 約束「不影響 `--no-open`（使用者可不自動開啟）行為」。
- **In scope**：`--no-open` 的計畫語意與零啟動。
- **Out of scope**：新增抑制旗標。
- **可測性**：屬性測試 `SURFACE-NOOPEN`（生成 `command`/`dryRun` → `open: false` 的 surface 清單必為空）。

#### REQ-28-3 dsh runtime 子程序不得自行開啟瀏覽器

- **陳述**：desktop 啟動 dsh runtime 的**完整 argv** 必須包含抑制 auto-open 的旗標（現況為 `--no-open`，V-09），且不得包含任何會觸發 auto-open 的旗標；該抑制必須由 `startDsh` 自己加入（`options.args` 不得能移除它，最終 argv 至少出現一次）；此契約必須有測試且不得回退。
- **理由**：#28 驗收 2 與契約第 2 條；V-09／V-10／V-12。
- **In scope**：argv 的旗標契約（含 `port` 與額外 args 的組合）。
- **Out of scope**：dsh CLI 內部的 handoff 實作（上游職責，V-12）。
- **可測性**：屬性測試 `SPAWN-NOOPEN`（生成 `profile`/`port`/`args` → spawn 契約斷言：argv 內 `--no-open` 至少一次、且不含任何已知會開啟瀏覽器的旗標）；落點為既有 `packages/uniterra-desktop/test/dsh-process.test.mjs` 的擴充。

#### REQ-28-4 一次 update 產生的 surface 集合恰好是 { Electron desktop 視窗 }；且成因未確認前不得宣告達成

- **陳述**：(a) 行為定義：一次 `uniterra update`（含 Update Now 觸發）在整個生命週期中產生並留下的 UI surface 集合必須恰好是 `{ Electron desktop 視窗 }`——不得有額外的瀏覽器分頁或獨立 web UI；(b) 程序要求：在 OQ-28-1 的觀察記錄產出之前，本需求**不得**被標記為已達成——不論測試是否全綠。
- **理由**：#28 的預期與驗收 1。本計劃對現況的立場是 D8：既不宣稱已修好，也不宣稱 bug 仍在。
- **In scope**：surface 集合的行為定義、達成的前提條件（觀察記錄）。
- **Out of scope**：對未確認成因的修法。
- **可測性**：可測部分為 `SURFACE-UNIQUE`（計畫層級）＋ `SPAWN-NOOPEN`（spawn 層級）；真實 OS handoff 屬知覺項，見 `ACCEPTANCE.md` 的（非 PBT）替代證據 A-28-1（含 `PATH`-shadow `open` shim 的具體步驟）。

#### REQ-28-5 desktop 是 dsh web UI 的唯一載入介面

- **陳述**：dsh 的就緒 URL 只能由 Electron `BrowserWindow` 載入；除 updater spawn 失敗的既有 fallback（`main.ts:306` 開的是 release 頁面，不是 dsh URL，V-15）之外，不得呼叫 `shell.openExternal` 或任何系統開啟器去開 dsh 的 URL。
- **理由**：#28 約束「維持 desktop app 作為 dsh web UI 的唯一載入介面（BrowserWindow）」。
- **In scope**：dsh URL 的載入者唯一性。
- **Out of scope**：release 頁面 fallback 的既有行為。
- **可測性**：`SURFACE-UNIQUE` 涵蓋「瀏覽器開啟數恰好 0」；`shell.openExternal` 的呼叫點集合屬（非 PBT）的掃描面，見 `ACCEPTANCE.md` 的替代證據 A-28-2，因為「呼叫點只有一個」不是生成式輸入的函數。

#### REQ-28-6 更新流程的其餘階段不得改變

- **陳述**：`update-cli`、`build-install-app`（含 resolve source／pnpm install／build／package／embed／install）、退出碼、以及既有人類可讀輸出的語意，不得因為本需求改變；本計劃唯一允許新增的輸出是 #15 那組進度事件需求（REQ-15 系列）所要求的進度事件。
- **理由**：#28 約束「只在 launch/app-boot 路徑修正雙開，不更動其它更新流程」。
- **In scope**：其餘階段的可觀察行為不變。
- **Out of scope**：任何重構或效能調整。
- **可測性**：既有 CLI 屬性測試（`installPlan`／`parseArgs`／`embedStrategy`／`launchTarget`／`remapJunctionTarget` 等，V-37）必須維持綠燈，且 `PROGRESS-*` 不得改變既有的 stage 計畫。

## 未解問題（Open questions）

每一條都必須附「確認方式」，且必須標出它會影響哪幾條 `REQ`。完整理由與觀察紀錄見 `ISSUE-REFS.md` 的「未確認事項」。

| 編號    | 問題                                                                                                                                                                                                                    | 確認方式（指令／檔案）                                                                                                                                                                                                                                   | 影響的 REQ                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| OQ-28-1 | 「update 後雙開」的真實成因（`startDsh` 已帶 `--no-open`，V-09/V-10；issue 開單早於該 flag，V-11）。候選：packaged app 解析到的 dsh CLI 版本；`builtin.ts:669`／`726`／`735` 三處未帶 `--no-open` 的 dsh 呼叫（V-13）。 | 用 `PATH` shadow 一個記錄 argv 的 `open` shim 走一次 Update Now；`ps -Ao pid,ppid,command \| grep -iE 'uniterra\|dsh'`；讀 packaged app 內 `.../node_modules/@deepseek-ai/dsh/package.json` 的版本；對 `--dump-config`／`plugin add` 各跑一次同一 shim。 | `REQ-28-1`、`REQ-28-3`、`REQ-28-4` |
| OQ-27-1 | profile 內能不能解析 `@deepseek-ai/schemastery`（repo 樹解析不到，V-27；profile store 有但未 link，V-29）。                                                                                                             | 在拋棄式 `DSH_HOME` 內複製副本後跑 `require.resolve('@deepseek-ai/schemastery', { paths: [...] })`，再補一次 boot smoke。                                                                                                                                | `REQ-27-3`、`REQ-27-5`、`REQ-27-7` |
| OQ-27-2 | 上游 `main` 是否已前進（pin 是否需改）。                                                                                                                                                                                | 施工當天重跑 `curl -sS -L https://api.github.com/repos/QQ-M/dsh-skill-market/branches/main` 並與 `ACCEPTANCE.md` 的 pin 比對。                                                                                                                           | `REQ-27-1`、`REQ-27-2`             |
| OQ-27-3 | 使用者真實 profile 已有第三方 `@michengai/dsh-skills-manager`（V-32）：保留兩者、停用第三方、或以本 built-in 取代？                                                                                                     | 產品決策，需問使用者；工程面只需保證不觸碰外來列（`PROVISION-FOREIGN-UNTOUCHED`）。                                                                                                                                                                      | `REQ-27-4`、`REQ-27-6`             |
| OQ-15-1 | `<userData>/update-progress.ndjson` 在 Windows 上是否同樣可被下一次啟動推導出來。                                                                                                                                       | 真機（Windows）跑一次 Update Now，檢查 `%APPDATA%\Uniterra\update-progress.ndjson` 存在且可被歸約器讀取。                                                                                                                                                | `REQ-15-4`、`REQ-15-5`             |
| OQ-15-2 | 現有 `Update Now` 對話框的 `detail` 文字是否足以承擔「初始化告知」（`REQ-15-6` (a)）。                                                                                                                                  | 在拋棄式環境觸發 Update Now，記錄對話框全文再對照 `REQ-15-6` 的四個要素。                                                                                                                                                                                | `REQ-15-6`                         |
