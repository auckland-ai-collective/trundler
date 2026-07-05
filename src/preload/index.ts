import { contextBridge, ipcRenderer } from 'electron'
import type { AgentEvent, AppConfig, ToolInfo } from '../shared/types.js'

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (cfg: AppConfig): Promise<AppConfig> => ipcRenderer.invoke('config:set', cfg),
  listTools: (): Promise<ToolInfo[]> => ipcRenderer.invoke('tools:list'),

  send: (text: string): Promise<void> => ipcRenderer.invoke('chat:send', text),
  cancel: (): Promise<void> => ipcRenderer.invoke('chat:cancel'),
  resetChat: (): Promise<boolean> => ipcRenderer.invoke('chat:reset'),

  mcpCall: (
    name: string,
    args: Record<string, unknown>
  ): Promise<{ ok: boolean; data: unknown }> => ipcRenderer.invoke('mcp:call', name, args),

  respondApproval: (id: string, approved: boolean): Promise<void> =>
    ipcRenderer.invoke('approval:respond', id, approved),

  /** Subscribe to streamed agent events. Returns an unsubscribe fn. */
  onAgentEvent: (cb: (evt: AgentEvent) => void): (() => void) => {
    const listener = (_e: unknown, evt: AgentEvent): void => cb(evt)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  }
}

contextBridge.exposeInMainWorld('trundler', api)

export type TrundlerApi = typeof api
