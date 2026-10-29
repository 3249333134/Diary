import type {SocialChange,SocialDomain,SocialSnapshot} from '@diary/contracts';
export const fullSocialChange=():SocialChange=>({domains:['social','plans','diary']});
export function normalizeSocialChange(raw:unknown):SocialChange{
 const input=raw as Partial<SocialChange>|undefined;
 if(!Array.isArray(input?.domains)||!input.domains.length)return fullSocialChange();
 const domains=[...new Set(input.domains.filter(d=>['social','plans','diary'].includes(d)))] as SocialDomain[];
 return domains.length?{domains,dates:Array.isArray(input.dates)?input.dates.filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)):undefined}:fullSocialChange();
}
export function mergeSocialChanges(a:SocialChange,b:SocialChange):SocialChange{
 const diary=[a,b].filter(c=>c.domains.includes('diary'));
 return {domains:[...new Set([...a.domains,...b.domains])],dates:diary.some(c=>!c.dates)?undefined:[...new Set(diary.flatMap(c=>c.dates||[]))]};
}
export function reconcileSocial(previous:SocialSnapshot,next:SocialSnapshot):SocialSnapshot{
 const result={...next};for(const key of Object.keys(next) as (keyof SocialSnapshot)[])if(JSON.stringify(previous[key])===JSON.stringify(next[key]))(result as any)[key]=previous[key];return Object.keys(next).every(key=>(previous as any)[key]===(result as any)[key])?previous:result;
}
export function pendingSocialRequests(data:SocialSnapshot){return data.requests.filter(r=>r.direction==='incoming').length+data.invitations.length+(data.organizationInvitations?.filter(r=>r.direction==='incoming').length||0);}
