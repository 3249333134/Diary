export type WindowRole='owner'|'editor'|'viewer';
export type SocialPerson={code:string;name:string};
export type FriendRequest={id:string;person:SocialPerson;direction:'incoming'|'outgoing';createdAt:string};
export type WindowMember=SocialPerson&{role:WindowRole;status:'invited'|'active'};
export type SharedWindow={id:string;name:string;color:string;version:string;role:WindowRole;members:WindowMember[]};
export type SocialNotice={id:number;kind:string;title:string;windowId?:string;taskId?:string;read:boolean;createdAt:string};
export type SocialSnapshot={profile:SocialPerson;friends:SocialPerson[];requests:FriendRequest[];invitations:SharedWindow[];windows:SharedWindow[];notices:SocialNotice[];cursor:number};
