import {it,expect,vi,afterEach} from 'vitest';
import {api,ApiError} from './api';
import {emptyDiary} from '@diary/contracts';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
function setup(){const dispatchEvent=vi.fn();vi.stubGlobal('window',{setTimeout,clearTimeout,dispatchEvent});return dispatchEvent;}
it('retains structured 400 diagnostics and distinguishes expired login and conflicts',async()=>{
 const dispatch=setup();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({code:'VALIDATION_FAILED',issues:[{path:'facts.note',maximum:20000}],requestId:'req-a'}),{status:400})).mockResolvedValueOnce(new Response('{}',{status:401})).mockResolvedValueOnce(new Response(JSON.stringify({code:'VERSION_CONFLICT',current:{version:'new'}}),{status:409})));
 const save=()=>api.saveDiary('2026-10-13',emptyDiary('2026-10-13'),'0');
 await expect(save()).rejects.toMatchObject({status:400,data:{requestId:'req-a',issues:[{path:'facts.note',maximum:20000}]}});await expect(save()).rejects.toMatchObject({status:401});expect(dispatch).toHaveBeenCalled();await expect(save()).rejects.toMatchObject({status:409,data:{current:{version:'new'}}});
});
it('distinguishes offline failures from request timeouts',async()=>{
 setup();vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('failed')));await expect(api.tags()).rejects.toMatchObject({data:{code:'NETWORK_ERROR'}});
 vi.useFakeTimers();vi.stubGlobal('window',{setTimeout,clearTimeout,dispatchEvent:vi.fn()});vi.stubGlobal('fetch',vi.fn((_path,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted'))))));
 const result=api.tags().catch(e=>e);await vi.advanceTimersByTimeAsync(15000);const error=await result;expect(error).toBeInstanceOf(ApiError);expect(error.data.code).toBe('TIMEOUT');
});
