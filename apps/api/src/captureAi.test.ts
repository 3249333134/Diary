import {personalMemorySchema} from '@diary/contracts';
import { it, expect, vi } from 'vitest';
const { request }=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('undici',()=>({request,ProxyAgent:class{}}));
vi.mock('./config.js',()=>({config:{timezone:'Asia/Shanghai',ai:{key:'mock',url:'http://local.invalid/v1',model:'mock',proxy:'',timeout:18_000}}}));
import { parseCapture } from './capture.js';
it('configured AI splits mixed input and supplies the real Shanghai date and known tags',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-30T16:01:00Z'));
  try{
    request.mockResolvedValue({statusCode:200,body:{json:async()=>({choices:[{message:{content:JSON.stringify({drafts:[{kind:'facts',content:'与张三讨论资料',date:'',tags:['项目']},{kind:'plan',content:'开会',date:'',startDate:'2026-10-02',startTime:'15:00',category:'work',important:null,urgent:null}]})}}]})}});
    const result=await parseCapture({text:'今天与张三讨论资料，明天下午三点开会'},{names:['张三'],tags:['项目']});
    expect(result.mode).toBe('ai');expect(result.drafts).toHaveLength(2);expect(result.drafts[0].date).toBe('2026-10-01');expect(result.drafts[1]).toMatchObject({date:'',time:'',startDate:'2026-10-02',startTime:'15:00',important:null});
    expect(JSON.parse(request.mock.calls[0][1].body).messages[0].content).toContain('今天是 2026-10-01');
    expect(request.mock.calls[0][1].body).toContain('项目');
  }finally{vi.useRealTimers();}
});
it('AI errors retain the original input for manual purpose confirmation',async()=>{
  request.mockRejectedValue(new Error('unavailable'));
  const result=await parseCapture({text:'计划读书，也记一下今天散步'});
  expect(result.mode).toBe('manual');expect(result.drafts[0]).toMatchObject({content:'计划读书，也记一下今天散步',needsReview:true});
});

it('uses confirmed off-work and person aliases without inventing a deadline or saving memories',async()=>{
 const memories=[personalMemorySchema.parse({id:crypto.randomUUID(),kind:'time',key:'offWork',label:'下班时间',value:'18:00'}),personalMemorySchema.parse({id:crypto.randomUUID(),kind:'person',key:'李明',label:'李明',value:'同事',aliases:['小李'],tags:['项目A']})];
 const original=structuredClone(memories);
 request.mockResolvedValue({statusCode:200,body:{json:async()=>({choices:[{message:{content:JSON.stringify({drafts:[{kind:'plan',content:'和小李健身',date:'2026-11-01',time:'21:00',entities:{people:['小李']}}]})}}]})}});
 const result=await parseCapture({text:'下班后和小李健身'},{names:[],tags:[],memories});
 expect(result.drafts[0]).toMatchObject({date:'',time:'',startTime:'18:00',entities:{people:[{name:'李明',personId:memories[1].id,tags:['项目A']}]}});
 expect(result.memoryMatches[result.drafts[0].id].applied.map(m=>m.id)).toEqual(memories.map(m=>m.id));expect(memories).toEqual(original);expect(result.memoryCandidates).toHaveLength(0);
 const explicit=await parseCapture({text:'今天加班到20点，下班后和小李健身'},{names:[],tags:[],memories});expect(explicit.drafts[0]).toMatchObject({startTime:'20:00',date:'',time:''});expect(explicit.memoryCandidates[0].record.date).toBeTruthy();
});
