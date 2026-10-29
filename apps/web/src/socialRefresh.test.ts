import {describe,it,expect} from 'vitest';
import type {SocialSnapshot} from '@diary/contracts';
import {normalizeSocialChange,mergeSocialChanges,reconcileSocial,pendingSocialRequests} from './socialRefresh';
import {creationFieldLocation} from './creationFocus';
const snapshot=():SocialSnapshot=>({profile:{code:'ME',name:'我'},friends:[],requests:[],invitations:[],windows:[],notices:[],cursor:0});
describe('resource changes and attention',()=>{
 it('keeps legacy empty events conservative and merges diary dates without dropping a full refresh',()=>{
  expect(normalizeSocialChange({}).domains).toEqual(['social','plans','diary']);expect(normalizeSocialChange({domains:['social']})).toEqual({domains:['social'],dates:undefined});
  expect(mergeSocialChanges({domains:['diary'],dates:['2026-10-29']},{domains:['social','diary'],dates:['2026-10-30']})).toEqual({domains:['diary','social'],dates:['2026-10-29','2026-10-30']});
  expect(mergeSocialChanges({domains:['diary'],dates:['2026-10-29']},{domains:['diary']} ).dates).toBeUndefined();
 });
 it('only counts incoming pending requests, independently of ordinary unread notices',()=>{const data=snapshot();data.requests=[{id:'a',person:data.profile,direction:'outgoing',createdAt:''},{id:'b',person:data.profile,direction:'incoming',createdAt:''}];data.organizationInvitations=[{id:'c',direction:'outgoing'} as any,{id:'d',direction:'incoming'} as any];data.unreadNoticeCount=200;expect(pendingSocialRequests(data)).toBe(2);});
 it('keeps unchanged organization and window references when only notice read status changes',()=>{const previous=snapshot();previous.notices=[{id:1,kind:'schedule',title:'更新',read:false,createdAt:''}];const next=structuredClone(previous);next.notices[0].read=true;const stable=reconcileSocial(previous,next);expect(stable.windows).toBe(previous.windows);expect(stable.profile).toBe(previous.profile);expect(stable.notices).not.toBe(previous.notices);expect(reconcileSocial(previous,structuredClone(previous))).toBe(previous);});
 it('maps nested public validation paths to the collapsed group that must be revealed',()=>{expect(creationFieldLocation('todos.0.repeat.until')).toEqual({field:'repeat',group:'repeat'});expect(creationFieldLocation('facts.events.0.remark')).toEqual({field:'description',group:'entities'});expect(creationFieldLocation('todos.0.tags.2')).toEqual({field:'tags',group:'attachments'});expect(creationFieldLocation('entries.learn.0.content')).toEqual({field:'content',group:undefined});expect(creationFieldLocation('todos.0.dueDate').field).toBe('date');});
});
