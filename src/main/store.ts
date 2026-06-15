import Store from 'electron-store'
import { safeStorage } from 'electron'
import type {
  AppSettings,
  InfoEntry,
  MemoryEntry,
  RelayProfile,
  RelayProfileInput
} from '../shared/types'
import { normalizeBaseUrl } from '../shared/url'
import { BUILTIN_RELAY } from './builtin'

interface StoredProfile {
  id: string
  name: string
  baseUrl: string
  /** 加密后的 base64；enc: 已加密，plain: 明文兜底 */
  apiKeyEnc?: string
  chatModel?: string
  visionModel?: string
  createdAt: number
}

interface Schema {
  profiles: StoredProfile[]
  activeProfileId?: string
  settings: AppSettings
  infoEntries: InfoEntry[]
  memories: MemoryEntry[]
}

const store = new Store<Schema>({
  name: 'wenshu-config',
  defaults: {
    profiles: [],
    activeProfileId: undefined,
    settings: {},
    infoEntries: [],
    memories: []
  }
})

function encrypt(plain: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(plain).toString('base64')
    }
  } catch {
    /* 落明文兜底 */
  }
  return 'plain:' + Buffer.from(plain, 'utf8').toString('base64')
}

function decrypt(stored?: string): string {
  if (!stored) return ''
  try {
    if (stored.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    }
    if (stored.startsWith('plain:')) {
      return Buffer.from(stored.slice(6), 'base64').toString('utf8')
    }
  } catch {
    return ''
  }
  return ''
}

function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return key[0] + '••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

function toPublic(p: StoredProfile): RelayProfile {
  const key = decrypt(p.apiKeyEnc)
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    apiKeyMasked: maskKey(key),
    hasKey: !!key,
    chatModel: p.chatModel,
    visionModel: p.visionModel,
    createdAt: p.createdAt
  }
}

let idCounter = 0
function genId(prefix: string): string {
  // 环境禁用 Math.random/Date.now 的脚本里用计数器；这里在 Electron 主进程，Date.now 可用
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`
}

export const configStore = {
  /** 首次启动时种入内置（锁定）中转站，使软件开箱即用、免配置 */
  seedBuiltinProfile(): void {
    if (store.get('profiles').length > 0) return
    const next: StoredProfile = {
      id: BUILTIN_RELAY.id,
      name: BUILTIN_RELAY.name,
      baseUrl: normalizeBaseUrl(BUILTIN_RELAY.baseUrl),
      apiKeyEnc: encrypt(BUILTIN_RELAY.apiKey),
      chatModel: BUILTIN_RELAY.chatModel,
      visionModel: BUILTIN_RELAY.visionModel,
      createdAt: Date.now()
    }
    store.set('profiles', [next])
    store.set('activeProfileId', next.id)
  },

  getProfiles(): RelayProfile[] {
    return store.get('profiles').map(toPublic)
  },
  getActiveProfileId(): string | undefined {
    const id = store.get('activeProfileId')
    const profiles = store.get('profiles')
    if (id && profiles.some((p) => p.id === id)) return id
    return profiles[0]?.id
  },
  setActiveProfileId(id: string): void {
    store.set('activeProfileId', id)
  },
  /** 主进程内部：取解密后的 key */
  getRawProfile(id: string): (StoredProfile & { apiKey: string }) | undefined {
    const p = store.get('profiles').find((x) => x.id === id)
    if (!p) return undefined
    return { ...p, apiKey: decrypt(p.apiKeyEnc) }
  },
  saveProfile(input: RelayProfileInput): RelayProfile {
    const profiles = store.get('profiles')
    const existing = input.id ? profiles.find((p) => p.id === input.id) : undefined
    const next: StoredProfile = {
      id: existing?.id ?? genId('relay'),
      name: input.name.trim() || '未命名中转站',
      baseUrl: normalizeBaseUrl(input.baseUrl),
      apiKeyEnc:
        input.apiKey && input.apiKey.length > 0 ? encrypt(input.apiKey) : existing?.apiKeyEnc,
      chatModel: input.chatModel,
      visionModel: input.visionModel,
      createdAt: existing?.createdAt ?? Date.now()
    }
    const updated = existing
      ? profiles.map((p) => (p.id === next.id ? next : p))
      : [...profiles, next]
    store.set('profiles', updated)
    if (!store.get('activeProfileId')) store.set('activeProfileId', next.id)
    return toPublic(next)
  },
  deleteProfile(id: string): void {
    const profiles = store.get('profiles').filter((p) => p.id !== id)
    store.set('profiles', profiles)
    if (store.get('activeProfileId') === id) store.set('activeProfileId', profiles[0]?.id)
  },

  getSettings(): AppSettings {
    return store.get('settings')
  },
  setSettings(patch: Partial<AppSettings>): AppSettings {
    const next = { ...store.get('settings'), ...patch }
    store.set('settings', next)
    return next
  },

  // ---- 信息库 ----
  getInfoEntries(): InfoEntry[] {
    return store.get('infoEntries')
  },
  saveInfoEntry(entry: Omit<InfoEntry, 'id'> & { id?: string }): InfoEntry {
    const list = store.get('infoEntries')
    const existing = entry.id ? list.find((e) => e.id === entry.id) : undefined
    const next: InfoEntry = {
      id: existing?.id ?? genId('info'),
      category: entry.category.trim() || '未分类',
      label: entry.label.trim(),
      value: entry.value
    }
    const updated = existing ? list.map((e) => (e.id === next.id ? next : e)) : [...list, next]
    store.set('infoEntries', updated)
    return next
  },
  deleteInfoEntry(id: string): void {
    store.set(
      'infoEntries',
      store.get('infoEntries').filter((e) => e.id !== id)
    )
  },

  // ---- 长期记忆 ----
  getMemories(): MemoryEntry[] {
    return store.get('memories')
  },
  /** 生成一条记忆（带 id），不落盘 */
  mintMemory(text: string, source: MemoryEntry['source'], createdAt?: number): MemoryEntry {
    return { id: genId('mem'), text, source, createdAt: createdAt ?? Date.now() }
  },
  addMemory(text: string, source: MemoryEntry['source']): MemoryEntry {
    const entry = this.mintMemory(text, source)
    store.set('memories', [...store.get('memories'), entry])
    return entry
  },
  setMemories(list: MemoryEntry[]): void {
    store.set('memories', list)
  },
  deleteMemory(id: string): void {
    store.set(
      'memories',
      store.get('memories').filter((m) => m.id !== id)
    )
  },
  clearMemories(): void {
    store.set('memories', [])
  }
}
