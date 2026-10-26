import type { PlanCategory, CaptureDraft, CompletionRecord, DiaryDocument, DiaryResponse, EntityRecord, EntityType, PinQuickFactRequest, QuickFact, SentenceSplitResult, TagStore, Todo, RecordRef } from "@diary/contracts";
import type {FieldIssue} from '@diary/contracts';
import type {SocialSnapshot,SharedWindow,SocialPerson} from '@diary/contracts';
export class ApiError extends Error {
  constructor(message:string,public status=0,public data:{code?:string;issues?:FieldIssue[];requestId?:string;current?:DiaryResponse}={}) { super(message); this.name='ApiError'; }
}
export type ActionRow = { windowId?:string;windowName?:string;readOnly?:boolean;role?:'owner'|'viewer'|'editor';seriesVersion?:string; restorePending?: boolean; completionPending?: boolean; pendingRecord?: CaptureDraft; date: string; version: string; task: Todo; sourceExists: boolean; completionExists: boolean; pendingFact?: { date: string; id: string; time: string; note: string; remark: string } };
export type ActionInput = { windowId?:string;automaticRecord?: boolean; completionRecord?: CompletionRecord; mode: 'create' | 'update' | 'delete' | 'complete' | 'restore' | 'purge' | 'status'; date: string; version: string; task: Todo; operationId: string; sourceVersion?: string; fact?: { date: string; version: string; time: string; note: string; remark: string }; nextStatus?: 'todo' | 'doing' | 'done' | 'cancelled' };
export type ParsedTodo = Pick<Todo, 'entities' | 'category' | 'important' | 'urgent' | 'startDate' | 'startTime' | 'checkinEnabled'> & { windowId?:string;repeat?: Todo['repeat']; description?: string; title: string; dueDate: string; dueTime: string; priority: string; list: string; tags: string[] };
export type PlanView = { id: string; name: string; color: string; tags: string[] };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), (path === "/api/split-sentence" || path === "/api/parse-todo" || path === "/api/capture/parse") ? 30_000 : 15_000);
  try {
    const hasBody = init?.body != null;
    const response = await fetch(path, { ...init, credentials: 'include', signal: controller.signal, headers: hasBody ? { "content-type": "application/json", ...init?.headers } : init?.headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if(response.status===401&&!path.startsWith('/api/auth/')) window.dispatchEvent(new Event('diary-auth-required'));
      throw new ApiError(response.status===401?'登录已失效，重新登录后可继续保存':data.error||`请求失败（${response.status}）`,response.status,data);
    }
    return data as T;
  } catch(error) {
    if(error instanceof ApiError) throw error;
    if(controller.signal.aborted) throw new ApiError('请求超时，草稿已保留，请重试',0,{code:'TIMEOUT'});
    throw new ApiError('网络连接失败，草稿已保留，请检查网络后重试',0,{code:'NETWORK_ERROR'});
  } finally { window.clearTimeout(timer); }
}

export const api = {
  social:()=>request<SocialSnapshot>('/api/social'),
  friendRequest:(code:string)=>request('/api/friends',{method:'POST',body:JSON.stringify({code})}),
  respondFriend:(id:string,action:'accept'|'reject'|'withdraw')=>request(`/api/friends/${id}/respond`,{method:'POST',body:JSON.stringify({action})}),
  removeFriend:(code:string)=>request(`/api/friends/${encodeURIComponent(code)}`,{method:'DELETE'}),
  createWindow:(name:string,color:string)=>request<{window:SharedWindow}>('/api/shared-windows',{method:'POST',body:JSON.stringify({name,color})}),
  editWindow:(window:SharedWindow,archived=false)=>request(`/api/shared-windows/${window.id}`,{method:'PATCH',body:JSON.stringify({...window,archived})}),
  inviteMember:(id:string,code:string,role='viewer')=>request(`/api/shared-windows/${id}/invite`,{method:'POST',body:JSON.stringify({code,role})}),
  changeMember:(id:string,action:string,code?:string,role?:string)=>request(`/api/shared-windows/${id}/members`,{method:'POST',body:JSON.stringify({action,code,role})}),
  readNotices:(through:number)=>request('/api/social/read',{method:'POST',body:JSON.stringify({through})}),
  sharedTasks:(from?:string,to?:string)=>request<{tasks:ActionRow[]}>(`/api/shared-tasks?${new URLSearchParams({...from?{from}:{},...to?{to}:{}})}`),
  sharedAction:(windowId:string,input:Omit<ActionInput,'mode'>&{mode:ActionInput['mode']|'series';from?:string;stop?:boolean;seriesVersion?:string})=>request<{row:ActionRow;refreshWarning?:string}>(`/api/shared-windows/${windowId}/actions`,{method:'POST',body:JSON.stringify(input)}),
  demoAccounts:()=>request<{accounts:SocialPerson[]}>('/api/demo/accounts'),
  demoAccount:(code:string)=>request('/api/demo/account',{method:'POST',body:JSON.stringify({code})}),
  tagLibrary: () => request<{tags: string[]}>('/api/tag-library'),
  addSharedTag: (tag: string) => request<{tags: string[]}>('/api/tag-library', {method:'POST',body:JSON.stringify({tag})}),
  planCategories: () => request<{categories:PlanCategory[]}>('/api/plan-categories'),
  addPlanCategory: (name:string,color:string) => request<{category:PlanCategory;categories:PlanCategory[]}>('/api/plan-categories',{method:'POST',body:JSON.stringify({name,color})}),
  reorderPlanCategories: (ids: string[]) => request<{categories:PlanCategory[]}>('/api/plan-categories/order',{method:'PUT',body:JSON.stringify({ids})}),
  planViews: () => request<{views: PlanView[]}>('/api/plan-views'),
  savePlanViews: (views: PlanView[]) => request<{views: PlanView[]}>('/api/plan-views', {method:'PUT',body:JSON.stringify({views})}),
  parseCapture: (text: string, completion?: {title: string; description: string; date: string; time: string}) => request<{drafts: CaptureDraft[]; today: string; timezone: string; mode: 'ai' | 'manual'}>('/api/capture/parse', { method: 'POST', body: JSON.stringify({text, completion}) }),
  setPlaceParent: (key: string, parentKey: string | null) => request<{ entities: EntityRecord[] }>("/api/place-parent", { method: "PUT", body: JSON.stringify({ key, parentKey }) }),
  actions: () => request<{ tasks: ActionRow[]; records: RecordRef[] }>('/api/actions'),
  schedule: (from:string,to:string,cursor?:string) => request<{tasks:ActionRow[];nextCursor?:string}>(`/api/schedule?${new URLSearchParams({from,to,...(cursor?{cursor}:{})})}`),
  updateSeries: (input:{date:string;version:string;task:Todo;from:string;stop:boolean}) => request<{diary:DiaryResponse}>('/api/schedule/series',{method:'POST',body:JSON.stringify(input)}),
  changeAction: (input: ActionInput) => request<{ diary: DiaryResponse }>('/api/actions', { method: 'POST', body: JSON.stringify(input) }),
  obsidian: (date: string) => request<{ uri: string }>(`/api/obsidian/${date}`),
  loadDiary: (date: string) => request<DiaryResponse>(`/api/diaries/${date}`),
  saveDiary: (date: string, document: DiaryDocument, version: string) => request<DiaryResponse>(`/api/diaries/${date}`, { method: "PUT", headers: { "if-match": version, 'x-diary-record-version': '2' }, body: JSON.stringify(document) }),
  listDiaries: (from: string, to: string) => request<{ dates: string[] }>(`/api/diaries?from=${from}&to=${to}`),
  week: (date: string) => request<{ start: string; end: string; entries: Array<{ date: string; document: DiaryDocument }> }>(`/api/weeks?date=${date}`),
  entities: (q = "") => request<{ entities: EntityRecord[] }>(`/api/entities?q=${encodeURIComponent(q)}&limit=500`),
  entity: (type: EntityType, name: string) => request<EntityRecord>(`/api/entities/${type}/${encodeURIComponent(name)}`),
  tags: () => request<{ tags: TagStore }>("/api/tags"),
  addTag: (type: EntityType, name: string) => request<{ tags: TagStore }>("/api/tags", { method: "POST", body: JSON.stringify({ type, name }) }),
  splitSentence: (sentence: string) => request<{ result: SentenceSplitResult & { category: string; time: string; tags: string[] }; mode: "ai" }>("/api/split-sentence", { method: "POST", body: JSON.stringify({ sentence }) }),
  parseTodo: (text: string) => request<ParsedTodo>("/api/parse-todo", { method: "POST", body: JSON.stringify({ text }) }),
  suggestTags: (text: string, kind: "idea" | "learn" | "input") => request<string[]>("/api/suggest-tags", { method: "POST", body: JSON.stringify({ text, kind }) }),
  reverseGeocode: (lat: number, lng: number) => request<{ name: string; address: string; lat: number; lng: number }>(`/api/reverse-geocode?lat=${lat}&lng=${lng}`),
  quickFacts: (days = 30, limit = 15) => request<{ facts: QuickFact[] }>(`/api/quick-facts?days=${days}&limit=${limit}`),
  pinQuickFact: (input: PinQuickFactRequest) => request<QuickFact>("/api/quick-facts/pin", { method: "POST", body: JSON.stringify(input) }),
  useQuickFact: (id: string) => request<QuickFact>(`/api/quick-facts/${id}/use`, { method: "POST", body: JSON.stringify({}) }),
  unpinQuickFact: (id: string) => request<{ ok: boolean }>(`/api/quick-facts/${id}`, { method: "DELETE" }),
  summarize: (date: string, useAi: boolean) => request<{ ok: boolean; skipped?: boolean; reason?: string; mode?: string; summaryPath?: string }>("/api/weekly-summaries", { method: "POST", body: JSON.stringify({ date, useAi }) }),
  upload: async (file: File, date?: string): Promise<{ path: string; name: string; size: number }> => {
    const fd = new FormData();
    fd.append("file", file);
    const url = date ? `/api/upload?date=${date}` : `/api/upload`;
    const response = await fetch(url, { method: "POST", body: fd, credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `上传失败（${response.status}）`);
    return data;
  },
  assetUrl: (path: string) => `/${path}`,
  auth: {
    me: () => request<{ id: number; username: string }>('/api/auth/me'),
    login: (username: string, password: string) => request<{ id: number; username: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    register: (username: string, password: string) => request<{ id: number; username: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
    logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  },
};
