# 拾词 · Android APK（只发给朋友）

这个工程把现有的拾词网页版放进 Android WebView，并接入了 **Android 原生 TTS**。
构建出来的是 **debug APK**，自带调试签名，可以直接安装，不需要软著、备案或应用商店。

## 最快出 APK：GitHub Actions

### 1. 建仓库

在 GitHub 新建一个仓库，例如 `shici-android`。  
公开/私有都可以；私有仓库的 Actions 也有免费额度。

### 2. 上传工程

把本文件夹里的**全部内容**上传到仓库根目录，包括隐藏的 `.github` 文件夹。

推荐用 GitHub Desktop，或命令行：

```bash
git init
git add .
git commit -m "shici android"
git branch -M main
git remote add origin https://github.com/你的用户名/shici-android.git
git push -u origin main
```

如果网页上传时 `.github` 没上传成功，在 GitHub 网页手动新建：

```text
.github/workflows/build-apk.yml
```

把本工程里的 `WORKFLOW.txt` 内容复制进去即可（这个文件就是完整 YAML）。

### 3. 运行构建

进入仓库的 **Actions** 页面：

1. 左侧选择 **Build Shici APK**
2. 点 **Run workflow**
3. 等待 2–5 分钟

构建完成后，在本次运行页面底部下载：

```text
shici-debug-apk
```

解压后得到：

```text
app-debug.apk
```

### 4. 发给朋友

把 `app-debug.apk` 通过微信/QQ/网盘发给朋友。  
朋友在手机上点开，允许“安装未知应用”即可。

首次安装时 Android 可能提示“未知来源”，这是正常提示，不是病毒。

## 这个 APK 包含什么

- 完整词库：6,094 词（专升本 2,732）
- 艾宾浩斯复习
- 听写、错词本、统计、设置
- 数据保存在 WebView 的 localStorage + IndexedDB
- 正常关闭 App 不会丢；设置里有 JSON 导出/导入
- 原生 Android TTS 朗读；没有英语语音时回退到在线发音（需要联网）

## 数据说明

- App 的 WebView 数据在应用私有目录，普通关闭不会清。
- 卸载 App 会清掉本地数据；重要进度先导出 JSON。
- 不同手机之间用「设置 → 导出备份 / 导入备份」迁移。
- 在线发音会把当前单词发送给发音服务；学习记录不上传。

## 签名说明

- 这个工程默认构建 **debug APK**，由构建机自动签名，朋友可以直接安装。
- 只发给朋友，不需要购买证书，也不需要应用商店隐私政策。
- 工作流已缓存 `~/.android/debug.keystore`，通常可以让多次构建保持同一个 debug 签名，支持覆盖安装。
- 如果 GitHub 缓存被清理，签名会变化，覆盖安装失败时先卸载旧版再装新版。
- 如果要长期稳定升级，后续可以改用固定 release keystore；那时再补一份签名配置即可。

## 如果构建失败

常见原因：

1. `.github/workflows/build-apk.yml` 没有上传成功  
   → 手动在 GitHub 网页新建该文件。
2. GitHub Actions 被禁用  
   → 仓库 Settings → Actions → General → 允许 Actions。
3. Android SDK 下载失败  
   → 重新运行一次 workflow；GitHub 网络偶尔会超时。

## 本地 Android Studio（可选）

如果不想用 GitHub Actions：

1. 安装 Android Studio
2. 打开本文件夹
3. 等待 Gradle 同步
4. `Build → Build Bundle(s) / APK(s) → Build APK(s)`
5. APK 在 `app/build/outputs/apk/debug/app-debug.apk`

本机当前没有 JDK/Android SDK，所以没有直接生成 APK；GitHub Actions 不依赖本机环境。
