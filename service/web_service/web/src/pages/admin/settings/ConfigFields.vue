<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue'
import BaseSelect from '../../../components/BaseSelect.vue'
import { get, post } from '../../../utils/request'

 type FieldDefinition = { type?: string; options?: unknown[]; options_from?: string; default?: unknown; description?: string; name?: string; sensitive?: boolean; input_type?: string; item_template?: Record<string, Field>; [key: string]: unknown }
type Field = FieldDefinition | unknown[]

const props = defineProps<{ template: Record<string, Field>; model: Record<string, any>; rootModel?: Record<string, any>; configId?: string; instanceName?: string; authenticated?: boolean; accountId?: string | null }>()
const rootModel = props.rootModel || props.model
const emit = defineEmits<{ authenticated: []; loggedOut: [] }>()
const jsonErrors = reactive<Record<string, string>>({})
const qrState = ref({ loading: false, imageUrl: '', message: '', sessionId: '' })
const logoutLoading = ref(false)
const logoutError = ref('')
let qrTimer: ReturnType<typeof setInterval> | undefined
let qrRequestId = 0

function nestedTemplate(field: Field): Record<string, Field> {
  return !Array.isArray(field) && field && typeof field === 'object' && 'type' in field && field.type === 'object' && field.default && typeof field.default === 'object'
    ? field.default as Record<string, Field>
    : {}
}

function sensitive(name: string, field: Field) {
  return (isField(field) && field.sensitive === true) || /(token|secret|password|passwd|key)$/i.test(name)
}

function toggleOption(name: string, option: string, checked: boolean) {
  const values = Array.isArray(props.model[name]) ? props.model[name] : []
  props.model[name] = checked ? [...new Set([...values, option])] : values.filter((value: string) => value !== option)
}

function valuesAtPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, source)
}

function selectOptions(field: Field | undefined, rootModel = props.model): string[] {
  if (!isField(field)) return []
  if (field.options_from) {
    const source = valuesAtPath(rootModel, field.options_from.replace(/\[\]\.name$/, ''))
    return Array.isArray(source) ? [...new Set(source.map(item => item && typeof item === 'object' ? (item as Record<string, unknown>).name : undefined).filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim()))] : []
  }
  return Array.isArray(field.options) ? field.options.map(String) : []
}

function selectValue(name: string, field: Field): string {
  const current = props.model[name]
  if (typeof current === 'string') return current
  if (isField(field) && typeof field.default === 'string') return field.default
  return selectOptions(field, rootModel)[0] || ''
}

function isField(field: unknown): field is FieldDefinition {
  return !Array.isArray(field) && field !== null && typeof field === 'object' && 'type' in field
}

function isStructured(field: Field): boolean {
  return Array.isArray(field) || (isField(field) && (field.type === 'array' || field.type === 'json'))
}

function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every(item => item !== null && typeof item === 'object' && !Array.isArray(item))
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isObjectArrayField(name: string, field: Field): boolean {
  return isObjectArray(props.model[name]) || (isField(field) && (isObjectArray(field.default) || Boolean(field.item_template)))
}

function arrayItems(name: string): Record<string, unknown>[] {
  return isObjectArray(props.model[name]) ? props.model[name] : []
}

function itemKeys(name: string): string[] {
  const keys = new Set<string>()
  arrayItems(name).forEach(item => Object.keys(item).forEach(key => keys.add(key)))
  return [...keys]
}

function itemTemplate(field: Field): Record<string, Field> {
  return isField(field) && field.item_template && typeof field.item_template === 'object' ? field.item_template : {}
}

function itemField(field: Field, key: string): Field | undefined {
  return itemTemplate(field)[key]
}

function itemType(field: Field, key: string): string | undefined {
  const definition = itemField(field, key)
  return isField(definition) ? definition.type : undefined
}

function itemOptions(field: Field, key: string): string[] {
  return selectOptions(itemField(field, key), rootModel)
}

function itemLabel(field: Field, key: string): string {
  const definition = itemField(field, key)
  return isField(definition) ? definition.name || key : key
}

function addArrayItem(name: string, field: Field) {
  const current = arrayItems(name)
  const template = itemTemplate(field)
  if (Object.keys(template).length) {
    props.model[name] = [...current, Object.fromEntries(Object.entries(template).map(([key, definition]) => [key, isField(definition) ? structuredClone(definition.default ?? (definition.type === 'boolean' ? false : '')) : '']))]
    return
  }
  const defaultValue = isField(field) ? field.default : undefined
  const source = isObjectArray(defaultValue) ? defaultValue[0] : undefined
  props.model[name] = [...current, source ? structuredClone(source) : {}]
}

function removeArrayItem(name: string, index: number) {
  props.model[name] = arrayItems(name).filter((_, itemIndex) => itemIndex !== index)
}

function stringItems(name: string): string[] {
  return isStringArray(props.model[name]) ? props.model[name] : []
}

function addStringItem(name: string) {
  props.model[name] = [...stringItems(name), '']
}

function updateStringItem(name: string, index: number, event: Event) {
  const value = (event.target as HTMLInputElement).value
  props.model[name] = stringItems(name).map((item, itemIndex) => itemIndex === index ? value : item)
}

function removeStringItem(name: string, index: number) {
  props.model[name] = stringItems(name).filter((_, itemIndex) => itemIndex !== index)
}

function mapEntries(name: string): Array<{ key: string; value: string }> {
  const value = props.model[name]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value).flatMap(([key, item]) => typeof item === 'string' ? [{ key, value: item }] : [])
    : []
}

function updateMapEntry(name: string, index: number, key: string, value: string) {
  const entries = mapEntries(name)
  entries[index] = { key, value }
  props.model[name] = Object.fromEntries(entries.filter(entry => entry.key.trim()).map(entry => [entry.key, entry.value]))
}

function addMapEntry(name: string) {
  const entries = mapEntries(name)
  const used = new Set(entries.map(entry => entry.key))
  let index = 1
  while (used.has(`user-${index}`)) index++
  props.model[name] = Object.fromEntries([...entries, { key: `user-${index}`, value: '' }].map(entry => [entry.key, entry.value]))
}

function removeMapEntry(name: string, index: number) {
  props.model[name] = Object.fromEntries(mapEntries(name).filter((_, entryIndex) => entryIndex !== index).map(entry => [entry.key, entry.value]))
}

function updateArrayValue(name: string, index: number, key: string, event: Event) {
  const input = event.target as HTMLInputElement
  const current = arrayItems(name)
  const value = current[index]?.[key]
  const nextValue = typeof value === 'number' ? Number(input.value) : input.value
  props.model[name] = current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: nextValue } : item)
}

function setArrayValue(name: string, index: number, key: string, value: unknown) {
  props.model[name] = arrayItems(name).map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item)
}

function sensitiveInputType(name: string, field: Field): string {
  return isField(field) && field.input_type === 'text' ? 'text' : sensitive(name, field) ? 'password' : 'text'
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2)
}

function updateJson(name: string, event: Event) {
  const target = event.target as HTMLTextAreaElement
  try {
    props.model[name] = JSON.parse(target.value)
    jsonErrors[name] = ''
    target.setCustomValidity('')
  } catch {
    jsonErrors[name] = '请输入有效 JSON'
    target.setCustomValidity('请输入有效 JSON')
    target.reportValidity()
  }
}

function isApiConfig(): boolean {
  return Boolean(props.template.method && props.template.url && props.template.params && props.template.body && props.template.variables)
}

function isApiMethod(name: string): boolean {
  return isApiConfig() && name === 'method'
}

function apiParams(name: string): Record<string, string> {
  const value = props.model[name]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item ?? '')]))
    : {}
}

function apiParamEntries(name: string): Array<{ key: string; value: string }> {
  return Object.entries(apiParams(name)).map(([key, value]) => ({ key, value }))
}

function updateApiParam(name: string, index: number, key: string, value: string) {
  const entries = apiParamEntries(name)
  entries[index] = { key, value }
  props.model[name] = Object.fromEntries(entries.filter(entry => entry.key.trim()).map(entry => [entry.key.trim(), entry.value]))
}

function addApiParam(name: string) {
  const entries = apiParamEntries(name)
  const used = new Set(entries.map(entry => entry.key))
  let index = 1
  while (used.has(`param_${index}`)) index++
  props.model[name] = Object.fromEntries([...entries, { key: `param_${index}`, value: '' }].map(entry => [entry.key, entry.value]))
}

function removeApiParam(name: string, index: number) {
  props.model[name] = Object.fromEntries(apiParamEntries(name).filter((_, entryIndex) => entryIndex !== index).map(entry => [entry.key, entry.value]))
}

function apiVariables(name: string): Record<string, Record<string, any>> {
  const value = props.model[name]
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function apiVariableEntries(name: string): Array<{ key: string; value: Record<string, any> }> {
  return Object.entries(apiVariables(name)).map(([key, value]) => [key, value && typeof value === 'object' && !Array.isArray(value) ? value : {}] as const).map(([key, value]) => ({key, value}))
}

function updateApiVariable(name: string, index: number, key: string, field: string, value: unknown, nextKey = key) {
  const entries = apiVariableEntries(name)
  const entry = entries[index]
  if (!entry) return
  entry.value[field] = value
  entry.key = nextKey
  props.model[name] = Object.fromEntries(entries.filter(entry => entry.key.trim()).map(entry => [entry.key.trim(), entry.value]))
}

function addApiVariable(name: string) {
  const entries = apiVariableEntries(name)
  const used = new Set(entries.map(entry => entry.key))
  let index = 1
  while (used.has(`value_${index}`)) index++
  props.model[name] = Object.fromEntries([...entries, {key: `value_${index}`, value: {description: '', type: 'string', required: true}}].map(entry => [entry.key, entry.value]))
}

function removeApiVariable(name: string, index: number) {
  props.model[name] = Object.fromEntries(apiVariableEntries(name).filter((_, entryIndex) => entryIndex !== index).map(entry => [entry.key, entry.value]))
}

function updateApiJson(name: string, event: Event) {
  updateJson(name, event)
}

function stopQr(name: string) {
  if (qrTimer) clearInterval(qrTimer)
  qrTimer = undefined
}
function qrImageError(name: string) {
  qrState.value.message = '二维码图片加载失败，请刷新后重试'
}
async function pollQr(name: string) {
  const state = qrState.value
  if (!state?.sessionId || !props.configId || !props.instanceName) return
  try {
    const result = await get<{ state: 'waiting' | 'confirmed' | 'expired' }>(`/api/admin/system/configs/${encodeURIComponent(props.configId)}/auth/${encodeURIComponent(name)}/${encodeURIComponent(state.sessionId)}?name=${encodeURIComponent(props.instanceName)}`)
    if (result.state === 'confirmed') { state.message = '登录成功'; stopQr(name); emit('authenticated') }
    if (result.state === 'expired') { state.message = '二维码已过期'; stopQr(name) }
  } catch (error) { state.message = error instanceof Error ? error.message : '登录状态查询失败'; stopQr(name) }
}
async function startQr(name: string) {
  if (!props.configId || !props.instanceName) return
  stopQr(name)
  const requestId = ++qrRequestId
  qrState.value = { loading: true, imageUrl: '', message: '正在获取二维码', sessionId: '' }
  try {
    const result = await post<{ session_id?: unknown; qr?: unknown }>(`/api/admin/system/configs/${encodeURIComponent(props.configId)}/auth/${encodeURIComponent(name)}/start`, { name: props.instanceName })
    if (qrRequestId !== requestId) return
    if (typeof result.session_id !== 'string' || typeof result.qr !== 'string' || !result.qr.startsWith('data:image/')) throw new Error('二维码响应格式无效')
    qrState.value = { loading: false, imageUrl: result.qr, message: '请使用酷狗扫描二维码', sessionId: result.session_id }
    qrTimer = setInterval(() => void pollQr(name), 2000)
    void pollQr(name)
  } catch (error) {
    if (qrRequestId === requestId) qrState.value = { loading: false, imageUrl: '', message: error instanceof Error ? error.message : '二维码获取失败', sessionId: '' }
  } finally {
    if (qrRequestId === requestId && qrState.value.loading) qrState.value.loading = false
  }
}
async function logout(name: string) {
  if (!props.configId || !props.instanceName || logoutLoading.value) return
  logoutLoading.value = true
  logoutError.value = ''
  stopQr(name)
  try {
    await post(`/api/admin/system/configs/${encodeURIComponent(props.configId)}/kugou/logout`, { name: props.instanceName })
    qrState.value = { loading: false, imageUrl: '', message: '', sessionId: '' }
    emit('loggedOut')
  } catch (error) {
    logoutError.value = error instanceof Error ? error.message : '退出登录失败'
  } finally { logoutLoading.value = false }
}
watch(() => `${props.configId || ''}:${props.instanceName || ''}:${props.authenticated}`, () => {
  stopQr('account')
  if (!props.authenticated) for (const [name, field] of Object.entries(props.template)) if (isField(field) && field.type === 'qrcode_auth' && !qrState.value.loading && !qrState.value.imageUrl) void startQr(name)
}, { immediate: true })
onBeforeUnmount(() => stopQr('account'))
</script>

<template>
  <form class="fields" @submit.prevent>
    <div v-for="(field, name) in template" :key="name" class="field">
      <template v-if="isField(field) && field.type === 'object'">
        <fieldset>
          <legend>{{ field.name || name }}</legend>
        <ConfigFields :template="nestedTemplate(field)" :model="model[name] ||= {}" :root-model="rootModel" />
        </fieldset>
      </template>
      <template v-else>
        <label :for="`field-${name}`">{{ isField(field) ? field.name || name : name }}</label>
        <small v-if="isField(field) && field.description">{{ field.description }}</small>
        <div v-if="isField(field) && field.type === 'array' && isObjectArrayField(String(name), field)" class="array-editor">
          <div v-for="(item, index) in arrayItems(String(name))" :key="index" class="array-item">
            <div class="array-item-title">条目 {{ index + 1 }}</div>
            <div class="array-inputs">
              <label v-for="key in itemKeys(String(name))" :key="key"><span>{{ itemLabel(field, key) }}</span><label v-if="itemType(field, key) === 'boolean'" class="switch compact"><input :checked="item[key] === true" type="checkbox" @change="setArrayValue(String(name), index, key, ($event.target as HTMLInputElement).checked)"><i aria-hidden="true" /><span>{{ item[key] === true ? '已启用' : '已关闭' }}</span></label><BaseSelect v-else-if="itemType(field, key) === 'single_select'" :model-value="String(item[key] ?? '')" :aria-label="itemLabel(field, key)" :options="itemOptions(field, key)" @update:model-value="setArrayValue(String(name), index, key, $event)" /><input v-else :value="item[key]" :type="typeof item[key] === 'number' ? 'number' : 'text'" step="any" @input="updateArrayValue(String(name), index, key, $event)"></label>
            </div>
            <button type="button" class="array-remove" @click="removeArrayItem(String(name), index)">删除</button>
          </div>
          <button type="button" class="array-add" title="添加条目" aria-label="添加条目" @click="addArrayItem(String(name), field)">+</button>
        </div>
        <div v-else-if="isField(field) && field.type === 'string_list'" class="string-array-editor">
          <div v-for="(item, index) in stringItems(String(name))" :key="index" class="string-array-item">
            <input :id="`field-${name}-${index}`" :value="item" type="text" @input="updateStringItem(String(name), index, $event)">
            <button type="button" class="array-remove" :aria-label="`删除条目 ${index + 1}`" @click="removeStringItem(String(name), index)">删除</button>
          </div>
          <button type="button" class="array-add" title="添加条目" aria-label="添加条目" @click="addStringItem(String(name))">+</button>
        </div>
        <div v-else-if="isField(field) && field.type === 'map_list'" class="map-list-editor">
          <div class="map-list-head"><span>{{ field.key_name || '键' }}</span><span>{{ field.value_name || '值' }}</span><span aria-hidden="true" /></div>
          <div v-for="(entry, index) in mapEntries(String(name))" :key="`${entry.key}:${index}`" class="map-list-row">
            <input :id="`field-${name}-${index}-key`" :value="entry.key" :placeholder="String(field.key_placeholder || '')" @input="updateMapEntry(String(name), index, ($event.target as HTMLInputElement).value, entry.value)">
            <BaseSelect v-if="field.value_options_from || field.value_options" :model-value="entry.value" :aria-label="String(field.value_name || '值')" :options="selectOptions({ type: 'single_select', options: Array.isArray(field.value_options) ? field.value_options : [], options_from: typeof field.value_options_from === 'string' ? field.value_options_from : undefined }, rootModel)" @update:model-value="updateMapEntry(String(name), index, entry.key, $event)" />
            <input v-else :value="entry.value" :placeholder="String(field.value_placeholder || '')" @input="updateMapEntry(String(name), index, entry.key, ($event.target as HTMLInputElement).value)">
            <button type="button" class="array-remove" :aria-label="`删除 ${entry.key}`" @click="removeMapEntry(String(name), index)">删除</button>
          </div>
          <button type="button" class="array-add" title="添加映射" aria-label="添加映射" @click="addMapEntry(String(name))">+</button>
        </div>
        <div v-else-if="isField(field) && field.type === 'qrcode_auth'" class="qr-auth">
          <template v-if="authenticated"><strong>已登录</strong><small v-if="accountId">用户 ID：{{ accountId }}</small><div class="qr-actions"><button type="button" @click="startQr(String(name))">重新登录</button><button class="logout" type="button" :disabled="logoutLoading" @click="logout(String(name))">{{ logoutLoading ? '退出中' : '退出登录' }}</button></div><small v-if="logoutError" class="error">{{ logoutError }}</small></template>
          <template v-else><img v-if="qrState.imageUrl" :src="qrState.imageUrl" alt="酷狗登录二维码" @error="qrImageError(String(name))"><div class="qr-status"><p><i v-if="qrState.loading" aria-hidden="true" />{{ qrState.message || '正在准备二维码' }}</p><button type="button" :disabled="qrState.loading" @click="startQr(String(name))"><i v-if="qrState.loading" aria-hidden="true" />{{ qrState.loading ? '刷新中' : '刷新二维码' }}</button></div></template>
        </div>
         <div v-else-if="isApiConfig() && name === 'params'" v-show="model.method !== 'POST'" class="api-map-editor">
           <div class="api-map-head"><span>参数名</span><span>参数值</span><span>说明</span><span aria-hidden="true" /></div>
             <div v-for="(entry, index) in apiParamEntries(String(name))" :key="index" class="api-map-row">
             <input :value="entry.key" placeholder="keyword" @input="updateApiParam(String(name), index, ($event.target as HTMLInputElement).value, entry.value)">
             <input :value="entry.value" placeholder="固定值或 ${keyword}" @input="updateApiParam(String(name), index, entry.key, ($event.target as HTMLInputElement).value)">
             <small>{{ entry.value.match(/^\$\{[A-Za-z_][A-Za-z0-9_-]*}$/) ? '由 AI 填写' : '固定配置' }}</small>
             <button type="button" class="array-remove" :aria-label="`删除参数 ${entry.key}`" @click="removeApiParam(String(name), index)">删除</button>
           </div>
           <button type="button" class="array-add" title="添加 API 参数" aria-label="添加 API 参数" @click="addApiParam(String(name))">+</button>
         </div>
         <div v-else-if="isApiConfig() && name === 'body'" v-show="model.method === 'POST'" class="json-field api-json-field"><textarea :id="`field-${name}`" :value="jsonValue(model[name])" spellcheck="false" @change="updateApiJson(name, $event)" /><small :class="{ error: jsonErrors[name] }">{{ jsonErrors[name] || 'POST 请求 JSON Body；值为 ${name} 的字段由 AI 填写，其余字段固定。' }}</small></div>
         <div v-else-if="isApiConfig() && name === 'variables'" class="api-variables-editor">
           <div class="api-variable-head"><span>参数名</span><span>类型</span><span>描述</span><span>必填</span><span aria-hidden="true" /></div>
             <div v-for="(entry, index) in apiVariableEntries(String(name))" :key="index" class="api-variable-row">
             <input :value="entry.key" placeholder="keyword" @input="updateApiVariable(String(name), index, entry.key, 'description', entry.value.description, ($event.target as HTMLInputElement).value)">
             <BaseSelect :model-value="String(entry.value.type || 'string')" aria-label="参数类型" :options="['string', 'number', 'boolean']" @update:model-value="updateApiVariable(String(name), index, entry.key, 'type', $event)" />
             <input :value="entry.value.description || ''" placeholder="参数用途" @input="updateApiVariable(String(name), index, entry.key, 'description', ($event.target as HTMLInputElement).value)">
             <label class="switch compact"><input :checked="entry.value.required !== false" type="checkbox" @change="updateApiVariable(String(name), index, entry.key, 'required', ($event.target as HTMLInputElement).checked)"><i aria-hidden="true" /><span>{{ entry.value.required !== false ? '是' : '否' }}</span></label>
             <button type="button" class="array-remove" :aria-label="`删除 AI 参数 ${entry.key}`" @click="removeApiVariable(String(name), index)">删除</button>
           </div>
           <button type="button" class="array-add" title="添加 AI 参数" aria-label="添加 AI 参数" @click="addApiVariable(String(name))">+</button>
         </div>
         <div v-else-if="isStructured(field)" class="json-field"><textarea :id="`field-${name}`" :value="jsonValue(model[name])" spellcheck="false" @change="updateJson(name, $event)" /><small :class="{ error: jsonErrors[name] }">{{ jsonErrors[name] || '结构化配置，使用 JSON 数组或对象格式编辑。' }}</small></div>
        <input v-else-if="isField(field) && field.type === 'number'" :id="`field-${name}`" v-model.number="model[name]" type="number">
        <label v-else-if="isField(field) && field.type === 'boolean'" class="switch"><input v-model="model[name]" type="checkbox"><i aria-hidden="true" /><span>{{ model[name] ? '已启用' : '已关闭' }}</span></label>
          <BaseSelect v-else-if="isField(field) && field.type === 'single_select'" :model-value="selectValue(String(name), field)" :aria-label="field.name || String(name)" :options="selectOptions(field, rootModel)" @update:model-value="model[name] = $event" />
        <div v-else-if="isField(field) && field.type === 'multiple_select'" class="checks"><label v-for="option in field.options || []" :key="String(option)"><input :checked="(model[name] || []).includes(String(option))" type="checkbox" @change="toggleOption(name, String(option), ($event.target as HTMLInputElement).checked)"><i aria-hidden="true" /><span>{{ option }}</span></label></div>
        <input v-else :id="`field-${name}`" v-model="model[name]" :placeholder="sensitive(String(name), field) ? '留空则保持原值' : ''" :type="sensitiveInputType(String(name), field)" :autocomplete="sensitive(String(name), field) ? 'off' : undefined" :data-1p-ignore="sensitive(String(name), field) ? 'true' : undefined" :data-lpignore="sensitive(String(name), field) ? 'true' : undefined" :data-form-type="sensitive(String(name), field) ? 'other' : undefined">
      </template>
    </div>
  </form>
</template>

<style scoped>
.array-editor { display:grid; gap:5px; }
.array-item { display:grid; grid-template-columns:42px minmax(0, 1fr) auto; align-items:end; gap:8px; padding:7px 8px; background:var(--surface); border:1px solid var(--border); border-radius:4px; }
.array-item-title { color:var(--muted-text); font-size:10px; font-weight:700; white-space:nowrap; }
.array-inputs { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:7px; }
.array-inputs label { display:grid; gap:4px; min-width:0; }
.array-inputs span { color:var(--muted-text); font-size:10px; }
.array-inputs .switch.compact { width:max-content; min-height:34px; box-sizing:border-box; gap:7px; padding:0; background:transparent; border:0; border-radius:0; }
.array-inputs .switch.compact i { width:32px; height:18px; background:color-mix(in srgb, var(--muted-text) 58%, transparent); }
.array-inputs .switch.compact i::after { width:14px; height:14px; }
.array-inputs .switch.compact input:checked + i::after { transform:translateX(14px); }
.array-inputs .switch.compact span { color:var(--muted-text); font-size:11px; font-weight:600; }
.array-inputs .switch.compact:has(input:focus-visible) { outline:2px solid color-mix(in srgb, var(--accent) 45%, transparent); outline-offset:3px; }
.array-remove, .array-add { min-height:30px; padding:0 10px; color:var(--panel-text); background:transparent; border:1px solid var(--border); border-radius:4px; font:inherit; font-size:11px; cursor:pointer; }
.array-remove { color:var(--danger); }.array-add { justify-self:start; display:grid; place-items:center; width:30px; padding:0; color:var(--accent); border-color:color-mix(in srgb, var(--accent) 46%, var(--border)); font-size:20px; font-weight:400; line-height:1; }
.array-remove:hover, .array-add:hover { border-color:var(--accent); color:var(--accent); }
.string-array-editor, .map-list-editor { display:grid; gap:5px; }.string-array-item { display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:8px; }.string-array-item input { min-width:0; }.map-list-head, .map-list-row { display:grid; grid-template-columns:minmax(150px, .8fr) minmax(170px, 1.2fr) auto; gap:8px; align-items:center; }.map-list-head { padding:0 8px; color:var(--muted-text); font-size:10px; font-weight:700; }.map-list-row { padding:6px 8px; background:var(--surface); border:1px solid var(--border); border-radius:4px; }.map-list-row .base-select { min-width:0; }
  .qr-auth { display:grid; justify-items:start; gap:10px; width:min(100%, 280px); padding:12px; background:var(--surface); border:1px solid var(--border); border-radius:4px; }.qr-auth img { display:block; width:100%; aspect-ratio:1; object-fit:contain; background:#fff; }.qr-status, .qr-actions { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; }.qr-auth p { display:flex; align-items:center; gap:6px; min-width:0; margin:0; color:var(--muted-text); font-size:11px; }.qr-auth strong { color:var(--success); font-size:12px; }.qr-auth button { display:inline-flex; flex:none; align-items:center; justify-content:center; gap:6px; min-height:30px; padding:0 10px; color:var(--panel-text); background:transparent; border:1px solid var(--border); border-radius:4px; font:inherit; font-size:11px; cursor:pointer; }.qr-auth button:hover:not(:disabled) { border-color:var(--accent); color:var(--accent); }.qr-auth button.logout { color:var(--danger); }.qr-auth button.logout:hover:not(:disabled) { border-color:var(--danger); color:var(--danger); }.qr-auth button:disabled { cursor:wait; opacity:.7; }.qr-auth .error { color:var(--danger); }.qr-status i, .qr-auth button i { width:11px; height:11px; border:2px solid color-mix(in srgb, var(--accent) 25%, transparent); border-top-color:var(--accent); border-radius:50%; animation:qr-spin .7s linear infinite; }.qr-auth button i { width:10px; height:10px; } @keyframes qr-spin { to { transform:rotate(360deg); } }
@media (max-width:600px) { .array-item { grid-template-columns:1fr auto; }.array-inputs { grid-column:1 / -1; grid-row:2; }.array-remove { grid-column:2; grid-row:1; }.map-list-head { display:none; }.map-list-row { grid-template-columns:1fr auto; }.map-list-row .base-select, .map-list-row > input:nth-child(2) { grid-column:1 / -1; grid-row:2; } }
.fields { display:grid; gap:12px; }.field { display:grid; gap:5px; min-width:0; }.field > label, legend { color:var(--panel-text); font-size:12px; font-weight:700; }.field small { color:var(--muted-text); font-size:11px; }.field input:not([type="checkbox"]) { width:100%; height:34px; box-sizing:border-box; padding:0 8px; color:var(--panel-text); background:var(--surface); border:1px solid var(--border); border-radius:4px; font:inherit; font-size:12px; }.field input:focus { border-color:var(--accent); outline:0; } fieldset { display:grid; gap:12px; margin:0; padding:12px; border:1px solid var(--border); border-radius:4px; }.json-field { display:grid; gap:5px; }.json-field textarea { width:100%; min-height:118px; box-sizing:border-box; resize:vertical; padding:9px; color:var(--panel-text); background:var(--surface); border:1px solid var(--border); border-radius:4px; font:11px/1.55 Consolas, "Courier New", monospace; }.json-field textarea:focus { border-color:var(--accent); outline:0; }.json-field small.error { color:var(--danger); }.switch { position:relative; display:flex; align-items:center; gap:8px; min-height:34px; width:max-content; padding:0 9px; color:var(--muted-text); background:var(--surface); border:1px solid var(--border); border-radius:4px; font-size:11px; cursor:pointer; }.switch input, .checks input { position:absolute; inset:0; width:100%; height:100%; margin:0; opacity:0; cursor:pointer; }.switch i { position:relative; width:28px; height:16px; border-radius:9px; background:var(--muted-text); transition:background-color .18s ease; pointer-events:none; }.switch i::after { content:""; position:absolute; top:2px; left:2px; width:12px; height:12px; border-radius:50%; background:var(--panel-bg); transition:transform .18s ease; }.switch input:checked + i { background:var(--success); }.switch input:checked + i::after { transform:translateX(12px); }.switch:has(input:focus-visible), .checks label:has(input:focus-visible) { outline:2px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset:2px; }.checks { display:flex; flex-wrap:wrap; gap:6px; padding:8px; border:1px solid var(--border); border-radius:4px; }.checks label { position:relative; display:inline-flex; align-items:center; gap:6px; min-height:28px; padding:0 8px; color:var(--muted-text); background:var(--surface); border:1px solid transparent; border-radius:3px; font-size:11px; cursor:pointer; transition:background-color .16s ease, border-color .16s ease, color .16s ease; }.checks label i { display:grid; place-items:center; width:13px; height:13px; box-sizing:border-box; border:1px solid var(--muted-text); border-radius:3px; pointer-events:none; }.checks label span { pointer-events:none; }.checks label i::after { content:""; width:6px; height:3px; border-left:1.5px solid var(--accent-contrast); border-bottom:1.5px solid var(--accent-contrast); transform:rotate(-45deg) translateY(-1px); opacity:0; }.checks label:has(input:checked) { color:var(--accent); border-color:color-mix(in srgb, var(--accent) 45%, var(--border)); background:var(--surface-selected); }.checks label:has(input:checked) i { border-color:var(--accent); background:var(--accent); }.checks label:has(input:checked) i::after { opacity:1; }
.api-map-editor, .api-variables-editor { display:grid; gap:5px; min-width:0; }
.api-map-head, .api-map-row { display:grid; grid-template-columns:minmax(100px, .8fr) minmax(140px, 1.2fr) 70px auto; gap:8px; align-items:center; }
.api-variable-head, .api-variable-row { display:grid; grid-template-columns:minmax(100px, .8fr) 100px minmax(140px, 1.2fr) 68px auto; gap:8px; align-items:center; }
.api-map-head, .api-variable-head { padding:0 8px; color:var(--muted-text); font-size:10px; font-weight:700; }
.api-map-row, .api-variable-row { padding:6px 8px; background:var(--surface); border:1px solid var(--border); border-radius:4px; }
.api-map-row small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.api-variable-row .base-select { min-width:0; }
@media (max-width:600px) {
  .api-map-head, .api-variable-head { display:none; }
  .api-map-row, .api-variable-row { grid-template-columns:1fr auto; }
  .api-map-row input:nth-child(2), .api-map-row small, .api-variable-row .base-select, .api-variable-row input:nth-child(3), .api-variable-row .switch { grid-column:1 / -1; grid-row:2; }
  .api-map-row .array-remove, .api-variable-row .array-remove { grid-column:2; grid-row:1; }
}
</style>
