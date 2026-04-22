import { FolderAdapter, type FolderAdapterOptions } from '@sweatrelay/adapter-folder'

/**
 * Blackbird (黑鸟单车) — file-import only.
 *
 * 黑鸟没有公开开发者 API；export GPX/FIT files from the Blackbird app
 * (我的 → 骑行记录 → 详情 → 分享 → 导出文件) into the watched folder.
 */
export class BlackbirdFolderAdapter extends FolderAdapter {
  constructor(opts: Omit<FolderAdapterOptions, 'id' | 'displayName'>) {
    super({
      ...opts,
      id: 'blackbird-folder',
      displayName: 'Blackbird (黑鸟单车) 手动导出',
    })
  }
}
