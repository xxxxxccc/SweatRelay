import { FolderAdapter, type FolderAdapterOptions } from '@sweatrelay/adapter-folder'

/**
 * Magene (迈金) — file-import only.
 *
 * No public developer API; export FIT files from the Magene Link app
 * (设置 → 训练数据 → 导出) into the watched folder. The adapter is otherwise
 * identical to the generic FolderAdapter; the brand label exists so the GUI /
 * sync history can attribute uploads correctly.
 */
export class MageneFolderAdapter extends FolderAdapter {
  constructor(opts: Omit<FolderAdapterOptions, 'id' | 'displayName'>) {
    super({
      ...opts,
      id: 'magene-folder',
      displayName: 'Magene (迈金) 手动导出',
    })
  }
}
