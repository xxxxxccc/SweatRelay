import { FolderAdapter, type FolderAdapterOptions } from '@sweatrelay/adapter-folder'

/**
 * "Onelap via manual file export" — same behavior as FolderAdapter, just labeled
 * differently so the GUI/history can show that the user chose the folder path
 * intentionally for Onelap data. No API contact at all.
 */
export class OnelapFolderAdapter extends FolderAdapter {
  constructor(opts: Omit<FolderAdapterOptions, 'id' | 'displayName'>) {
    super({
      ...opts,
      id: 'onelap-folder',
      displayName: 'Onelap (手动导出 FIT)',
    })
  }
}
