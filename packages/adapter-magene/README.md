# @sweatrelay/adapter-magene

Source label: **Magene (迈金) — file-import only**.

迈金没有公开的开发者 API；本 adapter 走"用户手动导出 FIT → 工具上传"路径。

## How users export Magene rides

1. 打开 Magene Link App
2. 进入"我的 → 训练记录"，选中要导出的活动
3. 点右上角"…" → "导出 FIT"
4. 通过 AirDrop / 邮件 / iCloud Drive 把 FIT 文件放到 SweatRelay 监听的目录

## Source type

`file-import`（合规、零私有接口风险）

## Why no API

Magene 主要做硬件（功率计、码表），没有面向第三方的开放平台。如果将来开放，把 `MageneFolderAdapter` 留作 fallback，新增 `MageneApiAdapter` 实现同一 `SourceAdapter` 接口即可。
